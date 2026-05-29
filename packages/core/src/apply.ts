import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Copy each existing target file into backupDir, preserving relative structure
 * to avoid basename collisions (e.g. /a/foo and /b/foo go to different subdirs).
 * Mirrors the absolute path under backupDir by stripping the leading '/'.
 * backupDir itself is created (mkdir -p) if absent.
 * Returns the list of source paths actually backed up (nonexistent targets are skipped).
 */
export function backupFiles(targets: string[], backupDir: string): string[] {
  const backedUp: string[] = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    // Strip leading separator and mirror the full path under backupDir
    const relative = target.replace(/^[/\\]/, "");
    const dest = path.join(backupDir, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(target, dest);
    backedUp.push(target);
  }
  return backedUp;
}
