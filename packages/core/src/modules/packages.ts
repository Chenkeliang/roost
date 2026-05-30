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

const BREWFILE_ID = "Brewfile";
const BREWFILE_PATH = "roost/Brewfile";

function brewfilePath(repoDir: string): string {
  return path.join(repoDir, "roost", "Brewfile");
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
    const r = await ctx.exec.run("brew", ["--version"]);
    const note =
      r.code === 0
        ? "Homebrew + cask + mas software set"
        : "Homebrew not found – install it first";
    return [
      {
        id: BREWFILE_ID,
        path: BREWFILE_PATH,
        category: "packages",
        recommendation: "track",
        note,
      },
    ];
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const selected = (sel.modules["packages"] ?? []).includes(BREWFILE_ID);
    if (!selected) {
      return { module: "packages", written: [], encrypted: [] };
    }
    const r = await ctx.exec.run("brew", [
      "bundle",
      "dump",
      "--force",
      "--file",
      brewfilePath(ctx.repoDir),
    ]);
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
    // Unmanaged → cheap, no brew call (cold-path fix).
    const selected = (sel.modules["packages"] ?? []).includes(BREWFILE_ID);
    if (!selected) {
      return { module: "packages", items: [] };
    }
    const r = await ctx.exec.run("brew", [
      "bundle",
      "check",
      "--file",
      brewfilePath(ctx.repoDir),
    ]);
    return {
      module: "packages",
      items: [{ id: BREWFILE_ID, state: r.code === 0 ? "synced" : "drift" }],
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
    return r.code === 0 ? "" : r.stdout;
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const selected = (sel.modules["packages"] ?? []).includes(BREWFILE_ID);
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
