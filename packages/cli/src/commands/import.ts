import type { ImportResult } from "@roost/core";
import {
  createDotfilesRepoImporter,
  createMackupImporter,
  detectImporters,
} from "@roost/core";

export interface ImportDeps {
  home: string;
  source: "dotfiles" | "mackup" | "auto";
  path?: string;
}

export async function runImport(deps: ImportDeps): Promise<ImportResult[]> {
  const { home, source } = deps;

  if (source === "auto") {
    const importers = detectImporters(home);
    return importers.map((importer) => importer.run());
  }

  if (source === "dotfiles") {
    if (!deps.path) {
      throw new Error("--path <dir> is required when --source dotfiles");
    }
    const importer = createDotfilesRepoImporter(deps.path);
    return [importer.run()];
  }

  // source === "mackup"
  const importer = createMackupImporter(home);
  return [importer.run()];
}
