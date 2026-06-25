import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModuleContext, Selection } from "@roost/shared";
import { skillsModule, hashSkillDir, resolveSkillConflict, materializeSource, unadoptSkills } from "./skills.js";
import { loadSkillLinks } from "../skills-config.js";

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

  it("capture reports blockedDetail reason 'secret' for a leaky skill", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "leaky", 'AKIAIOSFODNN7EXAMPLE aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    const cs = await skillsModule.capture(ctx(), sel(["leaky"]));
    expect((cs.blockedDetail ?? []).find((b) => b.id === "leaky")?.reason).toBe("secret");
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

import { skillsModule as M } from "./skills.js";
import { saveSkillsConfig, loadSkillsConfig, loadSkillLinks as loadLinks, DEFAULT_SKILLS_CONFIG, saveSkillLinks } from "../skills-config.js";

function plan() { return { module: "skills", actions: [] as never[] }; }

describe("skills apply + reconcile", () => {
  it("apply materializes repo -> sourceDir and symlinks into enabled targets", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    const res = await M.apply({ ...ctx(), dryRun: false }, plan() as never);
    expect(fs.readFileSync(path.join(home, ".agents/skills/foo/SKILL.md"), "utf8")).toBe("# foo");
    const link = path.join(home, ".claude/skills/foo");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(home, ".agents/skills/foo")));
    expect(res.applied).toContain("foo@claude");
    expect(loadLinks(repo).some((l) => l.skill === "foo" && l.target === "claude")).toBe(true);
  });

  it("dry-run makes no changes", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    await M.apply({ ...ctx(), dryRun: true }, plan() as never);
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(false);
    expect(loadLinks(repo)).toEqual([]);
  });

  it("is idempotent: second apply does not error and keeps one link", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    await M.apply({ ...ctx() }, plan() as never);
    await M.apply({ ...ctx() }, plan() as never);
    expect(loadLinks(repo).filter((l) => l.skill === "foo" && l.target === "claude").length).toBe(1);
  });

  it("disabling a skill removes its Roost-owned link on next apply", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    const base = { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"] };
    saveSkillsConfig(repo, { ...base, skills: { foo: { enabled: true } } });
    await M.apply({ ...ctx() }, plan() as never);
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(true);
    saveSkillsConfig(repo, { ...base, skills: { foo: { enabled: false } } });
    await M.apply({ ...ctx() }, plan() as never);
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(false);
    expect(loadLinks(repo).some((l) => l.skill === "foo")).toBe(false);
  });

  it("does not overwrite a real (non-Roost) directory at the target; marks skipped", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    mkSkill(path.join(home, ".claude/skills"), "foo", "# user's own foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    const res = await M.apply({ ...ctx() }, plan() as never);
    expect(fs.lstatSync(path.join(home, ".claude/skills/foo")).isSymbolicLink()).toBe(false);
    expect(res.skipped.some((s) => s.includes("foo@claude"))).toBe(true);
  });

  it("unmanage removes Roost-owned links for the given skills", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    await M.apply({ ...ctx() }, plan() as never);
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(true);
    await M.unmanage({ ...ctx() }, { modules: { skills: ["foo"] } });
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(false);
    expect(loadLinks(repo).some((l) => l.skill === "foo")).toBe(false);
  });
});

describe("skills delete-safety", () => {
  it("reconcile does NOT delete a user's real dir that replaced a Roost symlink", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    const base = { sourceDir: path.join(home, ".agents/skills"), method: "symlink" as const, targets: ["claude"] };
    saveSkillsConfig(repo, { ...base, skills: { foo: { enabled: true } } });
    await skillsModule.apply({ ...ctx() }, { module: "skills", actions: [] } as never);
    const dest = path.join(home, ".claude/skills/foo");
    // user replaces the Roost symlink with their OWN real dir
    fs.unlinkSync(dest);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "USER_DATA.md"), "precious");
    // disable + apply -> reconcile must NOT delete the user's dir
    saveSkillsConfig(repo, { ...base, skills: { foo: { enabled: false } } });
    await skillsModule.apply({ ...ctx() }, { module: "skills", actions: [] } as never);
    expect(fs.existsSync(path.join(dest, "USER_DATA.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dest, "USER_DATA.md"), "utf8")).toBe("precious");
  });

  it("unmanage does NOT delete a user's real dir that replaced a Roost symlink", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { sourceDir: path.join(home, ".agents/skills"), method: "symlink", targets: ["claude"], skills: { foo: {} } });
    await skillsModule.apply({ ...ctx() }, { module: "skills", actions: [] } as never);
    const dest = path.join(home, ".claude/skills/foo");
    fs.unlinkSync(dest);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "USER_DATA.md"), "precious");
    await skillsModule.unmanage({ ...ctx() }, { modules: { skills: ["foo"] } });
    expect(fs.existsSync(path.join(dest, "USER_DATA.md"))).toBe(true);
  });

  it("reconcile still removes a genuine Roost symlink when undesired", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    const base = { sourceDir: path.join(home, ".agents/skills"), method: "symlink" as const, targets: ["claude"] };
    saveSkillsConfig(repo, { ...base, skills: { foo: { enabled: true } } });
    await skillsModule.apply({ ...ctx() }, { module: "skills", actions: [] } as never);
    expect(fs.lstatSync(path.join(home, ".claude/skills/foo")).isSymbolicLink()).toBe(true);
    saveSkillsConfig(repo, { ...base, skills: { foo: { enabled: false } } });
    await skillsModule.apply({ ...ctx() }, { module: "skills", actions: [] } as never);
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(false);
  });
});

describe("capture dereferences symlinked sources (adopt)", () => {
  it("captures real content (not a symlink) when source is a symlink, preserving the target", () => {
    // real content lives outside the source dir (mimics ~/.cc-switch/skills/X)
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ext-"));
    mkSkill(external, "tool-skill", "# real body");
    const srcDir = path.join(home, ".agents", "skills");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.symlinkSync(path.join(external, "tool-skill"), path.join(srcDir, "tool-skill"));

    const cs = skillsModuleSync().capture(ctx(), sel(["tool-skill"]));
    return Promise.resolve(cs).then((r) => {
      expect(r.written).toContain("tool-skill");
      const repoEntry = path.join(repo, "skills", "tool-skill");
      expect(fs.lstatSync(repoEntry).isSymbolicLink()).toBe(false); // real dir, not a symlink
      expect(fs.readFileSync(path.join(repoEntry, "SKILL.md"), "utf8")).toBe("# real body");
      // the external target is untouched
      expect(fs.existsSync(path.join(external, "tool-skill", "SKILL.md"))).toBe(true);
      fs.rmSync(external, { recursive: true, force: true });
    });
  });

  it("honors opts.from to pick a specific source directory", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "dup", "# from source");
    mkSkill(path.join(home, ".claude", "skills"), "dup", "# from claude");
    const cs = await skillsModule.capture(ctx(), sel(["dup"]), { from: { dup: "~/.claude/skills" } });
    expect(cs.written).toContain("dup");
    expect(fs.readFileSync(path.join(repo, "skills", "dup", "SKILL.md"), "utf8")).toBe("# from claude");
  });
});

// helper used above (capture is the same object; this just documents intent)
function skillsModuleSync() { return skillsModule; }

describe("discover classifies by real directory (origin)", () => {
  it("tags a bare source skill: linked:false, location ~/.agents/skills", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "bare1", "# bare");
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "bare1")!;
    expect(c.origin?.linked).toBe(false);
    expect(c.origin?.location).toBe("~/.agents/skills");
  });

  it("tags a symlinked source skill: linked:true, location = resolved dir", async () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ext2-"));
    fs.mkdirSync(path.join(external, "skills"), { recursive: true });
    mkSkill(path.join(external, "skills"), "linked1", "# x");
    const srcDir = path.join(home, ".agents", "skills");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.symlinkSync(path.join(external, "skills", "linked1"), path.join(srcDir, "linked1"));
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "linked1")!;
    expect(c.origin?.linked).toBe(true);
    expect(c.origin?.location).toBe(path.join(external, "skills")); // absolute (not under home → not collapsed)
    fs.rmSync(external, { recursive: true, force: true });
  });

  it("surfaces a repo entry stored as a symlink as needsRepair", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "broken1", "# real");
    // repo holds a symlink (the bug's footprint), not real content
    fs.mkdirSync(path.join(repo, "skills"), { recursive: true });
    fs.symlinkSync(path.join(home, ".agents", "skills", "broken1"), path.join(repo, "skills", "broken1"));
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "broken1");
    expect(c?.origin?.needsRepair).toBe(true);
  });

  it("skips dirs without SKILL.md and dotfile entries", async () => {
    const srcDir = path.join(home, ".agents", "skills");
    fs.mkdirSync(path.join(srcDir, "not-a-skill"), { recursive: true });   // no SKILL.md
    fs.writeFileSync(path.join(srcDir, "not-a-skill", "README.md"), "x");
    fs.mkdirSync(path.join(srcDir, ".system"), { recursive: true });        // dotfile
    fs.writeFileSync(path.join(srcDir, ".system", "SKILL.md"), "x");
    const ids = (await skillsModule.discover(ctx())).map((c) => c.id);
    expect(ids).not.toContain("not-a-skill");
    expect(ids).not.toContain(".system");
  });

  it("fills conflictLocations when same name differs across directories", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "dup2", "# A");
    mkSkill(path.join(home, ".claude", "skills"), "dup2", "# B");
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "dup2")!;
    expect((c.origin?.conflictLocations ?? []).length).toBe(2);
  });

  it("treats an empty repo dir (no SKILL.md) as needsRepair, not properly managed", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "empty1", "# real");
    fs.mkdirSync(path.join(repo, "skills", "empty1"), { recursive: true }); // empty, no SKILL.md
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "empty1");
    expect(c?.origin?.needsRepair).toBe(true);
  });

  it("a real source dir that is also symlinked into an IDE dir is reported by its source copy (linked:false)", async () => {
    // real content in the canonical source
    mkSkill(path.join(home, ".agents", "skills"), "dual", "# real");
    // an IDE dir symlinks the same name to a DIFFERENT external copy (same content)
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-dual-"));
    mkSkill(external, "dual", "# real");
    const ide = path.join(home, ".claude", "skills");
    fs.mkdirSync(ide, { recursive: true });
    fs.symlinkSync(path.join(external, "dual"), path.join(ide, "dual"));
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "dual")!;
    expect(c.origin?.location).toBe("~/.agents/skills"); // representative = the real source copy
    expect(c.origin?.linked).toBe(false); // shown copy is a real dir, not a symlink
    fs.rmSync(external, { recursive: true, force: true });
  });
});

describe("materializeSource (decouple)", () => {
  it("replaces a symlinked source with the repo's real content", async () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ext3-"));
    mkSkill(external, "dec1", "# real");
    const srcDir = path.join(home, ".agents", "skills");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.symlinkSync(path.join(external, "dec1"), path.join(srcDir, "dec1"));
    // repo already has the real content (post-capture)
    mkSkill(path.join(repo, "skills"), "dec1", "# real");

    const done = materializeSource(ctx(), ["dec1"]);
    expect(done).toEqual(["dec1"]);
    const srcEntry = path.join(srcDir, "dec1");
    expect(fs.lstatSync(srcEntry).isSymbolicLink()).toBe(false); // now a real dir
    expect(fs.readFileSync(path.join(srcEntry, "SKILL.md"), "utf8")).toBe("# real");
    fs.rmSync(external, { recursive: true, force: true });
  });

  it("dry-run makes no changes", async () => {
    mkSkill(path.join(repo, "skills"), "dec2", "# x");
    const dctx = { ...ctx(), dryRun: true };
    materializeSource(dctx, ["dec2"]);
    expect(fs.existsSync(path.join(home, ".agents", "skills", "dec2"))).toBe(false);
  });
});

describe("resolveSkillConflict (back up & take over)", () => {
  function setupConflict(method: "symlink" | "copy" = "symlink") {
    mkSkill(path.join(repo, "skills"), "foo", "# canonical foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), method, targets: ["claude"], skills: { foo: {} } });
    mkSkill(path.join(home, ".claude/skills"), "foo", "# USER's own foo");
    return path.join(home, ".claude/skills/foo");
  }

  it("moves the real dir to backups and symlinks the canonical source", async () => {
    const dest = setupConflict("symlink");
    const res = await resolveSkillConflict({ ...ctx() }, "foo", "claude");
    expect(fs.existsSync(res.backedUp)).toBe(true);
    expect(fs.readFileSync(path.join(res.backedUp, "SKILL.md"), "utf8")).toBe("# USER's own foo");
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(path.join(home, ".agents/skills/foo")));
    expect(loadSkillLinks(repo).some((l) => l.skill === "foo" && l.target === "claude")).toBe(true);
  });

  it("with method=copy takes over as a real copy (not a symlink)", async () => {
    const dest = setupConflict("copy");
    await resolveSkillConflict({ ...ctx() }, "foo", "claude");
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(dest, "SKILL.md"))).toBe(true);
  });

  it("refuses when target is already a symlink (not a conflict)", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    mkSkill(path.join(home, ".agents/skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    fs.mkdirSync(path.join(home, ".claude/skills"), { recursive: true });
    fs.symlinkSync(path.join(home, ".agents/skills/foo"), path.join(home, ".claude/skills/foo"));
    await expect(resolveSkillConflict({ ...ctx() }, "foo", "claude")).rejects.toThrow();
  });

  it("refuses when target is absent (nothing to resolve)", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    await expect(resolveSkillConflict({ ...ctx() }, "foo", "claude")).rejects.toThrow();
  });

  it("dry-run makes no changes", async () => {
    const dest = setupConflict("symlink");
    const res = await resolveSkillConflict({ ...ctx(), dryRun: true }, "foo", "claude");
    expect(fs.existsSync(res.backedUp)).toBe(false);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("# USER's own foo");
  });

  it("refuses when the target is a real dir Roost already owns (recorded link)", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), method: "copy", targets: ["claude"], skills: { foo: {} } });
    // a real dir at the target that IS recorded as a Roost-owned link (e.g. a prior copy-mode takeover)
    const dest = path.join(home, ".claude/skills/foo");
    mkSkill(path.join(home, ".claude/skills"), "foo", "# roost-managed copy");
    saveSkillLinks(repo, [{ skill: "foo", target: "claude", path: dest, kind: "copy" }]);
    await expect(resolveSkillConflict({ ...ctx() }, "foo", "claude")).rejects.toThrow();
    // guard fired before any mutation: the dir is untouched, no backup created
    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("# roost-managed copy");
  });
});

describe("unadoptSkills (forget, keep local)", () => {
  it("removes repo + config + link records but leaves source and links on disk", async () => {
    // managed: repo content + a config entry + a recorded IDE link
    mkSkill(path.join(repo, "skills"), "ua1", "# x");
    mkSkill(path.join(home, ".agents", "skills"), "ua1", "# x");        // live source
    const ideDir = path.join(home, ".claude", "skills");
    fs.mkdirSync(ideDir, { recursive: true });
    fs.symlinkSync(path.join(home, ".agents", "skills", "ua1"), path.join(ideDir, "ua1"));
    saveSkillsConfig(repo, { sourceDir: "~/.agents/skills", method: "symlink", targets: ["claude"], skills: { ua1: { enabled: true } } });
    saveSkillLinks(repo, [{ skill: "ua1", target: "claude", path: path.join(ideDir, "ua1"), kind: "symlink" }]);

    const removed = unadoptSkills(ctx(), ["ua1"]);
    expect(removed).toEqual(["ua1"]);
    expect(fs.existsSync(path.join(repo, "skills", "ua1"))).toBe(false);          // forgotten in repo
    expect(loadSkillsConfig(repo).skills.ua1).toBeUndefined();                    // config entry gone
    expect(loadSkillLinks(repo).find((l) => l.skill === "ua1")).toBeUndefined();  // link record gone
    expect(fs.existsSync(path.join(home, ".agents", "skills", "ua1", "SKILL.md"))).toBe(true); // source kept
    expect(fs.existsSync(path.join(ideDir, "ua1"))).toBe(true);                   // on-disk link kept
  });

  it("dry-run makes no changes", async () => {
    mkSkill(path.join(repo, "skills"), "ua2", "# x");
    unadoptSkills({ ...ctx(), dryRun: true }, ["ua2"]);
    expect(fs.existsSync(path.join(repo, "skills", "ua2"))).toBe(true);
  });
});

describe("skills drift/capture key off the managed set, not selection.yaml", () => {
  it("status reports drift for a managed skill whose source content changed (empty selection)", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# repo version");            // captured/managed copy
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# edited locally"); // live source, edited
    const rep = await skillsModule.status(ctx(), sel([]));
    expect(rep.items.find((i) => i.id === "foo")?.state).toBe("drift");
  });

  it("status reports synced when managed skill matches its source (empty selection)", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# same");
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# same");
    const rep = await skillsModule.status(ctx(), sel([]));
    expect(rep.items.find((i) => i.id === "foo")?.state).toBe("synced");
  });

  it("capture with empty selection re-captures managed skills (picks up source edits)", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# old repo");
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# new source");
    const cs = await skillsModule.capture(ctx(), sel([]));
    expect(cs.written).toContain("foo");
    expect(fs.readFileSync(path.join(repo, "skills", "foo", "SKILL.md"), "utf8")).toBe("# new source");
  });
});
