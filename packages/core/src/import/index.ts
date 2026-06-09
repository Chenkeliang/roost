import * as fs from "node:fs";
import * as path from "node:path";
import type { Candidate } from "@roost/shared";
import { createDotfilesRepoImporter } from "./dotfilesRepo.js";
import { createMackupImporter } from "./mackup.js";

export interface ImportResult {
  source: string;
  candidates: Candidate[];
  notes: string[];
}

export interface Importer {
  name: string;
  detect(): boolean;
  run(): ImportResult;
}

export { createDotfilesRepoImporter } from "./dotfilesRepo.js";
export { createMackupImporter } from "./mackup.js";

export function detectImporters(home: string): Importer[] {
  const detected: Importer[] = [];

  const mackup = createMackupImporter(home);
  if (mackup.detect()) detected.push(mackup);

  // Conventional dotfiles repo locations
  for (const name of ["dotfiles", ".dotfiles"]) {
    const repoPath = path.join(home, name);
    if (fs.existsSync(repoPath)) {
      try {
        if (fs.statSync(repoPath).isDirectory()) {
          const importer = createDotfilesRepoImporter(repoPath);
          detected.push(importer);
          break; // use first one found
        }
      } catch {
        // skip
      }
    }
  }

  return detected;
}
