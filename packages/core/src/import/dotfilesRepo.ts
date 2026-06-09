import * as fs from "node:fs";
import * as path from "node:path";
import type { Candidate } from "@roost/shared";
import { isNoise } from "../discovery/scan.js";
import type { Importer, ImportResult } from "./index.js";

function walkDir(dir: string, depth: number, maxDepth: number): string[] {
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
      results.push(...walkDir(absPath, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      results.push(absPath);
    }
  }
  return results;
}

export function createDotfilesRepoImporter(repoPath: string): Importer {
  return {
    name: "dotfiles-repo",

    detect(): boolean {
      try {
        const stat = fs.statSync(repoPath);
        return stat.isDirectory();
      } catch {
        return false;
      }
    },

    run(): ImportResult {
      const filePaths = walkDir(repoPath, 0, 3);
      const candidates: Candidate[] = filePaths.map((absPath) => ({
        id: absPath,
        path: absPath,
        category: "dotfiles",
        recommendation: "track",
      }));
      return {
        source: repoPath,
        candidates,
        notes: [
          `Imported ${candidates.length} files from ${repoPath}; review before capturing`,
        ],
      };
    },
  };
}
