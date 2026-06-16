import * as path from "node:path";
import type { Exec } from "@roost/shared";
import {
  defaultAgeKeyPath,
  recipientFromKey,
  encryptEnvSecret,
  decryptEnvSecret,
} from "./env-crypto.js";

// Shallow allowlist: keep only the named top-level fields of a parsed object.
export function pickFields(obj: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    for (const f of fields) if (f in o) out[f] = o[f];
  }
  return out;
}

// Set ONLY the named fields from `picked` onto a copy of `live`; everything else
// (incl. credentials) preserved. Absent picked fields leave live's value as-is.
export function mergeFields(
  live: Record<string, unknown>,
  picked: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...live };
  for (const f of fields) if (f in picked) out[f] = picked[f];
  return out;
}

// Artifact path is home-independent: uses <toolId>__<basename> as the key, so the
// artifact survives a move to a new Mac with a different username/homedir, while the
// toolId discriminator prevents basename collisions (e.g. two tools' mcp.json or
// mcp_config.json mapping to the same artifact). Format: repo/aitools-extract/<toolId>__<basename>.json.age
export function extractArtifactPath(repoDir: string, toolId: string, absPath: string): string {
  return path.join(repoDir, "aitools-extract", `${toolId}__${path.basename(absPath)}.json.age`);
}

// age-encrypt the extracted JSON to the artifact path, delegating to encryptEnvSecret.
// Plaintext only in tmpdir (handled by encryptEnvSecret).
export async function writeExtractArtifact(
  exec: Exec,
  opts: { repoDir: string; toolId: string; absPath: string; home: string; json: Record<string, unknown> },
): Promise<void> {
  const recipient = await recipientFromKey(exec, defaultAgeKeyPath(opts.home));
  if (!recipient) throw new Error("no age key");
  const dest = extractArtifactPath(opts.repoDir, opts.toolId, opts.absPath);
  const name = `aitools-extract-${opts.toolId}__${path.basename(opts.absPath)}`;
  await encryptEnvSecret(exec, {
    repoDir: opts.repoDir,
    name,
    plaintext: JSON.stringify(opts.json, null, 2),
    recipient,
    dest,
  });
}

// Decrypt the artifact to a parsed object; null if missing / no key / parse fail.
// Delegates to decryptEnvSecret.
export async function readExtractArtifact(
  exec: Exec,
  opts: { repoDir: string; toolId: string; absPath: string; home: string },
): Promise<Record<string, unknown> | null> {
  const src = extractArtifactPath(opts.repoDir, opts.toolId, opts.absPath);
  const keyPath = defaultAgeKeyPath(opts.home);
  const name = `aitools-extract-${opts.toolId}__${path.basename(opts.absPath)}`;
  const plaintext = await decryptEnvSecret(exec, {
    repoDir: opts.repoDir,
    name,
    keyPath,
    src,
  });
  if (plaintext === null) return null;
  try {
    return JSON.parse(plaintext) as Record<string, unknown>;
  } catch {
    return null;
  }
}
