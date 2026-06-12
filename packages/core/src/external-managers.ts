import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

// ADR-0022: registry of known external skill managers — prettifies labels for
// symlinks that originate outside Roost's source dir. Zero personal paths (I8).
export interface ExternalManager {
  id: string;
  label: string;
  roots: string[]; // home-relative root dirs that belong to this manager
}

export const DEFAULT_EXTERNAL_MANAGERS: ExternalManager[] = [
  { id: "cc-switch", label: "cc-switch", roots: [".cc-switch"] },
];

function parseOverride(raw: unknown): ExternalManager[] {
  if (typeof raw !== "object" || raw === null) return [];
  const managers = (raw as Record<string, unknown>)["managers"];
  if (!Array.isArray(managers)) return [];
  const out: ExternalManager[] = [];
  for (const m of managers) {
    if (typeof m !== "object" || m === null) continue;
    const obj = m as Record<string, unknown>;
    const id = obj["id"];
    const label = obj["label"];
    const roots = obj["roots"];
    if (typeof id !== "string" || typeof label !== "string" || !Array.isArray(roots)) continue;
    const parsedRoots: string[] = [];
    for (const r of roots) {
      if (typeof r === "string") parsedRoots.push(r);
    }
    if (parsedRoots.length === 0) continue;
    out.push({ id, label, roots: parsedRoots });
  }
  return out;
}

/**
 * Managers = packaged default merged with the user's optional
 * `roost/external-managers.yaml`. Merge is BY ID with the user winning.
 * Malformed override → fall back to defaults.
 */
export function loadExternalManagers(repoDir: string): ExternalManager[] {
  const byId = new Map<string, ExternalManager>(
    DEFAULT_EXTERNAL_MANAGERS.map((m) => [m.id, m]),
  );
  const file = path.join(repoDir, "roost", "external-managers.yaml");
  if (fs.existsSync(file)) {
    try {
      for (const m of parseOverride(yaml.load(fs.readFileSync(file, "utf8")))) {
        byId.set(m.id, m);
      }
    } catch {
      /* malformed override → fall back to defaults */
      return [...new Map(DEFAULT_EXTERNAL_MANAGERS.map((m) => [m.id, m])).values()];
    }
  }
  return [...byId.values()];
}
