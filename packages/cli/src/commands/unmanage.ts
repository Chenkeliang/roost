import type { ModuleContext, ApplyResult, Selection } from "@roost/shared";
import type { ModuleRegistry } from "@roost/core";
import { loadSelection, saveSelection, removeItem } from "@roost/core";

export interface UnmanageDeps {
  repoDir: string;
  ctx: ModuleContext;
  registry: ModuleRegistry;
  module: string;
  id: string;
  dryRun?: boolean;
}

export interface UnmanageResult {
  module: string;
  id: string;
  dryRun: boolean;
  unmanaged?: ApplyResult;
}

// Mirrors the server's POST /api/selection/remove flow: find the owning module,
// build a single-item selection, call module.unmanage, then drop the item from
// selection.yaml. With dryRun we print intent and write nothing.
export async function runUnmanage(deps: UnmanageDeps): Promise<UnmanageResult> {
  const { repoDir, ctx, registry, module: mod, id, dryRun = false } = deps;

  const owningModule = registry.get(mod);
  if (!owningModule) {
    throw new Error(`unknown module: ${mod}`);
  }

  const doc = loadSelection(repoDir);
  const managed = doc.modules[mod] ?? [];
  if (!managed.includes(id)) {
    throw new Error(`id is not managed by module "${mod}": ${id}`);
  }

  const singleItemSel: Selection = { modules: { [mod]: [id] } };

  if (dryRun) {
    ctx.log.info(`[dry-run] would unmanage ${mod}/${id} (no changes written)`);
    ctx.log.warn(
      "unmanage removes items from the working tree but git history is NOT purged. " +
        "If a removed item ever contained secrets, rotate them and purge history.",
    );
    return { module: mod, id, dryRun: true };
  }

  const unmanaged = await owningModule.unmanage(ctx, singleItemSel);

  const next = removeItem(doc, mod, id);
  saveSelection(repoDir, next);

  ctx.log.info(`unmanaged ${mod}/${id} (${unmanaged.applied.length} item(s) forgotten)`);

  return { module: mod, id, dryRun: false, unmanaged };
}
