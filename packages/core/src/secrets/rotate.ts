import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Exec } from "@roost/shared";
import { isNoise } from "../discovery/scan.js";
import { recipientFromKey } from "../env-crypto.js";

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

  for (let i = 0; i < ageFiles.length; i++) {
    const file = ageFiles[i]!;
    // Decrypted plaintext lives in os.tmpdir() — short-lived, never renamed.
    const tmpDecrypted = path.join(os.tmpdir(), `roost-rotate-dec-${process.pid}-${i}.tmp`);
    // Encrypted temp MUST be adjacent to the target (same directory = same filesystem)
    // so the final renameSync is always same-fs and never throws EXDEV.
    const tmpEncrypted = path.join(path.dirname(file), `.roost-rotate-${process.pid}-${i}.tmp`);

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

export interface RotateToNewKeyResult {
  recipient: string;
  rotated: string[];
  failed: { path: string; reason: string }[];
  swapped: boolean;
  backupPath?: string;
}

/**
 * Replace the active age key with a freshly generated one AND re-encrypt every
 * existing `.age` file in the repo to it. Safe ordering:
 *   1. generate the new key at `newKeyTmpPath`, derive its recipient
 *   2. re-encrypt all repo .age (old key decrypts → new recipient encrypts)
 *   3. ONLY if every file rotated, back up the old key and swap the new one in
 * If any file fails to rotate, nothing is swapped (old key stays active, new
 * key discarded) so encrypted data is never orphaned. Key material is never logged.
 */
export async function rotateToNewKey(
  exec: Exec,
  opts: { repoDir: string; keyPath: string; newKeyTmpPath: string; backupPath: string },
): Promise<RotateToNewKeyResult> {
  const { repoDir, keyPath, newKeyTmpPath, backupPath } = opts;

  fs.mkdirSync(path.dirname(newKeyTmpPath), { recursive: true });
  const gen = await exec.run("age-keygen", ["-o", newKeyTmpPath]);
  if (gen.code !== 0) throw new Error(gen.stderr || `age-keygen exited with code ${gen.code}`);

  const recipient = await recipientFromKey(exec, newKeyTmpPath);
  if (recipient === null) {
    try { fs.unlinkSync(newKeyTmpPath); } catch { /* ignore */ }
    throw new Error("could not derive recipient from the new age key");
  }

  const { rotated, failed } = await rotateAgeKey(exec, {
    repoDir,
    oldKeyPath: keyPath,
    newRecipient: recipient,
  });

  if (failed.length > 0) {
    // Abort the swap so already-encrypted files (still on the old key) stay readable.
    try { fs.unlinkSync(newKeyTmpPath); } catch { /* ignore */ }
    return { recipient, rotated, failed, swapped: false };
  }

  if (fs.existsSync(keyPath)) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.renameSync(keyPath, backupPath);
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.renameSync(newKeyTmpPath, keyPath);
  fs.chmodSync(keyPath, 0o600);
  return { recipient, rotated, failed, swapped: true, backupPath };
}
