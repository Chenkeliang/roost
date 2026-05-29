import * as path from "node:path";
import type { ModuleContext, ApplyResult } from "@roost/shared";
import { defaultRegistry, loadAll, loadSelection } from "@roost/core";

export interface LoadDeps {
  repoDir: string;
  ctx: ModuleContext;
  apply?: boolean;
}

export async function runLoad(deps: LoadDeps): Promise<ApplyResult[]> {
  const { repoDir, ctx, apply = false } = deps;

  const dryRun = !apply;
  const backupDir = path.join(ctx.home, ".roost-backups", "load");

  const reg = defaultRegistry();
  const sel = loadSelection(repoDir);

  const results = await loadAll(reg, ctx, sel, { dryRun, backupDir });

  // Print summary
  for (const r of results) {
    if (r.applied.length > 0) ctx.log.info(`[${r.module}] applied: ${r.applied.join(", ")}`);
    if (r.skipped.length > 0) ctx.log.info(`[${r.module}] skipped (dry-run): ${r.skipped.join(", ")}`);
    if (r.backedUp.length > 0) ctx.log.info(`[${r.module}] backed up: ${r.backedUp.join(", ")}`);
  }

  return results;
}
