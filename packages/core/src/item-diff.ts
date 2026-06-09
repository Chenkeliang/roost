// Per-item local-vs-repo content for the Sync Review two-column diff (ADR-0016
// §6.6). Module-specific: text where a clean before/after exists, otherwise a
// short semantic summary. Read-only — never mutates.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Exec } from "@roost/shared";
import { createChezmoi } from "./adapters/chezmoi.js";
import { loadEnvData } from "./env-data.js";
import { generateEnvSh, envShPath } from "./modules/env.js";

export interface ItemDiff {
  kind: "text" | "summary";
  local: string | null; // text kind: the on-disk side (null = absent)
  repo: string | null; // text kind: the repo side (null = absent)
  summary?: string; // summary kind: a one-line description
}

function readFileOrNull(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export async function itemDiff(
  opts: { repoDir: string; home: string; exec: Exec },
  module: string,
  id: string,
): Promise<ItemDiff> {
  const { repoDir, home, exec } = opts;

  if (module === "dotfiles") {
    const chezmoi = createChezmoi(exec, { sourceDir: repoDir });
    const repo = await chezmoi.cat(id);
    // Directories (or binary) won't `cat` cleanly → fall back to a summary.
    let local: string | null = null;
    try {
      const st = fs.lstatSync(id);
      if (st.isFile()) local = readFileOrNull(id);
      else return { kind: "summary", local: null, repo: null, summary: "目录或非文本条目,无法逐行对比" };
    } catch {
      local = null;
    }
    return { kind: "text", local, repo };
  }

  if (module === "appconfig") {
    const domain = id.startsWith("domain:") ? id.slice("domain:".length) : id;
    const stored = readFileOrNull(path.join(repoDir, "roost", "appconfig", `${domain}.plist`));
    const r = await exec.run("defaults", ["export", domain, "-"]);
    const local = r.code === 0 ? r.stdout : null;
    return { kind: "text", local, repo: stored };
  }

  if (module === "env" && id === "env.sh") {
    const repo = generateEnvSh(loadEnvData(repoDir));
    const local = readFileOrNull(envShPath(home));
    return { kind: "text", local, repo };
  }

  // Everything else (packages / projects / skills / env rc lines): a summary.
  return { kind: "summary", local: null, repo: null, summary: "该类型无文本逐行对比" };
}
