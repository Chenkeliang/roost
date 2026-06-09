import * as fs from "node:fs";
import * as path from "node:path";

// A path is copyable for backup if it is a regular file, a directory, or a
// symlink. Sockets / FIFOs / devices cannot be copied (copyfile → ENOTSUP) and
// are not user data worth preserving, so they are skipped.
function isCopyable(p: string): boolean {
  try {
    const s = fs.lstatSync(p);
    return s.isFile() || s.isDirectory() || s.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Copy each existing target into backupDir, preserving relative structure to
 * avoid basename collisions (e.g. /a/foo and /b/foo go to different subdirs).
 * Mirrors the absolute path under backupDir by stripping the leading '/'.
 * - Regular files are copied.
 * - Directories are copied recursively, skipping any non-copyable entries
 *   (e.g. a socket inside the dir) so one odd file can't fail the whole backup.
 * - Symlinks are recreated as links (not dereferenced).
 * - Sockets / FIFOs / devices are skipped.
 * Returns the list of source paths actually backed up.
 */
export function backupFiles(targets: string[], backupDir: string): string[] {
  const backedUp: string[] = [];
  for (const target of targets) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(target);
    } catch {
      continue; // nonexistent target → skip
    }
    const relative = target.replace(/^[/\\]/, "");
    const dest = path.join(backupDir, relative);

    if (st.isSymbolicLink()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.symlinkSync(fs.readlinkSync(target), dest);
        backedUp.push(target);
      } catch {
        // best-effort: a broken/duplicate link is not worth failing the backup
      }
      continue;
    }
    if (st.isDirectory()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(target, dest, { recursive: true, dereference: false, filter: isCopyable });
      backedUp.push(target);
      continue;
    }
    if (st.isFile()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(target, dest);
      backedUp.push(target);
      continue;
    }
    // socket / FIFO / device → cannot back up, skip silently.
  }
  return backedUp;
}
