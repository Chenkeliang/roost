import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

// A target IDE/agent skills directory. `path` is home-relative.
export interface SkillTarget {
  id: string;
  path: string;
  label: string;
}

// Curated defaults (cc-switch set). macOS home-relative paths; zero personal
// paths (I8). Overridable via roost/skills-catalog.yaml.
export const DEFAULT_SKILLS_TARGETS: SkillTarget[] = [
  { id: "claude", path: ".claude/skills", label: "Claude Code" },
  { id: "codex", path: ".codex/skills", label: "Codex" },
  { id: "gemini", path: ".gemini/skills", label: "Gemini CLI" },
  { id: "opencode", path: ".config/opencode/skills", label: "OpenCode" },
];

function overridePath(repoDir: string): string {
  return path.join(repoDir, "roost", "skills-catalog.yaml");
}

function parseTargets(raw: unknown): SkillTarget[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { targets?: unknown }).targets;
  if (!Array.isArray(list)) return [];
  const out: SkillTarget[] = [];
  for (const e of list) {
    if (e && typeof e === "object") {
      const t = e as Record<string, unknown>;
      if (typeof t.id === "string" && typeof t.path === "string") {
        out.push({ id: t.id, path: t.path, label: typeof t.label === "string" ? t.label : t.id });
      }
    }
  }
  return out;
}

export function saveSkillsTargets(repoDir: string, targets: SkillTarget[]): void {
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  fs.writeFileSync(overridePath(repoDir), yaml.dump({ targets }), "utf8");
}

// Defaults merged with user override, keyed by id (override path/label wins;
// new ids appended; default ids not mentioned remain).
export function loadSkillsTargets(repoDir: string): SkillTarget[] {
  let overrides: SkillTarget[] = [];
  try {
    const raw = fs.readFileSync(overridePath(repoDir), "utf8");
    overrides = parseTargets(yaml.load(raw));
  } catch {
    overrides = [];
  }
  const byId = new Map<string, SkillTarget>();
  for (const t of DEFAULT_SKILLS_TARGETS) byId.set(t.id, t);
  for (const t of overrides) byId.set(t.id, t);
  return [...byId.values()];
}
