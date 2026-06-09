import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_SKILLS_CONFIG,
  loadSkillsConfig,
  saveSkillsConfig,
  effectiveSkill,
  loadSkillLinks,
  saveSkillLinks,
} from "./skills-config.js";

let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skcfg-")); });
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

describe("skills config", () => {
  it("defaults: symlink, ~/.agents/skills, all four targets", () => {
    expect(DEFAULT_SKILLS_CONFIG.method).toBe("symlink");
    expect(DEFAULT_SKILLS_CONFIG.sourceDir).toBe("~/.agents/skills");
    expect(DEFAULT_SKILLS_CONFIG.targets).toEqual(["claude", "codex", "gemini", "opencode"]);
  });

  it("load returns defaults when no file", () => {
    expect(loadSkillsConfig(repo)).toEqual(DEFAULT_SKILLS_CONFIG);
  });

  it("save then load round-trips", () => {
    const cfg = { ...DEFAULT_SKILLS_CONFIG, method: "copy" as const, targets: ["claude"], skills: { foo: { enabled: false } } };
    saveSkillsConfig(repo, cfg);
    expect(fs.existsSync(path.join(repo, "roost", "skills.yaml"))).toBe(true);
    expect(loadSkillsConfig(repo)).toEqual(cfg);
  });

  it("effectiveSkill inherits top-level defaults", () => {
    const cfg = { ...DEFAULT_SKILLS_CONFIG, method: "symlink" as const, targets: ["claude", "codex"] };
    expect(effectiveSkill(cfg, "unknown")).toEqual({ enabled: true, targets: ["claude", "codex"], method: "symlink" });
  });

  it("effectiveSkill applies per-skill overrides", () => {
    const cfg = { ...DEFAULT_SKILLS_CONFIG, targets: ["claude", "codex"], skills: { foo: { enabled: false, targets: ["claude"], method: "copy" as const } } };
    expect(effectiveSkill(cfg, "foo")).toEqual({ enabled: false, targets: ["claude"], method: "copy" });
  });

  it("link state round-trips under state/ (not roost/)", () => {
    const links = [{ skill: "foo", target: "claude", path: "/h/.claude/skills/foo", kind: "symlink" as const }];
    saveSkillLinks(repo, links);
    expect(fs.existsSync(path.join(repo, "state", "skills-links.json"))).toBe(true);
    expect(loadSkillLinks(repo)).toEqual(links);
  });

  it("loadSkillLinks returns [] when missing", () => {
    expect(loadSkillLinks(repo)).toEqual([]);
  });
});
