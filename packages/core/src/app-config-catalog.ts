import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

// A curated entry: an application and the FILE-based config paths it stores
// (home-relative; may contain globs). plist-based config is NOT here — that is
// the `appconfig` module's job (defaults export). See ADR-0007.
export interface CatalogApp {
  name: string;
  paths: string[];
  encryptRecommended?: boolean;
}

// Default curated catalog. Authored from PUBLIC path facts (informed by mature
// tools such as Mackup — facts, not copied; their files are GPLv3 and are NOT
// imported here). Only generic apps; zero personal/company paths (I8). macOS
// path conventions (I9). Keep paths PRECISE (config subdirs, not whole app dirs)
// so captures never slurp caches.
export const DEFAULT_APP_CONFIG_CATALOG: CatalogApp[] = [
  {
    name: "VS Code",
    paths: [
      "Library/Application Support/Code/User/settings.json",
      "Library/Application Support/Code/User/keybindings.json",
      "Library/Application Support/Code/User/snippets",
    ],
  },
  {
    name: "Cursor",
    paths: [
      "Library/Application Support/Cursor/User/settings.json",
      "Library/Application Support/Cursor/User/keybindings.json",
      "Library/Application Support/Cursor/User/snippets",
    ],
  },
  {
    // Covers all installed JetBrains IDEs/versions via the glob; only options &
    // keymaps (not caches/indexes). May contain DB connection config → encrypt.
    name: "JetBrains",
    paths: [
      "Library/Application Support/JetBrains/*/options",
      "Library/Application Support/JetBrains/*/keymaps",
    ],
    encryptRecommended: true,
  },
  { name: "Alacritty", paths: [".config/alacritty", ".alacritty.toml"] },
  { name: "Kitty", paths: [".config/kitty"] },
  { name: "WezTerm", paths: [".config/wezterm", ".wezterm.lua"] },
  { name: "Ghostty", paths: ["Library/Application Support/com.mitchellh.ghostty/config", ".config/ghostty"] },
];

function catalogOverridePath(repoDir: string): string {
  return path.join(repoDir, "roost", "app-config-catalog.yaml");
}

function parseOverride(raw: unknown): CatalogApp[] {
  if (typeof raw !== "object" || raw === null) return [];
  const apps = (raw as Record<string, unknown>)["apps"];
  if (!Array.isArray(apps)) return [];
  const out: CatalogApp[] = [];
  for (const a of apps) {
    if (typeof a !== "object" || a === null) continue;
    const obj = a as Record<string, unknown>;
    const name = obj["name"];
    const paths = obj["paths"];
    if (typeof name !== "string" || !Array.isArray(paths)) continue;
    const strPaths = paths.filter((p): p is string => typeof p === "string");
    if (strPaths.length === 0) continue;
    out.push({
      name,
      paths: strPaths,
      ...(obj["encryptRecommended"] === true ? { encryptRecommended: true } : {}),
    });
  }
  return out;
}

/**
 * Catalog = packaged default merged with the user's optional
 * `roost/app-config-catalog.yaml`. Merge is BY NAME with the user winning
 * (override an app's paths, or add new apps). See ADR-0007 §决议 Q2.
 */
export function loadAppConfigCatalog(repoDir: string): CatalogApp[] {
  const byName = new Map<string, CatalogApp>(DEFAULT_APP_CONFIG_CATALOG.map((a) => [a.name, a]));
  const file = catalogOverridePath(repoDir);
  if (fs.existsSync(file)) {
    try {
      for (const a of parseOverride(yaml.load(fs.readFileSync(file, "utf8")))) byName.set(a.name, a);
    } catch {
      /* malformed override → ignore, fall back to defaults */
    }
  }
  return [...byName.values()];
}

/**
 * Expand a home-relative path/glob to the set of EXISTING absolute paths.
 * Bounded by fs.globSync (existing matches only); literal paths resolve to
 * themselves if present. Used by dotfiles.discover for app-config candidates.
 */
export function expandCatalogPath(home: string, relPattern: string): string[] {
  try {
    return fs.globSync(relPattern, { cwd: home }).map((m) => path.join(home, m));
  } catch {
    return [];
  }
}
