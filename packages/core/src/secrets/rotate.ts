import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Exec } from "@roost/shared";
import { isNoise } from "../discovery/scan.js";

// Walk repoDir recursively, yielding absolute paths of files ending in .age.
// Skips .git, node_modules, and any path isNoise() classifies as noise.
function walkAgeFiles(dir: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: string[] = [];
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    // Always skip .git and node_modules
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (isNoise(absPath)) continue;
    if (entry.isDirectory()) {
      results.push(...walkAgeFiles(absPath, depth + 1, maxDepth));
    } else if (entry.isFile() && entry.name.endsWith(".age")) {
      results.push(absPath);
    }
  }
  return results;
}

export interface RotateResult {
  rotated: string[];
  failed: { path: string; reason: string }[];
}

/**
 * Re-encrypt every .age file in repoDir to a new recipient.
 * Uses a write-to-temp-then-rename strategy so the original is never corrupted
 * on a partial failure.
 * Key material is never logged.
 */
export async function rotateAgeKey(
  exec: Exec,
  opts: { repoDir: string; oldKeyPath: string; newRecipient: string },
): Promise<RotateResult> {
  const { repoDir, oldKeyPath, newRecipient } = opts;
  const ageFiles = walkAgeFiles(repoDir, 0, 20);

  const rotated: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  for (const file of ageFiles) {
    // Allocate temp paths in the OS temp dir so they are on the same FS or at
    // least cleanly removable. We manage them manually to ensure cleanup.
    const tmpDecrypted = path.join(os.tmpdir(), `roost-rotate-dec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const tmpEncrypted = path.join(os.tmpdir(), `roost-rotate-enc-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      // Step 1: decrypt original → tmpDecrypted
      const decResult = await exec.run("age", ["-d", "-i", oldKeyPath, "-o", tmpDecrypted, file]);
      if (decResult.code !== 0) {
        const reason = decResult.stderr || `age -d exited with code ${decResult.code}`;
        failed.push({ path: file, reason });
        continue;
      }

      // Step 2: re-encrypt tmpDecrypted → tmpEncrypted (never write directly to file yet)
      const encResult = await exec.run("age", ["-r", newRecipient, "-o", tmpEncrypted, tmpDecrypted]);
      if (encResult.code !== 0) {
        const reason = encResult.stderr || `age -r exited with code ${encResult.code}`;
        failed.push({ path: file, reason });
        continue;
      }

      // Step 3: atomic replace — rename tmpEncrypted over the original
      fs.renameSync(tmpEncrypted, file);
      rotated.push(file);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ path: file, reason });
    } finally {
      // Always clean up temp files, ignore errors if they don't exist
      for (const tmp of [tmpDecrypted, tmpEncrypted]) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          // already gone or never created — fine
        }
      }
    }
  }

  return { rotated, failed };
}
