import type { ModuleContext, DriftReport } from "@roost/shared";
import { defaultRegistry, statusAll, loadSelection } from "@roost/core";

export interface ListDeps {
  repoDir: string;
  ctx: ModuleContext;
}

export async function runList(deps: ListDeps): Promise<DriftReport[]> {
  const { repoDir, ctx } = deps;

  const reg = defaultRegistry();
  const sel = loadSelection(repoDir);

  const reports = await statusAll(reg, ctx, sel);

  for (const report of reports) {
    const ids = sel.modules[report.module] ?? [];
    ctx.log.info(`[${report.module}] selected: ${ids.length} items`);
    for (const item of report.items) {
      ctx.log.info(`  ${item.id}: ${item.state}${item.detail ? ` (${item.detail})` : ""}`);
    }
  }

  return reports;
}
