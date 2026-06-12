import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

// ADR-0022: curated AI tool config catalog — facts from public docs, zero personal paths (I8).
export interface AiToolPath {
  path: string; // home-relative
  kind: "memory" | "settings" | "mcp" | "data"; // display grouping
  encrypt?: boolean; // capture with --encrypt
}
export interface AiTool { id: string; label: string; paths: AiToolPath[] }

export const DEFAULT_AI_TOOLS_CATALOG: AiTool[] = [
  { id: "claude-code", label: "Claude Code", paths: [
    { path: ".claude/CLAUDE.md", kind: "memory" },
    { path: ".claude/settings.json", kind: "settings" },
    { path: ".claude/settings.local.json", kind: "settings", encrypt: true },
    { path: ".claude/keybindings.json", kind: "settings" },
    { path: ".claude/agents", kind: "settings" },
    { path: ".claude/commands", kind: "settings" },
  ]},
  { id: "claude-desktop", label: "Claude Desktop", paths: [
    { path: "Library/Application Support/Claude/claude_desktop_config.json", kind: "mcp", encrypt: true },
  ]},
  { id: "codex", label: "Codex CLI", paths: [
    { path: ".codex/config.toml", kind: "settings" },
    { path: ".codex/AGENTS.md", kind: "memory" },
  ]},
  { id: "gemini", label: "Gemini CLI", paths: [
    { path: ".gemini/GEMINI.md", kind: "memory" },
    { path: ".gemini/settings.json", kind: "settings" },
  ]},
  { id: "cc-switch", label: "cc-switch", paths: [
    { path: ".cc-switch/cc-switch.db", kind: "data", encrypt: true },
    { path: ".cc-switch/settings.json", kind: "data", encrypt: true },
  ]},
];

// Short-lived session tokens — backing up these files adds pure risk with zero recovery value.
export const NEVER_BACKUP: string[] = [
  ".claude.json",
  ".codex/auth.json",
  ".gemini/.env",
];

function parseOverride(raw: unknown): AiTool[] {
  if (typeof raw !== "object" || raw === null) return [];
  const tools = (raw as Record<string, unknown>)["tools"];
  if (!Array.isArray(tools)) return [];
  const out: AiTool[] = [];
  for (const t of tools) {
    if (typeof t !== "object" || t === null) continue;
    const obj = t as Record<string, unknown>;
    const id = obj["id"];
    const label = obj["label"];
    const rawPaths = obj["paths"];
    if (typeof id !== "string" || typeof label !== "string" || !Array.isArray(rawPaths)) continue;
    const paths: AiToolPath[] = [];
    for (const p of rawPaths) {
      if (typeof p !== "object" || p === null) continue;
      const po = p as Record<string, unknown>;
      const ppath = po["path"];
      const kind = po["kind"];
      if (typeof ppath !== "string" || typeof kind !== "string") continue;
      if (kind !== "memory" && kind !== "settings" && kind !== "mcp" && kind !== "data") continue;
      const entry: AiToolPath = { path: ppath, kind };
      if (po["encrypt"] === true) entry.encrypt = true;
      paths.push(entry);
    }
    if (paths.length === 0) continue;
    out.push({ id, label, paths });
  }
  return out;
}

/**
 * Catalog = packaged default merged with the user's optional
 * `roost/ai-tools-catalog.yaml`. Merge is BY ID with the user winning
 * (override a tool's paths, or add new tools). ADR-0022.
 */
export function loadAiToolsCatalog(repoDir: string): AiTool[] {
  const byId = new Map<string, AiTool>(DEFAULT_AI_TOOLS_CATALOG.map((t) => [t.id, t]));
  const file = path.join(repoDir, "roost", "ai-tools-catalog.yaml");
  if (fs.existsSync(file)) {
    try {
      for (const t of parseOverride(yaml.load(fs.readFileSync(file, "utf8")))) byId.set(t.id, t);
    } catch {
      /* malformed override → ignore, fall back to defaults */
      return [...new Map(DEFAULT_AI_TOOLS_CATALOG.map((t) => [t.id, t])).values()];
    }
  }
  return [...byId.values()];
}
