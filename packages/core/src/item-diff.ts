// Per-item local-vs-repo content for the Sync Review two-column diff (ADR-0016
// §6.6). Module-specific: text where a clean before/after exists, otherwise a
// short semantic summary. Read-only — never mutates.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Exec } from "@roost/shared";
import { createChezmoi } from "./adapters/chezmoi.js";
import { loadEnvData } from "./env-data.js";
import { generateEnvSh, envShPath } from "./modules/env.js";

export interface KeyDiff {
  key: string;
  local: string | null;
  repo: string | null;
}

export interface ItemDiff {
  kind: "text" | "summary";
  local: string | null; // text kind: the on-disk side (null = absent)
  repo: string | null; // text kind: the repo side (null = absent)
  summary?: string; // summary kind: a one-line description
  keys?: KeyDiff[]; // optional per-key breakdown (appconfig), when parseable
}

// Best-effort parse of a top-level XML-plist <dict> into key -> raw-value-text.
// Heuristic: handles flat dicts; nested values are captured as raw text (still
// useful for "which keys differ"). Returns null if no dict is found.
function parsePlistTopLevel(xml: string | null): Record<string, string> | null {
  if (!xml) return null;
  const dict = /<dict>([\s\S]*)<\/dict>/.exec(xml);
  if (!dict) return null;
  const out: Record<string, string> = {};
  const re = /<key>([\s\S]*?)<\/key>\s*<(\w+)(?:\s*\/>|>([\s\S]*?)<\/\2>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dict[1]!)) !== null) {
    const key = m[1]!.trim();
    out[key] = m[3] !== undefined ? m[3]!.trim() : `<${m[2]}/>`;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function keyDiffs(local: string | null, repo: string | null): KeyDiff[] | undefined {
  const l = parsePlistTopLevel(local);
  const r = parsePlistTopLevel(repo);
  if (!l && !r) return undefined;
  const keys = Array.from(new Set([...Object.keys(l ?? {}), ...Object.keys(r ?? {})])).sort();
  const diffs: KeyDiff[] = [];
  for (const k of keys) {
    const lv = l?.[k] ?? null;
    const rv = r?.[k] ?? null;
    if (lv !== rv) diffs.push({ key: k, local: lv, repo: rv });
  }
  return diffs;
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
      else return { kind: "summary", local: null, repo: null, summary: "dir-or-binary" };
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
    return { kind: "text", local, repo: stored, keys: keyDiffs(local, stored) };
  }

  if (module === "env" && id === "env.sh") {
    const repo = generateEnvSh(loadEnvData(repoDir));
    const local = readFileOrNull(envShPath(home));
    return { kind: "text", local, repo };
  }

  // Everything else (packages / projects / skills / env rc lines): a summary.
  return { kind: "summary", local: null, repo: null, summary: "no-text" };
}
