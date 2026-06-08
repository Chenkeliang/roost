import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SyncModule,
  ModuleContext,
  Candidate,
  Recommendation,
  Selection,
  DriftReport,
  ChangeSet,
  ApplyPlan,
  ApplyResult,
  Health,
  BlockedItem,
} from "@roost/shared";
import { createChezmoi } from "../adapters/chezmoi.js";
import { isNoise, scanDir } from "../discovery/scan.js";
import { scanForSecrets } from "../secrets/scanner.js";
import { loadAppConfigCatalog, expandCatalogPath } from "../app-config-catalog.js";
import { ensureChezmoiAgeConfig } from "../chezmoi-config.js";
import { loadRoostSettings } from "../settings.js";

export interface CaptureScanResult {
  secretFiles: string[];
  tooLarge: boolean;
  files: number;
  bytes: number;
}

// Capture-time guard for a selected path (file or dir). Bounded recursive walk
// that (1) counts files/bytes so we never slurp a huge dir (e.g. a whole app
// support dir with caches), and (2) scans text files for plaintext secrets —
// dotfiles capture previously trusted only a path heuristic, which is unsafe now
// that arbitrary app-config paths can be added. (ADR-0007 H1/H3)
// Defensive: unreadable/missing paths yield no findings so capture still proceeds
// (chezmoi surfaces any real error).
export function scanPathForSecrets(
  absPath: string,
  opts?: { maxFiles?: number; maxBytes?: number; maxScanFileBytes?: number },
): CaptureScanResult {
  const maxFiles = opts?.maxFiles ?? 2000;
  const maxBytes = opts?.maxBytes ?? 100 * 1024 * 1024;
  const maxScanFileBytes = opts?.maxScanFileBytes ?? 2 * 1024 * 1024;
  const res: CaptureScanResult = { secretFiles: [], tooLarge: false, files: 0, bytes: 0 };

  const stack: string[] = [absPath];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let st: fs.Stats;
    try { st = fs.statSync(cur); } catch { continue; }
    if (st.isDirectory()) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) stack.push(path.join(cur, e.name));
      continue;
    }
    if (!st.isFile()) continue;
    res.files++;
    res.bytes += st.size;
    if (res.files > maxFiles || res.bytes > maxBytes) {
      res.tooLarge = true;
      return res;
    }
    if (st.size <= maxScanFileBytes) {
      try {
        if (scanForSecrets(fs.readFileSync(cur, "utf8")).length > 0) res.secretFiles.push(cur);
      } catch {
        /* unreadable / binary — skip */
      }
    }
  }
  return res;
}

// ── isSensitivePath ───────────────────────────────────────────────────────────

const SENSITIVE_PATH_FRAGMENTS = [".ssh/", ".aws/", ".config/gh/"];
const SENSITIVE_EXACT_BASENAMES = new Set([".npmrc", ".git-credentials", ".netrc"]);
const SENSITIVE_CONFIG_FILES = new Set(["env.sh"]);

/**
 * True for tool-internal config that dotfiles must never manage:
 *  - `~/.config/roost/` — the env module owns it (generated env.sh, env-secrets).
 *  - `~/.config/chezmoi/` — chezmoi's OWN config; `chezmoi add` refuses it
 *    ("cannot add chezmoi's config file"), so offering/capturing it just errors.
 */
export function isRoostManaged(absPath: string): boolean {
  const n = absPath.replace(/\\/g, "/");
  for (const dir of ["/.config/roost", "/.config/chezmoi"]) {
    if (n.endsWith(dir) || n.includes(`${dir}/`)) return true;
  }
  return false;
}

export function isSensitivePath(absPath: string): boolean {
  const base = path.basename(absPath);
  const normalized = absPath.replace(/\\/g, "/");

  // Exact basename matches
  if (SENSITIVE_EXACT_BASENAMES.has(base)) return true;

  // Path fragment matches (directory membership)
  for (const frag of SENSITIVE_PATH_FRAGMENTS) {
    if (normalized.includes(`/${frag.replace(/\/$/, "/")}`) || normalized.endsWith(`/${frag.replace(/\/$/, "")}`)) {
      return true;
    }
  }

  // .config/env.sh
  if (normalized.endsWith("/.config/env.sh") || (normalized.includes("/.config/") && SENSITIVE_CONFIG_FILES.has(base))) {
    return true;
  }

  // Basename contains sensitive keywords
  const lowerBase = base.toLowerCase();
  if (lowerBase.includes("secret") || lowerBase.includes("token") || lowerBase.includes("credential")) {
    return true;
  }

  // Extension checks
  if (base.endsWith(".key") || base.endsWith(".pem")) return true;

  return false;
}

// ── classifyDotfile ───────────────────────────────────────────────────────────

export function classifyDotfile(absPath: string): Recommendation {
  if (isNoise(absPath)) return "exclude";
  if (isSensitivePath(absPath)) return "encrypt";
  return "track";
}

// ── category derivation ───────────────────────────────────────────────────────

const SHELL_BASENAMES = new Set([
  ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".zlogout",
  ".bashrc", ".bash_profile", ".bash_login", ".bash_logout",
  ".profile", ".fishrc", ".config",
]);
const GIT_BASENAMES = new Set([
  ".gitconfig", ".gitignore_global", ".gitattributes", ".gitmessage",
]);
const EDITOR_BASENAMES = new Set([
  ".vimrc", ".nvimrc", ".emacs", ".editorconfig", ".nanorc",
]);
const CLOUD_BASENAMES = new Set([".aws", ".azure", ".gcloud"]);
const SHELL_DIRS = new Set(["fish", "zsh", "bash"]);
const EDITOR_DIRS = new Set(["nvim", "vim", "emacs", "helix", "neovim"]);
const CLOUD_DIRS = new Set(["aws", "azure", "gcloud"]);

function deriveCategory(absPath: string): string {
  const base = path.basename(absPath);
  if (SHELL_BASENAMES.has(base) || SHELL_DIRS.has(base)) return "shell";
  if (GIT_BASENAMES.has(base)) return "git";
  if (EDITOR_BASENAMES.has(base) || EDITOR_DIRS.has(base)) return "editor";
  if (CLOUD_BASENAMES.has(base) || CLOUD_DIRS.has(base)) return "cloud";
  return "other";
}

// ── discover ──────────────────────────────────────────────────────────────────

export const dotfilesModule: SyncModule = {
  name: "dotfiles",

  async index(ctx: ModuleContext): Promise<import("@roost/shared").ModuleIndex> {
    const probe = await ctx.exec.run("chezmoi", ["--version"]);
    const available = probe.code === 0;
    let managed = 0;
    try {
      managed = (await createChezmoi(ctx.exec, { sourceDir: ctx.repoDir }).managed()).length;
    } catch {
      managed = 0;
    }
    return {
      available,
      reason: available ? undefined : "chezmoi not found",
      managed,
    };
  },

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const candidates: Candidate[] = [];

    // Scan home dir for dot-entries (skip .config itself — scanned separately below)
    const homeEntries = scanDir(ctx.home);
    for (const entry of homeEntries) {
      const base = path.basename(entry.path);
      if (!base.startsWith(".")) continue; // only dotfiles/dotdirs at home level
      if (base === ".config") continue; // scanned into separately below
      if (isRoostManaged(entry.path)) continue; // env module owns ~/.config/roost
      const rec = classifyDotfile(entry.path);
      if (rec === "exclude") continue;
      candidates.push({
        id: entry.path,
        path: entry.path,
        category: deriveCategory(entry.path),
        sizeBytes: entry.sizeBytes,
        recommendation: rec,
      });
    }

    // Scan .config one level
    const configDir = path.join(ctx.home, ".config");
    if (fs.existsSync(configDir)) {
      const configEntries = scanDir(configDir);
      for (const entry of configEntries) {
        if (isRoostManaged(entry.path)) continue; // env module owns ~/.config/roost
        const rec = classifyDotfile(entry.path);
        if (rec === "exclude") continue;
        candidates.push({
          id: entry.path,
          path: entry.path,
          category: deriveCategory(entry.path),
          sizeBytes: entry.sizeBytes,
          recommendation: rec,
        });
      }
    }

    // Curated app-config locations (ADR-0007): file-based app config that isn't
    // a $HOME dotfile (e.g. VS Code, JetBrains options). Globs expand to existing
    // paths only; skip any already surfaced above.
    const seen = new Set(candidates.map((c) => c.id));
    for (const app of loadAppConfigCatalog(ctx.repoDir)) {
      for (const pattern of app.paths) {
        for (const abs of expandCatalogPath(ctx.home, pattern)) {
          if (seen.has(abs) || isRoostManaged(abs)) continue;
          seen.add(abs);
          candidates.push({
            id: abs,
            path: abs,
            category: deriveCategory(abs),
            recommendation: app.encryptRecommended ? "encrypt" : "track",
            note: `app config (${app.name})`,
          });
        }
      }
    }

    return candidates;
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const ids = sel.modules["dotfiles"] ?? [];
    const written: string[] = [];
    const encrypted: string[] = [];
    const blocked: string[] = [];
    const blockedDetail: BlockedItem[] = [];

    // Encrypt intent comes from two sources: the path heuristic (.ssh/.aws/…) and
    // the curated catalog's encryptRecommended apps (e.g. JetBrains) — expanded to
    // the concrete paths on this machine. (ADR-0007)
    const encryptByCatalog = new Set(
      loadAppConfigCatalog(ctx.repoDir)
        .filter((a) => a.encryptRecommended)
        .flatMap((a) => a.paths)
        .flatMap((p) => expandCatalogPath(ctx.home, p)),
    );
    // Paths the user explicitly marked to encrypt (ADR-0010), e.g. retrying a
    // blocked secret-bearing dotfile. Stored as a convention key in selection.
    const markedEncrypt = new Set(sel.modules["dotfiles-encrypt"] ?? []);
    // chezmoi --encrypt needs an age recipient configured; ensure it lazily, once.
    let ageReady: boolean | null = null;
    // Capture size guard cap (configurable via roost/settings.yaml). (Task 5)
    const maxBytes = loadRoostSettings(ctx.repoDir).maxCaptureMB * 1024 * 1024;

    for (const id of ids) {
      // Never try to manage tool-internal config (roost's / chezmoi's own).
      if (isRoostManaged(id)) {
        blocked.push(id);
        blockedDetail.push({ id, reason: "managed" });
        continue;
      }
      const wantsEncrypt = isSensitivePath(id) || encryptByCatalog.has(id) || markedEncrypt.has(id);
      const scan = scanPathForSecrets(id, { maxBytes });

      // H3: never slurp an oversized path (e.g. a whole app-support dir with caches).
      if (scan.tooLarge) {
        ctx.log.warn(
          `dotfiles capture: "${id}" is too large (${scan.files} files / ` +
            `${Math.round(scan.bytes / 1_000_000)}MB) — add a more specific subpath. Skipped.`,
        );
        blocked.push(id);
        blockedDetail.push({
          id,
          reason: "too-large",
          detail: `${Math.round(scan.bytes / 1048576)}MB / ${scan.files} files`,
        });
        continue;
      }

      if (wantsEncrypt) {
        // Configure chezmoi's age recipient from the existing key (once).
        if (ageReady === null) {
          ageReady = (await ensureChezmoiAgeConfig(ctx.exec, { home: ctx.home, repoDir: ctx.repoDir })).ready;
        }
        if (!ageReady) {
          ctx.log.warn(
            `dotfiles capture: "${id}" should be encrypted but no age key exists — ` +
              `generate one (Settings → Generate key / \`age-keygen\`) first. Skipped.`,
          );
          blocked.push(id);
          blockedDetail.push({ id, reason: "error", detail: "no age key" });
          continue;
        }
        await chezmoi.add(id, { encrypt: true });
        encrypted.push(id);
        continue;
      }

      // H1: block plaintext secrets on a non-encrypted path — never silently commit.
      if (scan.secretFiles.length > 0) {
        ctx.log.warn(
          `dotfiles capture: "${id}" contains potential secrets in ` +
            `${scan.secretFiles.length} file(s) — skipped. Mark it for encryption or ` +
            `exclude that file, and rotate any exposed credentials.`,
        );
        blocked.push(id);
        blockedDetail.push({ id, reason: "secret", detail: `${scan.secretFiles.length} file(s)` });
        continue;
      }

      await chezmoi.add(id, { encrypt: false });
      written.push(id);
    }

    return { module: "dotfiles", written, encrypted, blocked, blockedDetail };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const ids = sel.modules["dotfiles"] ?? [];
    // Unmanaged → cheap, no chezmoi call (cold-path guard).
    if (ids.length === 0) {
      return { module: "dotfiles", items: [] };
    }
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const ok = await chezmoi.verify();
    return {
      module: "dotfiles",
      items: ids.map((id) => ({ id, state: ok ? "synced" : "drift" })),
    };
  },

  async apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    await chezmoi.apply({ dryRun: ctx.dryRun });
    return {
      module: "dotfiles",
      applied: ctx.dryRun ? [] : plan.actions.map((a) => a.id),
      backedUp: [],
      skipped: ctx.dryRun ? plan.actions.map((a) => a.id) : [],
    };
  },

  async diff(ctx: ModuleContext, _sel: Selection): Promise<string> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    return chezmoi.diff();
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const ids = sel.modules["dotfiles"] ?? [];
    const applied: string[] = [];

    for (const id of ids) {
      await chezmoi.forget(id);
      applied.push(id);
    }

    if (applied.length > 0) {
      ctx.log.warn(
        "unmanage: items removed from the working tree but git history is NOT purged. " +
        "If any removed file ever contained secrets, rotate them now and purge git history " +
        "with `git filter-repo` or BFG Repo Cleaner.",
      );
    }

    return { module: "dotfiles", applied, backedUp: [], skipped: [] };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const r = await ctx.exec.run("chezmoi", ["--version"]);
    return [
      {
        name: "chezmoi",
        ok: r.code === 0,
        detail: r.code === 0 ? undefined : "chezmoi not found",
      },
    ];
  },
};
