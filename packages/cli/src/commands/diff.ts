import type { ModuleContext } from "@roost/shared";
import { defaultRegistry, loadSelection } from "@roost/core";

export interface DiffDeps {
  repoDir: string;
  ctx: ModuleContext;
}

export async function runDiff(deps: DiffDeps): Promise<string[]> {
  const { repoDir, ctx } = deps;

  const reg = defaultRegistry();
  const sel = loadSelection(repoDir);

  const diffs: string[] = [];
  for (const mod of reg.list()) {
    const output = await mod.diff(ctx, sel);
    if (output.trim().length > 0) {
      ctx.log.info(`[${mod.name}]\n${output}`);
    } else {
      ctx.log.info(`[${mod.name}] no diff`);
    }
    diffs.push(output);
  }

  return diffs;
}
