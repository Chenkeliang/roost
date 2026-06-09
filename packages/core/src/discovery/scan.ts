import * as fs from "node:fs";
import * as path from "node:path";

export interface ScanCandidate {
  path: string;
  sizeBytes: number;
  isDir: boolean;
}

const NOISE_BASENAMES = new Set(["node_modules", ".git", ".DS_Store", ".cache", "Caches"]);
const NOISE_PATH_SEGMENTS = ["Library/Caches", ".Trash"];

export function isNoise(absPath: string): boolean {
  const base = path.basename(absPath);

  // Exact basename matches
  if (NOISE_BASENAMES.has(base)) return true;

  // *.log files
  if (base.endsWith(".log")) return true;

  // Path segment checks
  const normalized = absPath.replace(/\\/g, "/");
  for (const seg of NOISE_PATH_SEGMENTS) {
    if (normalized.includes(`/${seg}/`) || normalized.endsWith(`/${seg}`)) return true;
  }

  // dot-prefixed basename ending with 'history' or '.bak'
  if (base.startsWith(".") && (base.endsWith("history") || base.endsWith(".bak"))) return true;

  return false;
}

export function scanDir(
  root: string,
  opts?: { maxEntries?: number },
): ScanCandidate[] {
  const maxEntries = opts?.maxEntries ?? 500;
  const results: ScanCandidate[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= maxEntries) break;
    const absPath = path.join(root, entry.name);
    if (isNoise(absPath)) continue;

    try {
      const stat = fs.statSync(absPath);
      results.push({
        path: absPath,
        sizeBytes: stat.size,
        isDir: entry.isDirectory(),
      });
    } catch {
      // Skip unreadable entries
    }
  }

  return results;
}
