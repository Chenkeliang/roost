import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_SKILLS_TARGETS, loadSkillsTargets, saveSkillsTargets } from "./skills-catalog.js";

let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skcat-")); });
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

describe("skills catalog", () => {
  it("ships the cc-switch default targets", () => {
    const ids = DEFAULT_SKILLS_TARGETS.map((t) => t.id);
    expect(ids).toEqual(["claude", "codex", "gemini", "opencode"]);
    expect(DEFAULT_SKILLS_TARGETS.find((t) => t.id === "claude")!.path).toBe(".claude/skills");
  });

  it("returns defaults when no override file exists", () => {
    expect(loadSkillsTargets(repo)).toEqual(DEFAULT_SKILLS_TARGETS);
  });

  it("merges override by id (override path wins, new id added)", () => {
    fs.mkdirSync(path.join(repo, "roost"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "roost", "skills-catalog.yaml"),
      "targets:\n  - { id: claude, path: .config/claude/skills, label: Claude }\n  - { id: cursor, path: .cursor/skills, label: Cursor }\n",
    );
    const got = loadSkillsTargets(repo);
    expect(got.find((t) => t.id === "claude")!.path).toBe(".config/claude/skills");
    expect(got.find((t) => t.id === "cursor")!.path).toBe(".cursor/skills");
    expect(got.find((t) => t.id === "codex")!.path).toBe(".codex/skills");
  });
});

describe("saveSkillsTargets", () => {
  it("persists a custom target so loadSkillsTargets returns defaults + it", () => {
    const custom = { id: "myproj", path: "work/proj/.skills", label: "My Proj" };
    saveSkillsTargets(repo, [...DEFAULT_SKILLS_TARGETS, custom]);
    const loaded = loadSkillsTargets(repo);
    expect(loaded.find((t) => t.id === "myproj")).toEqual(custom);
    expect(loaded.filter((t) => t.id === "claude").length).toBe(1);
  });
  it("round-trips an override of a built-in target's path", () => {
    saveSkillsTargets(repo, DEFAULT_SKILLS_TARGETS.map((t) => t.id === "claude" ? { ...t, path: ".claude/x" } : t));
    expect(loadSkillsTargets(repo).find((t) => t.id === "claude")?.path).toBe(".claude/x");
  });
});
