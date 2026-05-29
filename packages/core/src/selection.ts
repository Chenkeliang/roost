import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export interface SelectionDoc {
  schemaVersion: number;
  modules: Record<string, string[]>;
}

export const SELECTION_SCHEMA_VERSION = 1;

export function emptySelection(): SelectionDoc {
  return { schemaVersion: SELECTION_SCHEMA_VERSION, modules: {} };
}

function selectionPath(repoDir: string): string {
  return path.join(repoDir, "roost", "selection.yaml");
}

function validateShape(raw: unknown): SelectionDoc {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("selection.yaml must be a YAML object");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj["schemaVersion"] !== "number") {
    throw new Error("selection.yaml: schemaVersion must be a number");
  }

  if (typeof obj["modules"] !== "object" || obj["modules"] === null || Array.isArray(obj["modules"])) {
    throw new Error("selection.yaml: modules must be a map");
  }

  const modules = obj["modules"] as Record<string, unknown>;
  for (const [key, val] of Object.entries(modules)) {
    if (!Array.isArray(val) || !val.every((v) => typeof v === "string")) {
      throw new Error(`selection.yaml: modules.${key} must be an array of strings`);
    }
  }

  return { schemaVersion: obj["schemaVersion"] as number, modules: modules as Record<string, string[]> };
}

function migrate(doc: SelectionDoc): SelectionDoc {
  // Future schema migrations go here. Currently only version 1 exists.
  return doc;
}

export function loadSelection(repoDir: string): SelectionDoc {
  const filePath = selectionPath(repoDir);
  if (!fs.existsSync(filePath)) return emptySelection();

  const raw = yaml.load(fs.readFileSync(filePath, "utf8"));
  const doc = validateShape(raw);
  return migrate(doc);
}

export function saveSelection(repoDir: string, doc: SelectionDoc): void {
  const roostDir = path.join(repoDir, "roost");
  fs.mkdirSync(roostDir, { recursive: true });
  fs.writeFileSync(selectionPath(repoDir), yaml.dump(doc, { lineWidth: -1 }), "utf8");
}

export function addItem(doc: SelectionDoc, mod: string, id: string): SelectionDoc {
  const existing = doc.modules[mod] ?? [];
  if (existing.includes(id)) return doc;
  return {
    ...doc,
    modules: { ...doc.modules, [mod]: [...existing, id] },
  };
}

export function removeItem(doc: SelectionDoc, mod: string, id: string): SelectionDoc {
  const existing = doc.modules[mod];
  if (!existing) return doc;
  const filtered = existing.filter((item) => item !== id);
  return {
    ...doc,
    modules: { ...doc.modules, [mod]: filtered },
  };
}
