import * as fs from "node:fs";
import * as path from "node:path";
import type { Candidate } from "@roost/shared";
import type { Importer, ImportResult } from "./index.js";

/** Parse a simple INI file into a map of section -> lines */
function parseIni(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      current = sectionMatch[1]!;
      if (!sections.has(current)) sections.set(current, []);
    } else if (current) {
      sections.get(current)!.push(line);
    }
  }
  return sections;
}

export function createMackupImporter(home: string): Importer {
  const cfgFile = path.join(home, ".mackup.cfg");
  const mackupDir = path.join(home, ".mackup");

  return {
    name: "mackup",

    detect(): boolean {
      if (fs.existsSync(cfgFile)) return true;
      try {
        return fs.statSync(mackupDir).isDirectory();
      } catch {
        return false;
      }
    },

    run(): ImportResult {
      const candidates: Candidate[] = [];
      const notes: string[] = [];

      // Parse apps from .mackup.cfg
      let syncedApps: string[] = [];
      if (fs.existsSync(cfgFile)) {
        const content = fs.readFileSync(cfgFile, "utf8");
        const ini = parseIni(content);
        syncedApps = ini.get("applications_to_sync") ?? [];
      }

      if (syncedApps.length > 0) {
        notes.push(
          `mackup syncs apps: ${syncedApps.join(", ")} — their config locations come from mackup's built-in registry; use \`roost app learn\` or discovery to capture them`,
        );
      }

      // Parse custom .mackup/*.cfg files for concrete paths
      const customCfgPaths: string[] = [];
      if (fs.existsSync(mackupDir)) {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(mackupDir, { withFileTypes: true });
        } catch {
          entries = [];
        }
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".cfg")) continue;
          const cfgPath = path.join(mackupDir, entry.name);
          const appName = path.basename(entry.name, ".cfg");
          const content = fs.readFileSync(cfgPath, "utf8");
          const ini = parseIni(content);
          const configFiles = ini.get("configuration_files") ?? [];
          if (configFiles.length > 0) {
            customCfgPaths.push(appName);
            for (const rel of configFiles) {
              const absPath = path.join(home, rel);
              candidates.push({
                id: absPath,
                path: absPath,
                category: "dotfiles",
                recommendation: "track",
              });
            }
          }
        }
      }

      if (customCfgPaths.length > 0) {
        notes.push(
          `Custom mackup app definitions (${customCfgPaths.join(", ")}) provided concrete paths — imported as candidates`,
        );
      }

      return { source: "mackup", candidates, notes };
    },
  };
}
