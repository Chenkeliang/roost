import * as path from "path";
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

export const packagesModule: SyncModule = {
  name: "packages",

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

  async status(ctx: ModuleContext, _sel: Selection): Promise<DriftReport> {
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

  async unmanage(_ctx: ModuleContext, _sel: Selection): Promise<ApplyResult> {
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
