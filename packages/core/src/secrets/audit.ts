import * as fs from "node:fs";
import * as path from "node:path";
import { isNoise } from "../discovery/scan.js";
import { scanForSecrets } from "./scanner.js";

export interface AuditFinding {
  path: string;
  rule: string;
}

export interface AuditReport {
  encryptedFiles: number;
  scannedFiles: number;
  plaintextFindings: AuditFinding[];
  ok: boolean;
}

const MAX_SCAN_BYTES = 1024 * 1024; // 1 MiB — skip larger files

function isEncrypted(filePath: string, content: string): boolean {
  if (filePath.endsWith(".age")) return true;
  // age encryption header
  if (content.startsWith("age-encryption.org/v1")) return true;
  // sops header (common patterns)
  if (content.startsWith("SOPS-encrypted") || content.startsWith("sops:")) return true;
  return false;
}

function looksLikeBinary(buf: Buffer): boolean {
  // Simple heuristic: check for null bytes in first 512 bytes
  const sample = buf.subarray(0, 512);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

function walkRepo(dir: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (isNoise(absPath)) continue;
    if (entry.isDirectory()) {
      results.push(...walkRepo(absPath, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      results.push(absPath);
    }
  }
  return results;
}

export function auditRepo(repoDir: string): AuditReport {
  const filePaths = walkRepo(repoDir, 0, 10);
  const plaintextFindings: AuditFinding[] = [];
  let encryptedFiles = 0;
  let scannedFiles = 0;

  for (const filePath of filePaths) {
    let buf: Buffer;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_SCAN_BYTES) continue;
      buf = fs.readFileSync(filePath);
    } catch {
      continue;
    }

    if (looksLikeBinary(buf)) continue;

    const content = buf.toString("utf8");
    if (isEncrypted(filePath, content)) {
      encryptedFiles++;
      continue;
    }

    scannedFiles++;
    const findings = scanForSecrets(content);
    for (const finding of findings) {
      plaintextFindings.push({ path: filePath, rule: finding.rule });
    }
  }

  return {
    encryptedFiles,
    scannedFiles,
    plaintextFindings,
    ok: plaintextFindings.length === 0,
  };
}
