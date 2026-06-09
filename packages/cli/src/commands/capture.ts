import * as fs from "node:fs";
import type { ModuleContext, ChangeSet } from "@roost/shared";
import {
  defaultRegistry,
  captureAll,
  gateSecrets,
  loadSelection,
  isSensitivePath,
} from "@roost/core";
import { finalizeCapture } from "../captureFlow.js";

export interface CaptureDeps {
  repoDir: string;
  ctx: ModuleContext;
}

export async function runCapture(deps: CaptureDeps): Promise<ChangeSet[]> {
  const { repoDir, ctx } = deps;

  const reg = defaultRegistry();
  const sel = loadSelection(repoDir);

  // Gate secrets BEFORE capture: read each non-sensitive selected dotfile and check
  const dotfileIds = sel.modules["dotfiles"] ?? [];
  const toCheck: { path: string; content: string }[] = [];
  for (const id of dotfileIds) {
    if (isSensitivePath(id)) continue;
    if (!fs.existsSync(id)) continue;
    const content = fs.readFileSync(id, "utf8");
    toCheck.push({ path: id, content });
  }
  gateSecrets(toCheck); // throws if a secret is found — nothing captured yet

  const changeSets = await captureAll(reg, ctx, sel);

  await finalizeCapture(ctx.exec, repoDir, ctx.home);

  return changeSets;
}
