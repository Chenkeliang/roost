import * as path from "node:path";
import * as os from "node:os";
import type { ModuleContext, Candidate, ChangeSet, DriftReport, ApplyResult, Selection, ModuleIndex } from "@roost/shared";
import { ModuleRegistry } from "./registry.js";
import { recordModuleBaseline } from "./sync-baseline.js";
import type { ModuleBaseline } from "./state.js";
import { dotfilesModule } from "./modules/dotfiles.js";
import { packagesModule } from "./modules/packages.js";
import { appconfigModule } from "./modules/appconfig.js";
import { projectsModule } from "./modules/projects.js";
import { envModule } from "./modules/env.js";
import { skillsModule } from "./modules/skills.js";
import { assertNoPlaintextSecrets } from "./secrets/scanner.js";
import { createChezmoi } from "./adapters/chezmoi.js";
import { backupFiles } from "./apply.js";
import { computeSyncState } from "./sync-state.js";
import type { SyncStateReport } from "./sync-state.js";

export function defaultRegistry(): ModuleRegistry {
  const reg = new ModuleRegistry();
  reg.register(dotfilesModule);
  reg.register(packagesModule);
  reg.register(appconfigModule);
  reg.register(projectsModule);
  reg.register(envModule);
  reg.register(skillsModule);
  return reg;
}

export async function discoverAll(
  reg: ModuleRegistry,
  ctx: ModuleContext,
): Promise<Record<string, Candidate[]>> {
  const result: Record<string, Candidate[]> = {};
  for (const mod of reg.list()) {
    result[mod.name] = await mod.discover(ctx);
  }
  return result;
}

export async function indexAll(
  reg: ModuleRegistry,
  ctx: ModuleContext,
): Promise<Record<string, ModuleIndex>> {
  const out: Record<string, ModuleIndex> = {};
  for (const m of reg.list()) {
    if (typeof m.index === "function") {
      out[m.name] = await m.index(ctx);
    }
  }
  return out;
}

export async function captureAll(
  reg: ModuleRegistry,
  ctx: ModuleContext,
  sel: Selection,
): Promise<ChangeSet[]> {
  const changeSets: ChangeSet[] = [];
  for (const mod of reg.list()) {
    const ids = sel.modules[mod.name];
    if (!ids || ids.length === 0) continue;
    const cs = await mod.capture(ctx, sel);
    changeSets.push(cs);
  }
  return changeSets;
}

export function gateSecrets(written: { path: string; content: string }[]): void {
  assertNoPlaintextSecrets(written);
}

export async function statusAll(
  reg: ModuleRegistry,
  ctx: ModuleContext,
  sel: Selection,
): Promise<DriftReport[]> {
  const reports: DriftReport[] = [];
  for (const mod of reg.list()) {
    const report = await mod.status(ctx, sel);
    reports.push(report);
  }
  return reports;
}

// Aggregate every module's status into the sync-state review model (ADR-0016).
// Thin wrapper: statusAll already runs each module; computeSyncState is pure.
export async function syncStateAll(
  reg: ModuleRegistry,
  ctx: ModuleContext,
  sel: Selection,
): Promise<SyncStateReport> {
  const reports = await statusAll(reg, ctx, sel);
  return computeSyncState(reports);
}

export async function loadAll(
  reg: ModuleRegistry,
  ctx: ModuleContext,
  sel: Selection,
  opts: { dryRun: boolean; backupDir: string },
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const mod of reg.list()) {
    const ids = sel.modules[mod.name] ?? [];
    const actions = ids.map((id) => ({ id, kind: "update" as const, target: id }));
    const plan = { module: mod.name, actions };

    let backedUpFiles: string[] = [];

    if (!opts.dryRun && mod.name === "dotfiles") {
      const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
      const managedRels = await chezmoi.managed();
      const managedAbsolute = managedRels.map((rel) => path.join(ctx.home, rel));
      backedUpFiles = backupFiles(managedAbsolute, opts.backupDir);
    }

    const modCtx: ModuleContext = { ...ctx, dryRun: opts.dryRun };
    const result = await mod.apply(modCtx, plan);

    // After a REAL apply, persist the baseline so the next status() can tell
    // Ahead from Behind (ADR-0016/0018). Items now in sync (local == repo) define
    // the baseline; modules that don't emit hashes simply record nothing.
    if (!opts.dryRun) {
      await recordSyncBaseline(mod, modCtx, sel, ctx.repoDir);
    }

    results.push({ ...result, backedUp: [...result.backedUp, ...backedUpFiles] });
  }

  return results;
}

// Re-read a module's status post-apply and record baseline hashes for items that
// are now synced (localHash === repoHash). No-op for modules without hashes.
async function recordSyncBaseline(
  mod: { name: string; status: (ctx: ModuleContext, sel: Selection) => Promise<DriftReport> },
  modCtx: ModuleContext,
  sel: Selection,
  repoDir: string,
): Promise<void> {
  const report = await mod.status(modCtx, sel);
  const baseline: ModuleBaseline = {};
  for (const item of report.items) {
    if (item.localHash != null && item.localHash === item.repoHash) {
      baseline[item.id] = item.localHash;
    }
  }
  if (Object.keys(baseline).length === 0) return;
  recordModuleBaseline(repoDir, os.hostname(), mod.name, baseline, {
    lastSeen: new Date().toISOString(),
  });
}
