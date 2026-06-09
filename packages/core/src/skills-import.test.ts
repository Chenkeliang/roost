import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext } from "@roost/shared";
import { findSkillRoots, skillName, importStaged } from "./skills-import.js";

function mkSkill(dir: string, name: string, content = "# skill\n", frontmatterName?: string) {
  const d = path.join(dir, name);
  fs.mkdirSync(d, { recursive: true });
  const md = frontmatterName ? `---\nname: ${frontmatterName}\n---\n${content}` : content;
  fs.writeFileSync(path.join(d, "SKILL.md"), md, "utf8");
  return d;
}

const noopExec: Exec = { async run(): Promise<ExecResult> { return { code: 0, stdout: "", stderr: "" }; } };

describe("skillName", () => {
  it("prefers SKILL.md frontmatter name, else basename", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sn-"));
    try {
      const a = mkSkill(tmp, "folder-a", "x", "real-name");
      expect(skillName(a)).toBe("real-name");
      const b = mkSkill(tmp, "folder-b");
      expect(skillName(b)).toBe("folder-b");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("findSkillRoots", () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-fsr-")); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("single skill: staged dir holds SKILL.md (uses fallback name)", () => {
    fs.writeFileSync(path.join(tmp, "SKILL.md"), "# s", "utf8");
    expect(findSkillRoots(tmp, "my-skill")).toEqual([{ name: "my-skill", path: tmp }]);
  });

  it("pack: child dirs with SKILL.md", () => {
    mkSkill(tmp, "alpha");
    mkSkill(tmp, "beta");
    fs.mkdirSync(path.join(tmp, "not-a-skill"));
    const roots = findSkillRoots(tmp).map((r) => r.name).sort();
    expect(roots).toEqual(["alpha", "beta"]);
  });

  it("pack under skills/ subdir", () => {
    mkSkill(path.join(tmp, "skills"), "gamma");
    expect(findSkillRoots(tmp).map((r) => r.name)).toEqual(["gamma"]);
  });

  it("finds skills nested several levels deep (recursive)", () => {
    mkSkill(path.join(tmp, "packages", "a", "src"), "deep-skill");
    mkSkill(path.join(tmp, "category", "b"), "another");
    expect(findSkillRoots(tmp).map((r) => r.name).sort()).toEqual(["another", "deep-skill"]);
  });

  it("does not descend into .git / node_modules", () => {
    mkSkill(path.join(tmp, "node_modules", "pkg"), "should-skip");
    mkSkill(tmp, "real");
    expect(findSkillRoots(tmp).map((r) => r.name)).toEqual(["real"]);
  });
});

describe("importStaged", () => {
  let home: string;
  let repo: string;
  function ctx(): ModuleContext {
    return { repoDir: repo, home, profile: "base", dryRun: false, exec: noopExec,
      log: { info() {}, warn() {}, error() {} }, t: (k: string) => k };
  }
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-imp-home-"));
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-imp-repo-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("copies a clean skill into source (~/.agents/skills) and repo/skills, skipping .git", () => {
    const staged = fs.mkdtempSync(path.join(os.tmpdir(), "roost-staged-"));
    mkSkill(staged, "cool-skill", "do cool things\n");
    fs.mkdirSync(path.join(staged, "cool-skill", ".git"), { recursive: true });
    fs.writeFileSync(path.join(staged, "cool-skill", ".git", "config"), "x", "utf8");
    try {
      const res = importStaged(ctx(), staged);
      expect(res.imported).toEqual(["cool-skill"]);
      expect(res.blocked).toEqual([]);
      // Lands in the source dir (→ appears under Discover), NOT directly in the repo.
      expect(fs.existsSync(path.join(home, ".agents", "skills", "cool-skill", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(home, ".agents", "skills", "cool-skill", ".git"))).toBe(false);
      expect(fs.existsSync(path.join(repo, "skills", "cool-skill"))).toBe(false);
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
    }
  });

  it("blocks a skill that contains a secret (does not copy it)", () => {
    const staged = fs.mkdtempSync(path.join(os.tmpdir(), "roost-staged2-"));
    mkSkill(staged, "leaky", "aws_secret_access_key=AKIAIOSFODNN7EXAMPLE1234\n");
    try {
      const res = importStaged(ctx(), staged);
      expect(res.imported).toEqual([]);
      expect(res.blocked[0]?.id).toBe("leaky");
      expect(res.blocked[0]?.reason).toBe("secret");
      expect(fs.existsSync(path.join(home, ".agents", "skills", "leaky"))).toBe(false);
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
    }
  });
});
