import * as fs from "node:fs";
import * as path from "node:path";
import type { Exec } from "@roost/shared";
import type { SecretBackend } from "./backend.js";

export interface AgeKeyResult {
  path: string;
  created: boolean;
  source: "existing" | "backend" | "generated";
}

export async function ensureAgeKey(
  exec: Exec,
  opts: {
    keyPath: string;
    backend?: SecretBackend;
    backendRef?: string;
  },
): Promise<AgeKeyResult> {
  const { keyPath, backend, backendRef } = opts;

  // If key already exists, return immediately
  if (fs.existsSync(keyPath)) {
    return { path: keyPath, created: false, source: "existing" };
  }

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });

  if (backend !== undefined) {
    if (!backendRef) {
      throw new Error("backendRef is required when backend is provided");
    }
    const secret = await backend.get(backendRef);
    fs.writeFileSync(keyPath, secret, { encoding: "utf8", mode: 0o600 });
    // Explicitly set mode in case umask affected writeFileSync
    fs.chmodSync(keyPath, 0o600);
    return { path: keyPath, created: true, source: "backend" };
  }

  // Generate via age-keygen
  const r = await exec.run("age-keygen", ["-o", keyPath]);
  if (r.code !== 0) {
    throw new Error(r.stderr || `age-keygen exited with code ${r.code}`);
  }
  fs.chmodSync(keyPath, 0o600);
  return { path: keyPath, created: true, source: "generated" };
}
