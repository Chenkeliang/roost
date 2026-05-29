import type { ModuleContext, DriftReport } from "@roost/shared";
import { defaultRegistry, statusAll, loadSelection } from "@roost/core";

export interface StatusDeps {
  repoDir: string;
  ctx: ModuleContext;
}

export async function runStatus(deps: StatusDeps): Promise<DriftReport[]> {
  const { repoDir, ctx } = deps;

  const reg = defaultRegistry();
  const sel = loadSelection(repoDir);

  const reports = await statusAll(reg, ctx, sel);

  for (const report of reports) {
    ctx.log.info(`[${report.module}]`);
    for (const item of report.items) {
      ctx.log.info(`  ${item.state.padEnd(9)} ${item.id}${item.detail ? ` — ${item.detail}` : ""}`);
    }
  }

  return reports;
}
