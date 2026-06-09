import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SyncModule,
  ModuleContext,
  Candidate,
  Selection,
  DriftReport,
  ChangeSet,
  ApplyPlan,
  ApplyResult,
  Health,
} from "@roost/shared";

import { hashContent, loadModuleBaseline } from "../sync-baseline.js";

const BREWFILE_ID = "Brewfile"; // legacy whole-Brewfile sentinel (back-compat)
const BREWFILE_PATH = "roost/Brewfile";

function brewfilePath(repoDir: string): string {
  return path.join(repoDir, "roost", "Brewfile");
}

// Per-package selection ids (ADR-0009): "brew:git", "cask:firefox",
// "mas:<id>", "tap:org/repo". Opaque strings stored in selection.yaml.
function splitId(id: string): { kind: string; val: string } | null {
  const i = id.indexOf(":");
  if (i < 0) return null;
  return { kind: id.slice(0, i), val: id.slice(i + 1) };
}

/**
 * Render a Brewfile from per-package selection ids. mas entries need a display
 * name (`mas "Name", id: N`); `masNames` maps id→name, falling back to the id.
 * Output is deterministic (sorted within each section) for idempotent captures.
 */
export function brewfileText(ids: string[], masNames?: Map<string, string>): string {
  const taps: string[] = [];
  const brews: string[] = [];
  const casks: string[] = [];
  const mas: string[] = [];
  for (const id of ids) {
    const s = splitId(id);
    if (!s) continue;
    if (s.kind === "tap") taps.push(`tap "${s.val}"`);
    else if (s.kind === "brew") brews.push(`brew "${s.val}"`);
    else if (s.kind === "cask") casks.push(`cask "${s.val}"`);
    else if (s.kind === "mas") mas.push(`mas "${masNames?.get(s.val) ?? s.val}", id: ${s.val}`);
  }
  const sections = [taps.sort(), brews.sort(), casks.sort(), mas.sort()].filter((s) => s.length > 0);
  return ["# Managed by Roost — generated from your package selection.", "", ...sections.flatMap((s) => [...s, ""])].join("\n");
}

// Re-query `mas list` to map app id → display name (for Brewfile lines).
async function masNameMap(ctx: ModuleContext): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const r = await ctx.exec.run("mas", ["list"]);
  if (r.code !== 0) return map;
  for (const line of r.stdout.split("\n")) {
    const m = /^(\d+)\s+(.+?)\s+\(/.exec(line.trim());
    if (m) map.set(m[1]!, m[2]!);
  }
  return map;
}

export interface BrewfileEntries {
  taps: string[];
  formulae: string[];
  casks: string[];
  mas: string[];
}

/**
 * Parse Brewfile text into grouped entries. Lines:
 *   tap "x"            → taps
 *   brew "x"           → formulae
 *   cask "x"           → casks
 *   mas "Name", id: N  → mas (the quoted name)
 * Comments (#) and blank lines are ignored.
 */
export function parseBrewfile(text: string): BrewfileEntries {
  const entries: BrewfileEntries = { taps: [], formulae: [], casks: [], mas: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const m = /^(tap|brew|cask|mas)\s+"([^"]+)"/.exec(line);
    if (!m) continue;
    const name = m[2]!;
    switch (m[1]) {
      case "tap": entries.taps.push(name); break;
      case "brew": entries.formulae.push(name); break;
      case "cask": entries.casks.push(name); break;
      case "mas": entries.mas.push(name); break;
    }
  }
  return entries;
}

export type PackageState = "installed" | "outdated" | "missing";

/**
 * Classify each per-package id as installed / outdated / missing by cross-
 * referencing `brew list` (presence) with `brew outdated` (update available).
 * `brew outdated` lines may carry version info (e.g. "git (2.47.1) < 2.50"), so
 * we key on the first whitespace-delimited token. tap/mas have no reliable
 * outdated signal here, so they're reported as "installed" when selected.
 */
export async function packageStates(ctx: ModuleContext, ids: string[]): Promise<Record<string, PackageState>> {
  const names = async (cmd: string, args: string[]): Promise<Set<string>> => {
    const r = await ctx.exec.run(cmd, args);
    return new Set(
      r.stdout
        .split("\n")
        .map((s) => s.trim().split(/\s/)[0] ?? "")
        .filter(Boolean),
    );
  };
  const [formulae, casks, outdatedF, outdatedC] = await Promise.all([
    names("brew", ["list", "--formula", "-1"]),
    names("brew", ["list", "--cask", "-1"]),
    names("brew", ["outdated", "--formula"]),
    names("brew", ["outdated", "--cask"]),
  ]);
  const out: Record<string, PackageState> = {};
  for (const id of ids) {
    const s = splitId(id);
    if (!s) continue;
    if (s.kind === "brew") {
      out[id] = !formulae.has(s.val) ? "missing" : outdatedF.has(s.val) ? "outdated" : "installed";
    } else if (s.kind === "cask") {
      out[id] = !casks.has(s.val) ? "missing" : outdatedC.has(s.val) ? "outdated" : "installed";
    } else {
      // tap / mas: no reliable outdated signal — treat as installed (in selection).
      out[id] = "installed";
    }
  }
  return out;
}

export const packagesModule: SyncModule = {
  name: "packages",

  async index(ctx: ModuleContext): Promise<import("@roost/shared").ModuleIndex> {
    const brew = await ctx.exec.run("brew", ["--version"]);
    let managed = 0;
    const file = brewfilePath(ctx.repoDir);
    if (fs.existsSync(file)) {
      managed = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => {
          const t = line.trim();
          return t.length > 0 && !t.startsWith("#");
        }).length;
    }
    return {
      available: brew.code === 0,
      reason: brew.code === 0 ? undefined : "Homebrew not installed",
      managed,
    };
  },

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const v = await ctx.exec.run("brew", ["--version"]);
    if (v.code !== 0) return [];
    const out: Candidate[] = [];
    const lines = async (cmd: string, args: string[]): Promise<string[]> => {
      const r = await ctx.exec.run(cmd, args);
      return r.code === 0 ? r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [];
    };
    // Top-level formulae (not pulled in only as dependencies).
    for (const name of await lines("brew", ["leaves"])) {
      out.push({ id: `brew:${name}`, path: BREWFILE_PATH, category: "packages", recommendation: "track", note: "formula" });
    }
    for (const name of await lines("brew", ["list", "--cask", "-1"])) {
      out.push({ id: `cask:${name}`, path: BREWFILE_PATH, category: "packages", recommendation: "track", note: "cask" });
    }
    for (const name of await lines("brew", ["tap"])) {
      out.push({ id: `tap:${name}`, path: BREWFILE_PATH, category: "packages", recommendation: "track", note: "tap" });
    }
    // mas: "<id> <Name> (<version>)" → id with the name surfaced in `note`.
    for (const line of await lines("mas", ["list"])) {
      const m = /^(\d+)\s+(.+?)\s+\(/.exec(line);
      if (m) out.push({ id: `mas:${m[1]}`, path: BREWFILE_PATH, category: "packages", recommendation: "track", note: `mas · ${m[2]}` });
    }
    return out;
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const ids = sel.modules["packages"] ?? [];
    const perPkg = ids.filter((id) => id !== BREWFILE_ID && id.includes(":"));

    // Per-package selection (ADR-0009): write a Brewfile with ONLY the chosen ones.
    if (perPkg.length > 0) {
      const masNames = perPkg.some((id) => id.startsWith("mas:")) ? await masNameMap(ctx) : undefined;
      fs.mkdirSync(path.dirname(brewfilePath(ctx.repoDir)), { recursive: true });
      fs.writeFileSync(brewfilePath(ctx.repoDir), `${brewfileText(perPkg, masNames)}\n`, "utf8");
      return { module: "packages", written: [BREWFILE_PATH], encrypted: [] };
    }

    // Back-compat: legacy whole-Brewfile sentinel → dump everything.
    if (!ids.includes(BREWFILE_ID)) {
      return { module: "packages", written: [], encrypted: [] };
    }
    const r = await ctx.exec.run("brew", ["bundle", "dump", "--force", "--file", brewfilePath(ctx.repoDir)]);
    if (r.code !== 0) {
      throw new Error(`brew bundle dump failed (code ${r.code}): ${r.stderr}`);
    }
    return { module: "packages", written: [BREWFILE_PATH], encrypted: [] };
  },

  async apply(ctx: ModuleContext, _plan: ApplyPlan): Promise<ApplyResult> {
    const filePath = brewfilePath(ctx.repoDir);
    if (ctx.dryRun) {
      await ctx.exec.run("brew", ["bundle", "check", "--file", filePath]);
      return { module: "packages", applied: [], backedUp: [], skipped: [BREWFILE_ID] };
    }
    const r = await ctx.exec.run("brew", ["bundle", "--file", filePath]);
    if (r.code !== 0) {
      throw new Error(`brew bundle failed (code ${r.code}): ${r.stderr}`);
    }
    return { module: "packages", applied: [BREWFILE_ID], backedUp: [], skipped: [] };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    // Unmanaged → cheap, no brew call (cold-path fix). Any package selection
    // (legacy sentinel or per-package ids) means the Brewfile is managed.
    const selected = (sel.modules["packages"] ?? []).length > 0;
    if (!selected) {
      return { module: "packages", items: [] };
    }
    const file = brewfilePath(ctx.repoDir);
    const repoContent = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const repoHash = hashContent(repoContent);
    const baseline = loadModuleBaseline(ctx.repoDir, "packages");
    const r = await ctx.exec.run("brew", ["bundle", "check", "--file", file]);
    const ok = r.code === 0;
    // Installing packages is purely additive — when the Brewfile is not satisfied
    // the resolution is always "install" (take-repo), so this is Behind, not a
    // two-sided conflict. localHash === repoHash when satisfied (synced).
    return {
      module: "packages",
      items: [
        {
          id: BREWFILE_ID,
          state: ok ? "synced" : "drift",
          localHash: ok ? repoHash : null,
          repoHash,
          baselineHash: baseline[BREWFILE_ID] ?? null,
        },
      ],
    };
  },

  async diff(ctx: ModuleContext, _sel: Selection): Promise<string> {
    const r = await ctx.exec.run("brew", [
      "bundle",
      "check",
      "--verbose",
      "--file",
      brewfilePath(ctx.repoDir),
    ]);
    if (r.code === 0) return "";
    // `brew bundle check` can't distinguish "missing" from "outdated" — both
    // print "needs to be installed or updated". Cross-reference `brew outdated`
    // to label each flagged package.
    const flagged = [...r.stdout.matchAll(/→ (?:Formula|Cask) (\S+) needs/g)].map((m) => m[1]!);
    if (flagged.length === 0) return r.stdout; // unexpected format → show raw
    const outdatedRes = await ctx.exec.run("brew", ["outdated"]);
    const outdated = new Set(
      outdatedRes.stdout.split("\n").map((s) => s.trim()).filter(Boolean),
    );
    return flagged
      .map((name) =>
        outdated.has(name)
          ? `${name} — outdated (update available)`
          : `${name} — missing (not installed)`,
      )
      .join("\n");
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const ids = sel.modules["packages"] ?? [];
    // Per-package removal: nothing to delete here — the Brewfile is regenerated
    // from the remaining selection on the next capture. No-op (not an error).
    if (ids.length > 0 && !ids.includes(BREWFILE_ID)) {
      return { module: "packages", applied: [], backedUp: [], skipped: ids };
    }
    const selected = ids.includes(BREWFILE_ID);
    if (!selected) {
      return { module: "packages", applied: [], backedUp: [], skipped: [] };
    }
    const filePath = brewfilePath(ctx.repoDir);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
      ctx.log.warn(
        "unmanage: items removed from the working tree but git history is NOT purged. " +
        "If any removed file ever contained secrets, rotate them now and purge git history " +
        "with `git filter-repo` or BFG Repo Cleaner.",
      );
      return { module: "packages", applied: [BREWFILE_ID], backedUp: [], skipped: [] };
    }
    return { module: "packages", applied: [], backedUp: [], skipped: [BREWFILE_ID] };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const brewResult = await ctx.exec.run("brew", ["--version"]);
    const masResult = await ctx.exec.run("mas", ["version"]);
    return [
      {
        name: "brew",
        ok: brewResult.code === 0,
        detail: brewResult.code === 0 ? undefined : "brew not found – install Homebrew first",
      },
      {
        name: "mas",
        ok: masResult.code === 0,
        detail:
          masResult.code === 0
            ? undefined
            : "mas not found (App Store apps need manual install)",
      },
    ];
  },
};
