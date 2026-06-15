// AI tools config module (ADR-0023): policy-driven capture of AI tool configs.
// Mechanics mirror dotfiles (chezmoi-backed); ownership of skills dirs stays
// with the skills module; skip-policy credentials are never backed up (I6).
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SyncModule,
  ModuleContext,
  Selection,
  Candidate,
  ChangeSet,
  DriftReport,
  ApplyPlan,
  ApplyResult,
  Health,
  BlockedItem,
} from "@roost/shared";
import { createChezmoi } from "../adapters/chezmoi.js";
import { loadAiToolsCatalog, aiPathPolicies } from "../ai-tools-catalog.js";
import { loadSelection } from "../selection.js";
import { ensureChezmoiAgeConfig } from "../chezmoi-config.js";
import { scanPathForSecrets } from "./dotfiles.js";

export const aitoolsModule: SyncModule = {
  name: "aitools",

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const cat = loadAiToolsCatalog(ctx.repoDir);
    const policies = aiPathPolicies(ctx.repoDir, ctx.home);
    const dotfilesSel = new Set(loadSelection(ctx.repoDir).modules["dotfiles"] ?? []);
    const out: Candidate[] = [];
    for (const tool of cat) {
      for (const p of tool.paths) {
        const abs = path.join(ctx.home, p.path);
        if (policies.get(abs) === "skip") continue;
        if (!fs.existsSync(abs)) continue;
        if (dotfilesSel.has(abs)) continue; // single owner: already under dotfiles
        const enc = policies.get(abs) === "encrypt";
        out.push({ id: abs, path: abs, category: p.kind, recommendation: enc ? "encrypt" : "track", note: `${tool.label} · ${p.kind}${enc ? " · encrypted" : ""}` });
      }
    }
    return out;
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const ids = sel.modules["aitools"] ?? [];
    const policies = aiPathPolicies(ctx.repoDir, ctx.home);
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const written: string[] = [];
    const encrypted: string[] = [];
    const blocked: string[] = [];
    const blockedDetail: BlockedItem[] = [];
    let ageReady: boolean | null = null;
    for (const id of ids) {
      const policy = policies.get(id) ?? "plain";
      if (policy === "skip") {
        blocked.push(id);
        blockedDetail.push({ id, reason: "managed", detail: "凭据 / 会话文件 — 永不备份" });
        continue;
      }
      if (!fs.existsSync(id)) continue;
      if (policy === "encrypt") {
        if (ageReady === null) ageReady = (await ensureChezmoiAgeConfig(ctx.exec, { home: ctx.home, repoDir: ctx.repoDir })).ready;
        if (!ageReady) { blocked.push(id); blockedDetail.push({ id, reason: "error", detail: "no age key" }); continue; }
        await chezmoi.add(id, { encrypt: true }); encrypted.push(id); continue;
      }
      // plain — scanner backstop (I6) unchanged
      const scan = scanPathForSecrets(id, { maxBytes: 100 * 1024 * 1024 });
      if (scan.secretFiles.length > 0) { blocked.push(id); blockedDetail.push({ id, reason: "secret", detail: `${scan.secretFiles.length} file(s)` }); continue; }
      await chezmoi.add(id, { encrypt: false }); written.push(id);
    }
    return { module: "aitools", written, encrypted, blocked, blockedDetail };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const ids = sel.modules["aitools"] ?? [];
    if (ids.length === 0) {
      return { module: "aitools", items: [] };
    }
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    let changedAbs: string[] | null = null;
    try {
      const rels = await chezmoi.changedPaths();
      changedAbs = rels.map((rel) => path.join(ctx.home, rel));
    } catch {
      changedAbs = null;
    }
    if (changedAbs === null) {
      const ok = await chezmoi.verify();
      return {
        module: "aitools",
        items: ids.map((id) => ({ id, state: ok ? "synced" : "drift" })),
      };
    }
    const changed = changedAbs;
    return {
      module: "aitools",
      items: ids.map((id) => {
        const isChanged = changed.some((abs) => abs === id || abs.startsWith(id + path.sep));
        return { id, state: isChanged ? "drift" : "synced" };
      }),
    };
  },

  async apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const paths = plan.actions.map((a) => a.target);
    if (paths.length > 0) {
      await chezmoi.apply({ dryRun: ctx.dryRun, paths });
    }
    return {
      module: "aitools",
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
    const ids = sel.modules["aitools"] ?? [];
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
    return { module: "aitools", applied, backedUp: [], skipped: [] };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const r = await ctx.exec.run("chezmoi", ["--version"]);
    return [
      {
        name: "chezmoi",
        ok: r.code === 0,
        detail: r.code === 0 ? undefined : "chezmoi not found",
        blocking: true,
      },
    ];
  },
};
