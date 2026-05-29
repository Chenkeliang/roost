import * as fs from "fs";
import * as path from "path";
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
} from "@roost/shared";
import { createChezmoi } from "../adapters/chezmoi.js";
import { isNoise, scanDir } from "../discovery/scan.js";

// ── isSensitivePath ───────────────────────────────────────────────────────────

const SENSITIVE_PATH_FRAGMENTS = [".ssh/", ".aws/", ".config/gh/"];
const SENSITIVE_EXACT_BASENAMES = new Set([".npmrc", ".git-credentials", ".netrc"]);
const SENSITIVE_CONFIG_FILES = new Set(["env.sh"]);

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

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const candidates: Candidate[] = [];

    // Scan home dir for dot-entries
    const homeEntries = scanDir(ctx.home);
    for (const entry of homeEntries) {
      const base = path.basename(entry.path);
      if (!base.startsWith(".")) continue; // only dotfiles/dotdirs at home level
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

    return candidates;
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const ids = sel.modules["dotfiles"] ?? [];
    const written: string[] = [];
    const encrypted: string[] = [];

    for (const id of ids) {
      const sensitive = isSensitivePath(id);
      await chezmoi.add(id, { encrypt: sensitive });
      if (sensitive) {
        encrypted.push(id);
      } else {
        written.push(id);
      }
    }

    return { module: "dotfiles", written, encrypted };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const ok = await chezmoi.verify();
    const ids = sel.modules["dotfiles"] ?? [];
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

  async unmanage(_ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    return {
      module: "dotfiles",
      applied: [],
      backedUp: [],
      skipped: sel.modules["dotfiles"] ?? [],
    };
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
