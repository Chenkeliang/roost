import * as prompts from "@clack/prompts";
import type { Candidate } from "@roost/shared";

export interface BuildSelectionResult {
  modules: Record<string, string[]>;
}

/** Human-friendly display names for modules; falls back to the raw name. */
const MODULE_LABELS: Record<string, string> = {
  env: "Aliases & Env",
};

export function moduleLabel(moduleName: string): string {
  return MODULE_LABELS[moduleName] ?? moduleName;
}

/**
 * Pure function: groups chosenIds by module, omitting modules with 0 chosen ids.
 */
export function buildSelection(
  byModule: Record<string, Candidate[]>,
  chosenIds: Set<string>,
): BuildSelectionResult {
  const modules: Record<string, string[]> = {};
  for (const [moduleName, candidates] of Object.entries(byModule)) {
    const ids = candidates.map((c) => c.id).filter((id) => chosenIds.has(id));
    if (ids.length > 0) {
      modules[moduleName] = ids;
    }
  }
  return { modules };
}

/**
 * Interactive prompt (not unit-tested): shows a multiselect per module,
 * defaults to recommendation !== "exclude".
 */
export async function promptSelection(
  byModule: Record<string, Candidate[]>,
): Promise<Set<string>> {
  prompts.intro("Roost — select what to track");

  const chosen = new Set<string>();

  for (const [moduleName, candidates] of Object.entries(byModule)) {
    if (candidates.length === 0) continue;

    const options = candidates.map((c) => ({
      value: c.id,
      label: c.path,
      hint: c.note ?? c.recommendation,
    }));

    const initialValues = candidates
      .filter((c) => c.recommendation !== "exclude")
      .map((c) => c.id);

    const selected = await prompts.multiselect<string>({
      message: `[${moduleLabel(moduleName)}] Choose items to track`,
      options,
      initialValues,
      required: false,
    });

    if (prompts.isCancel(selected)) {
      prompts.cancel("Cancelled.");
      process.exit(0);
    }

    for (const id of selected) {
      chosen.add(id);
    }
  }

  prompts.outro("Selection saved.");
  return chosen;
}
