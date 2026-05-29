import * as path from "node:path";
import type { ModuleContext, Candidate, ChangeSet, DriftReport, ApplyResult, Selection } from "@roost/shared";
import { ModuleRegistry } from "./registry.js";
import { dotfilesModule } from "./modules/dotfiles.js";
import { packagesModule } from "./modules/packages.js";
import { appconfigModule } from "./modules/appconfig.js";
import { assertNoPlaintextSecrets } from "./secrets/scanner.js";
import { createChezmoi } from "./adapters/chezmoi.js";
import { backupFiles } from "./apply.js";

export function defaultRegistry(): ModuleRegistry {
  const reg = new ModuleRegistry();
  reg.register(dotfilesModule);
  reg.register(packagesModule);
  reg.register(appconfigModule);
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

    results.push({ ...result, backedUp: [...result.backedUp, ...backedUpFiles] });
  }

  return results;
}
