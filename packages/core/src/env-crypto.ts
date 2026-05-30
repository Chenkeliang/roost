import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Exec } from "@roost/shared";

/**
 * Default age identity path used across Roost (matches the web/health check path).
 */
export function defaultAgeKeyPath(home: string): string {
  return path.join(home, ".config", "sops", "age", "keys.txt");
}

export function envSecretsDir(repoDir: string): string {
  return path.join(repoDir, "roost", "env-secrets");
}

export function envSecretPath(repoDir: string, name: string): string {
  return path.join(envSecretsDir(repoDir), `${name}.age`);
}

/**
 * Derive the age recipient (public key) from an age identity file via `age-keygen -y`.
 * Returns null if the key file is absent or the command fails. Key material is never logged.
 */
export async function recipientFromKey(exec: Exec, keyPath: string): Promise<string | null> {
  if (!fs.existsSync(keyPath)) return null;
  const r = await exec.run("age-keygen", ["-y", keyPath]);
  if (r.code !== 0) return null;
  const recipient = r.stdout.trim();
  return recipient.length > 0 ? recipient : null;
}

/**
 * Encrypt `plaintext` to `roost/env-secrets/<name>.age` using the given recipient.
 * Writes via a temp file in os.tmpdir() so plaintext never lands next to the repo.
 * Returns the ciphertext path. Throws with a clear message on failure.
 */
export async function encryptEnvSecret(
  exec: Exec,
  opts: { repoDir: string; name: string; plaintext: string; recipient: string },
): Promise<string> {
  const { repoDir, name, plaintext, recipient } = opts;
  const dest = envSecretPath(repoDir, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  // Plaintext lives only in os.tmpdir(), short-lived, removed in finally.
  const tmpIn = path.join(os.tmpdir(), `roost-env-enc-${process.pid}-${name}.tmp`);
  try {
    fs.writeFileSync(tmpIn, plaintext, { encoding: "utf8", mode: 0o600 });
    const r = await exec.run("age", ["-r", recipient, "-o", dest, tmpIn]);
    if (r.code !== 0) {
      throw new Error(r.stderr || `age -r exited with code ${r.code}`);
    }
    return dest;
  } finally {
    try {
      fs.unlinkSync(tmpIn);
    } catch {
      // already gone — fine
    }
  }
}

/**
 * Decrypt `roost/env-secrets/<name>.age` to plaintext using the age identity at keyPath.
 * Returns null if the ciphertext is missing or decryption fails. Plaintext is returned to
 * the caller and never written to disk here.
 */
export async function decryptEnvSecret(
  exec: Exec,
  opts: { repoDir: string; name: string; keyPath: string },
): Promise<string | null> {
  const { repoDir, name, keyPath } = opts;
  const src = envSecretPath(repoDir, name);
  if (!fs.existsSync(src) || !fs.existsSync(keyPath)) return null;
  const r = await exec.run("age", ["-d", "-i", keyPath, src]);
  if (r.code !== 0) return null;
  return r.stdout;
}
