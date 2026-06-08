import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModuleContext, Selection } from "@roost/shared";
import { skillsModule, hashSkillDir } from "./skills.js";

let home: string, repo: string;
function ctx(): ModuleContext {
  return {
    repoDir: repo, home, profile: "base", dryRun: false,
    exec: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
    log: { info() {}, warn() {}, error() {} },
    t: (k) => k,
  };
}
function sel(names: string[]): Selection { return { modules: { skills: names } }; }
function mkSkill(dir: string, name: string, body: string) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), body);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sk-home-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sk-repo-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("skills module read ops", () => {
  it("discover finds skills under source + IDE target dirs, not yet managed", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# foo");
    mkSkill(path.join(home, ".claude", "skills"), "bar", "# bar");
    const cands = await skillsModule.discover(ctx());
    const ids = cands.map((c) => c.id).sort();
    expect(ids).toEqual(["bar", "foo"]);
  });

  it("discover marks same-name different-content as conflict", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# A");
    mkSkill(path.join(home, ".claude", "skills"), "foo", "# B");
    const cands = await skillsModule.discover(ctx());
    const foo = cands.find((c) => c.id === "foo")!;
    expect(foo.note ?? "").toMatch(/conflict/i);
  });

  it("capture copies a selected skill into <repo>/skills/<name>", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# foo body");
    const cs = await skillsModule.capture(ctx(), sel(["foo"]));
    expect(cs.written).toContain("foo");
    expect(fs.readFileSync(path.join(repo, "skills", "foo", "SKILL.md"), "utf8")).toBe("# foo body");
  });

  it("capture blocks a skill whose file contains a secret", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "leaky", 'AKIAIOSFODNN7EXAMPLE aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    const cs = await skillsModule.capture(ctx(), sel(["leaky"]));
    expect(cs.blocked ?? []).toContain("leaky");
    expect(fs.existsSync(path.join(repo, "skills", "leaky"))).toBe(false);
  });

  it("index reports managed count", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    const idx = await skillsModule.index!(ctx());
    expect(idx.available).toBe(true);
    expect(idx.managed).toBe(1);
  });

  it("unmanage returns a result without throwing when nothing linked", async () => {
    const res = await skillsModule.unmanage(ctx(), sel(["foo"]));
    expect(res.module).toBe("skills");
  });
});

describe("skills hardening", () => {
  it("hashSkillDir handles a symlinked sub-directory without aborting (stable, includes later files)", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "roost-hash-"));
    const skill = path.join(base, "s");
    fs.mkdirSync(path.join(skill, "real"), { recursive: true });
    fs.writeFileSync(path.join(skill, "real", "a.md"), "A");
    // a symlinked subdir, sorted BEFORE a later file so a buggy walk would drop "z.md"
    const targetDir = path.join(base, "shared");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.symlinkSync(targetDir, path.join(skill, "linkdir"));
    fs.writeFileSync(path.join(skill, "z.md"), "Z");
    const h1 = hashSkillDir(skill);
    const h2 = hashSkillDir(skill);
    expect(h1).toBe(h2);            // stable
    expect(h1).not.toBe("");        // produced a real digest
    // changing a file AFTER the symlink must change the hash (proves walk didn't abort at the symlink)
    fs.writeFileSync(path.join(skill, "z.md"), "Z2");
    expect(hashSkillDir(skill)).not.toBe(h1);
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("capture blocks an oversized (tooLarge) skill dir without writing it", async () => {
    // trip the scanner's 2000-file cap
    const src = path.join(home, ".agents", "skills", "huge");
    fs.mkdirSync(src, { recursive: true });
    for (let i = 0; i < 2100; i++) fs.writeFileSync(path.join(src, `f${i}.txt`), "x");
    const cs = await skillsModule.capture(ctx(), { modules: { skills: ["huge"] } });
    expect(cs.blocked ?? []).toContain("huge");
    expect(fs.existsSync(path.join(repo, "skills", "huge"))).toBe(false);
  });
});
