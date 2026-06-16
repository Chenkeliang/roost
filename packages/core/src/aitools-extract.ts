import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Exec } from "@roost/shared";
import { defaultAgeKeyPath, recipientFromKey } from "./env-crypto.js";

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

function slug(absPath: string): string {
  return absPath.replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function extractArtifactPath(repoDir: string, absPath: string): string {
  return path.join(repoDir, "aitools-extract", `${slug(absPath)}.json.age`);
}

// age-encrypt the extracted JSON to the artifact path. Plaintext only in tmpdir.
export async function writeExtractArtifact(
  exec: Exec,
  opts: { repoDir: string; absPath: string; home: string; json: Record<string, unknown> },
): Promise<void> {
  const recipient = await recipientFromKey(exec, defaultAgeKeyPath(opts.home));
  if (!recipient) throw new Error("no age key");
  const dest = extractArtifactPath(opts.repoDir, opts.absPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmpIn = path.join(
    os.tmpdir(),
    `roost-extract-${process.pid}-${slug(opts.absPath)}.tmp`,
  );
  try {
    fs.writeFileSync(tmpIn, JSON.stringify(opts.json, null, 2), { encoding: "utf8", mode: 0o600 });
    const r = await exec.run("age", ["-r", recipient, "-o", dest, tmpIn]);
    if (r.code !== 0) throw new Error(r.stderr || `age -r exited ${r.code}`);
  } finally {
    try {
      fs.unlinkSync(tmpIn);
    } catch {
      // already gone — fine
    }
  }
}

// Decrypt the artifact to a parsed object; null if missing / no key / parse fail.
export async function readExtractArtifact(
  exec: Exec,
  opts: { repoDir: string; absPath: string; home: string },
): Promise<Record<string, unknown> | null> {
  const src = extractArtifactPath(opts.repoDir, opts.absPath);
  const keyPath = defaultAgeKeyPath(opts.home);
  if (!fs.existsSync(src) || !fs.existsSync(keyPath)) return null;
  const r = await exec.run("age", ["-d", "-i", keyPath, src]);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}
