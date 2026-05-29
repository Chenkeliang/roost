import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Copy each existing target file into backupDir, preserving basename.
 * backupDir is created (mkdir -p) if absent.
 * Returns the list of files actually backed up (nonexistent targets are skipped).
 */
export function backupFiles(targets: string[], backupDir: string): string[] {
  fs.mkdirSync(backupDir, { recursive: true });
  const backedUp: string[] = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    const dest = path.join(backupDir, path.basename(target));
    fs.copyFileSync(target, dest);
    backedUp.push(target);
  }
  return backedUp;
}
