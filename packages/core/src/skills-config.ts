import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export type SkillMethod = "symlink" | "copy";

export interface SkillEntry {
  enabled?: boolean;
  targets?: string[];
  method?: SkillMethod;
}

export interface SkillsConfig {
  sourceDir: string; // "~/.agents/skills" or absolute
  method: SkillMethod;
  targets: string[]; // default-enabled target ids
  skills: Record<string, SkillEntry>;
}

export const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  sourceDir: "~/.agents/skills",
  method: "symlink",
  targets: ["claude", "codex", "gemini", "opencode"],
  skills: {},
};

function recipePath(repoDir: string): string {
  return path.join(repoDir, "roost", "skills.yaml");
}

export function loadSkillsConfig(repoDir: string): SkillsConfig {
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(recipePath(repoDir), "utf8"));
  } catch {
    return { ...DEFAULT_SKILLS_CONFIG, skills: {} };
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SKILLS_CONFIG, skills: {} };
  const o = raw as Record<string, unknown>;
  return {
    sourceDir: typeof o.sourceDir === "string" ? o.sourceDir : DEFAULT_SKILLS_CONFIG.sourceDir,
    method: o.method === "copy" ? "copy" : "symlink",
    targets: Array.isArray(o.targets) ? (o.targets.filter((x) => typeof x === "string") as string[]) : [...DEFAULT_SKILLS_CONFIG.targets],
    skills: o.skills && typeof o.skills === "object" ? (o.skills as Record<string, SkillEntry>) : {},
  };
}

export function saveSkillsConfig(repoDir: string, cfg: SkillsConfig): void {
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  fs.writeFileSync(recipePath(repoDir), yaml.dump(cfg), "utf8");
}

export interface EffectiveSkill {
  enabled: boolean;
  targets: string[];
  method: SkillMethod;
}

export function effectiveSkill(cfg: SkillsConfig, name: string): EffectiveSkill {
  const e = cfg.skills[name] ?? {};
  return {
    enabled: e.enabled ?? true,
    targets: e.targets ?? cfg.targets,
    method: e.method ?? cfg.method,
  };
}

// ── per-machine link state (state/skills-links.json, .chezmoiignore'd) ─────────

export interface SkillLink {
  skill: string;
  target: string; // target id
  path: string; // absolute link/copy path created
  kind: SkillMethod;
}

function linksPath(repoDir: string): string {
  return path.join(repoDir, "state", "skills-links.json");
}

export function loadSkillLinks(repoDir: string): SkillLink[] {
  try {
    const arr = JSON.parse(fs.readFileSync(linksPath(repoDir), "utf8"));
    return Array.isArray(arr) ? (arr as SkillLink[]) : [];
  } catch {
    return [];
  }
}

export function saveSkillLinks(repoDir: string, links: SkillLink[]): void {
  fs.mkdirSync(path.join(repoDir, "state"), { recursive: true });
  fs.writeFileSync(linksPath(repoDir), JSON.stringify(links, null, 2), "utf8");
}
