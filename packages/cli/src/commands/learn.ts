import * as fs from "node:fs";
import * as path from "node:path";
import type { ModuleContext } from "@roost/shared";
import {
  snapshotDomains,
  diffSnapshots,
  loadSelection,
  saveSelection,
  addItem,
} from "@roost/core";

export interface LearnDeps {
  ctx: ModuleContext;
  repoDir: string;
  confirm: () => Promise<void>;
}

export async function runLearn(deps: LearnDeps): Promise<{ changedDomains: string[] }> {
  const { ctx, repoDir, confirm } = deps;

  // Snapshot before
  const before = await snapshotDomains(ctx.exec);

  // Wait for user to make changes
  await confirm();

  // Snapshot after
  const after = await snapshotDomains(ctx.exec);

  // Diff
  const { added, changed } = diffSnapshots(before, after);
  const changedDomains = [...added, ...changed];

  // For each changed domain: export and write into repo, add to selection
  let sel = loadSelection(repoDir);

  for (const domain of changedDomains) {
    // Export current value
    const r = await ctx.exec.run("defaults", ["export", domain, "-"]);
    const content = r.code === 0 ? r.stdout : "";

    // Write to repo
    const dest = path.join(repoDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, "utf8");

    // Add to selection
    sel = addItem(sel, "appconfig", `domain:${domain}`);
  }

  saveSelection(repoDir, sel);

  return { changedDomains };
}
