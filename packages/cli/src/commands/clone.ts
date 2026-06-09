import * as fs from "node:fs";
import type { Exec, Logger } from "@roost/shared";
import { cloneRepo } from "@roost/core";

export interface CloneDeps {
  url: string;
  dest: string;
  exec: Exec;
  log: Logger;
}

// Second-machine step 1: clone the user's private config repo into the chezmoi
// source dir. Refuses to clobber a non-empty destination.
export async function runClone(deps: CloneDeps): Promise<{ ok: boolean; error?: string }> {
  const { url, dest, exec, log } = deps;

  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    const msg = `destination ${dest} already exists and is not empty`;
    log.error(msg);
    return { ok: false, error: msg };
  }

  log.info(`Cloning ${url} → ${dest}`);
  const res = await cloneRepo(exec, url, dest);
  if (res.ok) {
    log.info(`Cloned into ${dest}. Next: \`roost doctor\` then \`roost load\`.`);
  } else {
    log.error(`Clone failed: ${res.error}`);
  }
  return res;
}
