import type { ModuleContext, Selection } from "@roost/shared";
import {
  defaultRegistry,
  discoverAll,
  applyPreset,
  saveSelection,
  emptySelection,
} from "@roost/core";

export interface SelectDeps {
  repoDir: string;
  ctx: ModuleContext;
  all?: boolean;
  preset?: string;
}

export async function runSelect(deps: SelectDeps): Promise<Selection> {
  const { repoDir, ctx, all, preset } = deps;

  if (!all && !preset) {
    throw new Error("specify --all or --preset <name>");
  }

  const reg = defaultRegistry();
  const discovered = await discoverAll(reg, ctx);

  // Flatten all candidates
  const allCandidates = Object.values(discovered).flat();

  let selectedIds: string[];

  if (all) {
    selectedIds = allCandidates
      .filter((c) => c.recommendation !== "exclude")
      .map((c) => c.id);
  } else {
    // preset is defined here because we checked !all && !preset above
    selectedIds = applyPreset(preset!, allCandidates);
  }

  // Group ids back by module
  const idToModule = new Map<string, string>();
  for (const [moduleName, candidates] of Object.entries(discovered)) {
    for (const c of candidates) {
      idToModule.set(c.id, moduleName);
    }
  }

  let doc = emptySelection();
  for (const id of selectedIds) {
    const moduleName = idToModule.get(id);
    if (!moduleName) continue;
    const existing = doc.modules[moduleName] ?? [];
    doc = { ...doc, modules: { ...doc.modules, [moduleName]: [...existing, id] } };
  }

  saveSelection(repoDir, doc);
  return doc;
}
