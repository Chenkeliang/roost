import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

// ADR-0023: per-entry policy replaces NEVER_BACKUP blacklist.
export type AiPolicy = "plain" | "encrypt" | "skip";

// ADR-0024: field-extraction rule; format default "json" (only supported value in v1.2).
export interface AiExtract { fields: string[]; format?: "json" }

export interface AiToolPath {
  path: string; // home-relative
  kind: "memory" | "settings" | "mcp" | "data";
  policy?: AiPolicy; // default "plain"; "skip" = never backed up (credential/session/large)
  extract?: AiExtract; // present ⇒ field-extraction handling, NOT whole-file chezmoi
}
export interface AiTool { id: string; label: string; paths: AiToolPath[] }

export function effectivePolicy(p: AiToolPath): AiPolicy { return p.policy ?? "plain"; }

export const DEFAULT_AI_TOOLS_CATALOG: AiTool[] = [
  { id: "claude-code", label: "Claude Code", paths: [
    { path: ".claude/CLAUDE.md", kind: "memory" },
    { path: ".claude/settings.json", kind: "settings" },
    { path: ".claude/settings.local.json", kind: "settings", policy: "encrypt" },
    { path: ".claude/keybindings.json", kind: "settings" },
    { path: ".claude/agents", kind: "settings" },
    { path: ".claude/commands", kind: "settings" },
    { path: ".claude.json", kind: "mcp", policy: "encrypt", extract: { fields: ["mcpServers"] } },
  ]},
  { id: "claude-desktop", label: "Claude Desktop", paths: [
    { path: "Library/Application Support/Claude/claude_desktop_config.json", kind: "mcp", policy: "encrypt" },
  ]},
  { id: "codex", label: "Codex CLI", paths: [
    { path: ".codex/config.toml", kind: "settings" },
    { path: ".codex/AGENTS.md", kind: "memory" },
    { path: ".codex/auth.json", kind: "data", policy: "skip" },
  ]},
  { id: "gemini", label: "Gemini CLI", paths: [
    { path: ".gemini/GEMINI.md", kind: "memory" },
    { path: ".gemini/settings.json", kind: "settings" },
    { path: ".gemini/.env", kind: "data", policy: "skip" },
    { path: ".gemini/oauth_creds.json", kind: "data", policy: "skip" },
    { path: ".gemini/google_accounts.json", kind: "data", policy: "skip" },
  ]},
  { id: "cursor", label: "Cursor", paths: [
    { path: ".cursor/mcp.json", kind: "mcp", policy: "encrypt" },
    { path: "Library/Application Support/Cursor/User/settings.json", kind: "settings" },
    { path: "Library/Application Support/Cursor/User/keybindings.json", kind: "settings" },
  ]},
  { id: "windsurf", label: "Windsurf", paths: [
    { path: ".codeium/windsurf/mcp_config.json", kind: "mcp", policy: "encrypt" },
    { path: ".codeium/windsurf/memories/global_rules.md", kind: "memory" },
  ]},
  { id: "zed", label: "Zed", paths: [
    { path: ".config/zed/settings.json", kind: "settings", policy: "encrypt" },
    { path: ".config/zed/keymap.json", kind: "settings" },
  ]},
  { id: "copilot", label: "GitHub Copilot", paths: [
    { path: "Library/Application Support/Code/User/prompts", kind: "memory" },
  ]},
  { id: "cc-switch", label: "cc-switch", paths: [
    { path: ".cc-switch/cc-switch.db", kind: "data", policy: "encrypt" },
    { path: ".cc-switch/settings.json", kind: "data", policy: "encrypt" },
  ]},
  { id: "ollama", label: "Ollama", paths: [
    { path: ".ollama/models", kind: "data", policy: "skip" },
  ]},
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
      const pol = po["policy"];
      if (pol === "plain" || pol === "encrypt" || pol === "skip") entry.policy = pol;
      else if (po["encrypt"] === true) entry.policy = "encrypt";
      const ex = po["extract"];
      if (ex && typeof ex === "object" && Array.isArray((ex as { fields?: unknown }).fields)) {
        entry.extract = {
          fields: ((ex as { fields: unknown[] }).fields).filter((f): f is string => typeof f === "string"),
        };
      }
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
 * (override a tool's paths, or add new tools). ADR-0023.
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

// All catalog paths' effective policy, keyed by absolute path. Used by the
// aitools module (capture/discover) and the server endpoint — no hardcoded list.
export function aiPathPolicies(repoDir: string, home: string): Map<string, AiPolicy> {
  const m = new Map<string, AiPolicy>();
  for (const tool of loadAiToolsCatalog(repoDir)) {
    for (const p of tool.paths) m.set(path.join(home, p.path), effectivePolicy(p));
  }
  return m;
}

// All extract entries, keyed by absolute path. Used by the aitools module.
export function aiExtractEntries(repoDir: string, home: string): Map<string, AiExtract> {
  const m = new Map<string, AiExtract>();
  for (const tool of loadAiToolsCatalog(repoDir))
    for (const p of tool.paths) if (p.extract) m.set(path.join(home, p.path), p.extract);
  return m;
}
