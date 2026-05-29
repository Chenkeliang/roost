import * as fs from "node:fs";
import type { ModuleContext, ChangeSet } from "@roost/shared";
import {
  defaultRegistry,
  captureAll,
  gateSecrets,
  loadSelection,
  commitRepo,
  isSensitivePath,
} from "@roost/core";

export interface CaptureDeps {
  repoDir: string;
  ctx: ModuleContext;
}

export async function runCapture(deps: CaptureDeps): Promise<ChangeSet[]> {
  const { repoDir, ctx } = deps;

  const reg = defaultRegistry();
  const sel = loadSelection(repoDir);

  const changeSets = await captureAll(reg, ctx, sel);

  // Gate secrets: read each non-sensitive selected dotfile and check for secrets
  const dotfileIds = sel.modules["dotfiles"] ?? [];
  const toCheck: { path: string; content: string }[] = [];
  for (const id of dotfileIds) {
    if (isSensitivePath(id)) continue;
    if (!fs.existsSync(id)) continue;
    const content = fs.readFileSync(id, "utf8");
    toCheck.push({ path: id, content });
  }
  gateSecrets(toCheck);

  await commitRepo(ctx.exec, repoDir, "roost: capture");

  return changeSets;
}
