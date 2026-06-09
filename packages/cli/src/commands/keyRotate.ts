import type { Exec } from "@roost/shared";
import { rotateAgeKey } from "@roost/core";

export interface KeyRotateDeps {
  exec: Exec;
  repoDir: string;
  oldKeyPath: string;
  newRecipient: string;
  log: (msg: string) => void;
}

export async function runKeyRotate(deps: KeyRotateDeps): Promise<void> {
  const { exec, repoDir, oldKeyPath, newRecipient, log } = deps;

  const result = await rotateAgeKey(exec, { repoDir, oldKeyPath, newRecipient });

  log(`${result.rotated.length} file(s) rotated.`);

  if (result.failed.length > 0) {
    log(`Failed ${result.failed.length} file(s):`);
    for (const f of result.failed) {
      log(`  ${f.path}`);
    }
  }
}
