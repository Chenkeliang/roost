import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext, Selection, ApplyPlan } from "@roost/shared";
import { findGitRepos, repoInfo, projectsModule } from "./projects.js";
import { loadProjects } from "../projects.js";

// ── helpers ───────────────────────────────────────────────────────────────────

type FakeResponse = ExecResult | ((cmd: string, args: string[], opts?: { cwd?: string }) => ExecResult);

function makeFakeExec(responses: FakeResponse[]): {
  exec: Exec;
  calls: { cmd: string; args: string[]; opts?: { cwd?: string } }[];
} {
  const calls: { cmd: string; args: string[]; opts?: { cwd?: string } }[] = [];
  let idx = 0;
  const exec: Exec = {
    async run(cmd: string, args: string[], opts?: { cwd?: string }): Promise<ExecResult> {
      calls.push({ cmd, args, opts });
      const resp = responses[idx] ?? { code: 0, stdout: "", stderr: "" };
      idx++;
      if (typeof resp === "function") return resp(cmd, args, opts);
      return resp;
    },
  };
  return { exec, calls };
}

function makeCtx(
  overrides: Partial<ModuleContext> & { exec: Exec; home: string; repoDir: string },
): ModuleContext {
  return {
    profile: "base",
    dryRun: false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (key: string) => key,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-projects-module-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── findGitRepos ──────────────────────────────────────────────────────────────

describe("findGitRepos", () => {
  it("returns dirs that contain a .git entry", () => {
    // Repo A: has .git dir
    const repoA = path.join(tmpDir, "repoA");
    fs.mkdirSync(path.join(repoA, ".git"), { recursive: true });

    // Repo B: has .git file (worktree style)
    const repoB = path.join(tmpDir, "repoB");
    fs.mkdirSync(repoB, { recursive: true });
    fs.writeFileSync(path.join(repoB, ".git"), "gitdir: ../.git/worktrees/repoB");

    // Non-repo: plain dir
    const notRepo = path.join(tmpDir, "notRepo");
    fs.mkdirSync(notRepo, { recursive: true });

    const results = findGitRepos([tmpDir], 2);
    const resultSet = new Set(results);
    expect(resultSet.has(repoA)).toBe(true);
    expect(resultSet.has(repoB)).toBe(true);
    expect(resultSet.has(notRepo)).toBe(false);
  });

  it("does not recurse into .git directories", () => {
    const repoA = path.join(tmpDir, "repoA");
    // Create a nested dir inside .git
    fs.mkdirSync(path.join(repoA, ".git", "nested"), { recursive: true });
    // nested also has .git (should not be found)
    fs.mkdirSync(path.join(repoA, ".git", "nested", ".git"), { recursive: true });

    const results = findGitRepos([tmpDir], 4);
    // Should only have repoA, not the fake .git/nested/.git parent
    expect(results).toContain(repoA);
    expect(results.filter((r) => r.includes(".git")).length).toBe(0);
  });

  it("respects maxDepth", () => {
    // depth-3 repo: tmpDir/a/b/c with .git
    const deep = path.join(tmpDir, "a", "b", "c");
    fs.mkdirSync(path.join(deep, ".git"), { recursive: true });

    // maxDepth=2 from tmpDir means we look inside tmpDir/a/b but not tmpDir/a/b/c
    const results = findGitRepos([tmpDir], 2);
    expect(results).not.toContain(deep);

    // maxDepth=4 should find it
    const results4 = findGitRepos([tmpDir], 4);
    expect(results4).toContain(deep);
  });

  it("deduplicates repos when multiple roots overlap", () => {
    const repo = path.join(tmpDir, "proj");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });

    const results = findGitRepos([tmpDir, tmpDir], 2);
    expect(results.filter((r) => r === repo)).toHaveLength(1);
  });

  it("tolerates unreadable directories without throwing", () => {
    // We can't easily make unreadable on macOS without sudo, but at minimum
    // a non-existent root should not throw.
    const results = findGitRepos([path.join(tmpDir, "doesnotexist")], 2);
    expect(Array.isArray(results)).toBe(true);
  });
});

// ── repoInfo ──────────────────────────────────────────────────────────────────

describe("repoInfo", () => {
  it("parses remote, branch, dirty flag from fake exec", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "git@github.com:user/repo.git\n", stderr: "" }, // remote get-url origin
      { code: 0, stdout: "main\n", stderr: "" },                          // branch --show-current
      { code: 0, stdout: " M somefile.ts\n", stderr: "" },               // status --porcelain (dirty)
    ]);
    const info = await repoInfo(exec, "/fake/dir");
    expect(info.remote).toBe("git@github.com:user/repo.git");
    expect(info.branch).toBe("main");
    expect(info.dirty).toBe(true);
    expect(info.hasMise).toBe(false);
  });

  it("returns remote=null when git remote get-url fails", async () => {
    const { exec } = makeFakeExec([
      { code: 128, stdout: "", stderr: "error: No such remote 'origin'" },
      { code: 0, stdout: "feat\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const info = await repoInfo(exec, "/fake/dir");
    expect(info.remote).toBeNull();
  });

  it("returns dirty=false when porcelain output is empty", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "https://github.com/x/y.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" }, // clean
    ]);
    const info = await repoInfo(exec, "/fake/dir");
    expect(info.dirty).toBe(false);
  });

  it("detects hasMise=true when .mise.toml exists", async () => {
    const repoDir = path.join(tmpDir, "miseRepo");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".mise.toml"), "[tools]\nnode = '20'\n");

    const { exec } = makeFakeExec([
      { code: 0, stdout: "git@github.com:u/r.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const info = await repoInfo(exec, repoDir);
    expect(info.hasMise).toBe(true);
  });
});

// ── discover ──────────────────────────────────────────────────────────────────

describe("projectsModule.discover", () => {
  it("emits track candidate for repo with remote", async () => {
    // Create a real .git dir in home
    const home = tmpDir;
    const repoPath = path.join(home, "myproject");
    fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });

    const { exec } = makeFakeExec([
      // repoInfo for myproject: remote present, clean
      { code: 0, stdout: "https://github.com/u/myproject.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, home, repoDir: tmpDir });
    const candidates = await projectsModule.discover(ctx);
    const c = candidates.find((x) => x.id === repoPath);
    expect(c).toBeDefined();
    expect(c!.recommendation).toBe("track");
    expect(c!.category).toBe("projects");
  });

  it("includes note 'no remote' for repo without remote", async () => {
    const home = tmpDir;
    const repoPath = path.join(home, "localonly");
    fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });

    const { exec } = makeFakeExec([
      // remote get-url fails
      { code: 128, stdout: "", stderr: "error: No such remote" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, home, repoDir: tmpDir });
    const candidates = await projectsModule.discover(ctx);
    const c = candidates.find((x) => x.id === repoPath);
    expect(c).toBeDefined();
    expect(c!.note).toMatch(/no remote/i);
  });
});

// ── capture ───────────────────────────────────────────────────────────────────

describe("projectsModule.capture", () => {
  it("writes a ProjectEntry with envTool=mise when .mise.toml exists", async () => {
    const home = tmpDir;
    const repoPath = path.join(home, "proj");
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(path.join(repoPath, ".mise.toml"), "[tools]\n");

    const { exec } = makeFakeExec([
      { code: 0, stdout: "git@github.com:u/proj.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const repoDir = path.join(tmpDir, "roost-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const ctx = makeCtx({ exec, home, repoDir });
    const sel: Selection = { modules: { projects: [repoPath] } };

    const cs = await projectsModule.capture(ctx, sel);
    expect(cs.module).toBe("projects");
    expect(cs.written).toContain("roost/projects.yaml");

    const doc = loadProjects(repoDir);
    const entry = doc.projects.find((e) => e.path === repoPath);
    expect(entry).toBeDefined();
    expect(entry!.envTool).toBe("mise");
    expect(entry!.repo).toBe("git@github.com:u/proj.git");
  });

  it("writes envTool=none when no .mise.toml", async () => {
    const home = tmpDir;
    const repoPath = path.join(home, "nomise");
    fs.mkdirSync(repoPath, { recursive: true });
    // no .mise.toml

    const { exec } = makeFakeExec([
      { code: 0, stdout: "https://github.com/u/nomise.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const repoDir = path.join(tmpDir, "roost-repo2");
    fs.mkdirSync(repoDir, { recursive: true });
    const ctx = makeCtx({ exec, home, repoDir });
    const sel: Selection = { modules: { projects: [repoPath] } };

    await projectsModule.capture(ctx, sel);
    const doc = loadProjects(repoDir);
    const entry = doc.projects.find((e) => e.path === repoPath);
    expect(entry!.envTool).toBe("none");
  });

  it("merges by path (upsert) without duplicating entries", async () => {
    const home = tmpDir;
    const repoPath = path.join(home, "dup");
    fs.mkdirSync(repoPath, { recursive: true });

    const makeExecForCapture = () =>
      makeFakeExec([
        { code: 0, stdout: "https://github.com/u/dup.git\n", stderr: "" },
        { code: 0, stdout: "main\n", stderr: "" },
        { code: 0, stdout: "", stderr: "" },
      ]);

    const repoDir = path.join(tmpDir, "roost-repo3");
    fs.mkdirSync(repoDir, { recursive: true });

    // Capture twice
    const sel: Selection = { modules: { projects: [repoPath] } };
    await projectsModule.capture(makeCtx({ exec: makeExecForCapture().exec, home, repoDir }), sel);
    await projectsModule.capture(makeCtx({ exec: makeExecForCapture().exec, home, repoDir }), sel);

    const doc = loadProjects(repoDir);
    expect(doc.projects.filter((e) => e.path === repoPath)).toHaveLength(1);
  });
});

// ── apply ─────────────────────────────────────────────────────────────────────

describe("projectsModule.apply", () => {
  function makePlan(ids: string[]): ApplyPlan {
    return {
      module: "projects",
      actions: ids.map((id) => ({ id, kind: "create" as const, target: id })),
    };
  }

  it("clones a missing repo when a remote is set", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "roost-repo");
    const targetPath = path.join(tmpDir, "cloned-project");

    // Write projects.yaml with one entry (path does not exist on disk)
    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [{ path: targetPath, repo: "https://github.com/u/p.git", envTool: "none" }],
    });

    const { exec, calls } = makeFakeExec([
      // git clone
      { code: 0, stdout: "", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, home, repoDir, dryRun: false });
    const plan = makePlan([targetPath]);
    const result = await projectsModule.apply(ctx, plan);

    const cloneCall = calls.find((c) => c.cmd === "git" && c.args.includes("clone"));
    expect(cloneCall).toBeDefined();
    expect(cloneCall!.args).toContain("https://github.com/u/p.git");
    expect(cloneCall!.args).toContain(targetPath);
    expect(result.applied).toContain(targetPath);
  });

  it("pulls an existing clean repo", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "roost-repo4");
    const existingRepo = path.join(tmpDir, "existing");
    fs.mkdirSync(path.join(existingRepo, ".git"), { recursive: true });

    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [{ path: existingRepo, repo: "https://github.com/u/e.git", envTool: "none" }],
    });

    const { exec, calls } = makeFakeExec([
      // repoInfo: remote, branch, status (clean)
      { code: 0, stdout: "https://github.com/u/e.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
      // git pull --ff-only
      { code: 0, stdout: "Already up to date.\n", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, home, repoDir, dryRun: false });
    const plan = makePlan([existingRepo]);
    const result = await projectsModule.apply(ctx, plan);

    const pullCall = calls.find((c) => c.cmd === "git" && c.args.includes("pull"));
    expect(pullCall).toBeDefined();
    expect(pullCall!.args).toContain("--ff-only");
    expect(result.applied).toContain(existingRepo);
  });

  it("skips existing dirty repo (no pull)", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "roost-repo5");
    const dirtyRepo = path.join(tmpDir, "dirty");
    fs.mkdirSync(path.join(dirtyRepo, ".git"), { recursive: true });

    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [{ path: dirtyRepo, repo: "https://github.com/u/d.git", envTool: "none" }],
    });

    const { exec, calls } = makeFakeExec([
      // repoInfo: remote, branch, dirty status
      { code: 0, stdout: "https://github.com/u/d.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: " M dirty.ts\n", stderr: "" },
    ]);
    const warnMessages: string[] = [];
    const ctx = makeCtx({
      exec,
      home,
      repoDir,
      dryRun: false,
      log: { info: () => {}, warn: (m) => warnMessages.push(m), error: () => {} },
    });
    const plan = makePlan([dirtyRepo]);
    const result = await projectsModule.apply(ctx, plan);

    const pullCall = calls.find((c) => c.cmd === "git" && c.args.includes("pull"));
    expect(pullCall).toBeUndefined();
    expect(result.skipped).toContain(dirtyRepo);
  });

  it("runs mise install after clone when envTool=mise and .mise.toml exists", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "roost-repo6");
    const targetPath = path.join(tmpDir, "mise-proj");
    // Create .mise.toml in the target path (simulates post-clone state)
    fs.mkdirSync(targetPath, { recursive: true });
    fs.writeFileSync(path.join(targetPath, ".mise.toml"), "[tools]\nnode='20'\n");

    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [
        { path: targetPath, repo: "https://github.com/u/mise-proj.git", envTool: "mise" },
      ],
    });

    // Target already exists, so apply will do pull path (not clone)
    // For simplicity, let's mark it clean so pull runs
    const { exec, calls } = makeFakeExec([
      // repoInfo: remote, branch, clean
      { code: 0, stdout: "https://github.com/u/mise-proj.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
      // git pull --ff-only
      { code: 0, stdout: "Already up to date.\n", stderr: "" },
      // mise install
      { code: 0, stdout: "", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, home, repoDir, dryRun: false });
    const plan = makePlan([targetPath]);
    await projectsModule.apply(ctx, plan);

    const miseCall = calls.find((c) => c.cmd === "mise" && c.args.includes("install"));
    expect(miseCall).toBeDefined();
    expect(miseCall!.opts?.cwd).toBe(targetPath);
  });

  it("clone returning non-zero puts path in skipped, not applied", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "roost-repo-clone-fail");
    const targetPath = path.join(tmpDir, "clone-fail-proj");

    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [{ path: targetPath, repo: "https://github.com/u/fail.git", envTool: "none" }],
    });

    const { exec } = makeFakeExec([
      // git clone returns non-zero
      { code: 1, stdout: "", stderr: "fatal: repository not found" },
    ]);
    const warnMessages: string[] = [];
    const ctx = makeCtx({
      exec,
      home,
      repoDir,
      dryRun: false,
      log: { info: () => {}, warn: (m) => warnMessages.push(m), error: () => {} },
    });
    const plan = makePlan([targetPath]);
    const result = await projectsModule.apply(ctx, plan);

    expect(result.skipped).toContain(targetPath);
    expect(result.applied).not.toContain(targetPath);
    expect(warnMessages.some((m) => m.includes("clone failed"))).toBe(true);
  });

  it("existing repo with no remote is skipped without pulling", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "roost-repo-no-remote");
    const existingRepo = path.join(tmpDir, "local-only-repo");
    fs.mkdirSync(path.join(existingRepo, ".git"), { recursive: true });

    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [{ path: existingRepo, repo: null, envTool: "none" }],
    });

    const { exec, calls } = makeFakeExec([
      // repoInfo: remote=null, branch, clean
      { code: 128, stdout: "", stderr: "error: No such remote 'origin'" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const warnMessages: string[] = [];
    const ctx = makeCtx({
      exec,
      home,
      repoDir,
      dryRun: false,
      log: { info: () => {}, warn: (m) => warnMessages.push(m), error: () => {} },
    });
    const plan = makePlan([existingRepo]);
    const result = await projectsModule.apply(ctx, plan);

    // No pull attempted
    const pullCall = calls.find((c) => c.cmd === "git" && c.args.includes("pull"));
    expect(pullCall).toBeUndefined();
    expect(result.skipped).toContain(existingRepo);
    expect(result.applied).not.toContain(existingRepo);
    expect(warnMessages.some((m) => m.includes("no remote"))).toBe(true);
  });

  it("pull returning non-zero puts path in skipped, not applied", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "roost-repo-pull-fail");
    const existingRepo = path.join(tmpDir, "pull-fail-repo");
    fs.mkdirSync(path.join(existingRepo, ".git"), { recursive: true });

    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [{ path: existingRepo, repo: "https://github.com/u/r.git", envTool: "none" }],
    });

    const { exec } = makeFakeExec([
      // repoInfo: remote, branch, clean
      { code: 0, stdout: "https://github.com/u/r.git\n", stderr: "" },
      { code: 0, stdout: "main\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
      // git pull --ff-only fails
      { code: 1, stdout: "", stderr: "fatal: Not possible to fast-forward" },
    ]);
    const warnMessages: string[] = [];
    const ctx = makeCtx({
      exec,
      home,
      repoDir,
      dryRun: false,
      log: { info: () => {}, warn: (m) => warnMessages.push(m), error: () => {} },
    });
    const plan = makePlan([existingRepo]);
    const result = await projectsModule.apply(ctx, plan);

    expect(result.skipped).toContain(existingRepo);
    expect(result.applied).not.toContain(existingRepo);
    expect(warnMessages.some((m) => m.includes("pull failed"))).toBe(true);
  });

  it("dryRun=true: skips all operations", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "roost-repo7");
    const targetPath = path.join(tmpDir, "dry-proj");

    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [{ path: targetPath, repo: "https://github.com/u/dry.git", envTool: "none" }],
    });

    const { exec, calls } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home, repoDir, dryRun: true });
    const plan = makePlan([targetPath]);
    const result = await projectsModule.apply(ctx, plan);

    expect(calls).toHaveLength(0);
    expect(result.skipped).toContain(targetPath);
    expect(result.applied).toHaveLength(0);
  });
});

// ── unmanage ──────────────────────────────────────────────────────────────────

describe("projectsModule.unmanage", () => {
  it("removes selected paths from projects.yaml and returns applied", async () => {
    const repoDir = path.join(tmpDir, "roost-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const pathA = "/home/user/projects/alpha";
    const pathB = "/home/user/projects/beta";

    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [
        { path: pathA, repo: "https://github.com/u/alpha.git", envTool: "none" },
        { path: pathB, repo: "https://github.com/u/beta.git", envTool: "none" },
      ],
    });

    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: tmpDir, repoDir });
    const sel: Selection = { modules: { projects: [pathA] } };
    const result = await projectsModule.unmanage(ctx, sel);

    expect(result.module).toBe("projects");
    expect(result.applied).toContain(pathA);
    expect(result.applied).not.toContain(pathB);

    // Verify on-disk state: only pathB remains
    const { loadProjects } = await import("../projects.js");
    const doc = loadProjects(repoDir);
    expect(doc.projects.some((e) => e.path === pathA)).toBe(false);
    expect(doc.projects.some((e) => e.path === pathB)).toBe(true);
  });

  it("returns empty result when no ids are in selection", async () => {
    const repoDir = path.join(tmpDir, "roost-repo2");
    fs.mkdirSync(repoDir, { recursive: true });

    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: tmpDir, repoDir });
    const sel: Selection = { modules: {} };
    const result = await projectsModule.unmanage(ctx, sel);

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("logs a git history warning when projects are removed", async () => {
    const repoDir = path.join(tmpDir, "roost-repo3");
    fs.mkdirSync(repoDir, { recursive: true });
    const { saveProjects } = await import("../projects.js");
    saveProjects(repoDir, {
      schemaVersion: 1,
      projects: [{ path: "/home/user/alpha", repo: "https://github.com/u/alpha.git", envTool: "none" }],
    });

    const { exec } = makeFakeExec([]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      home: tmpDir,
      repoDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = { modules: { projects: ["/home/user/alpha"] } };
    await projectsModule.unmanage(ctx, sel);

    expect(warnSpy).toHaveBeenCalled();
    const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
    expect(msg).toMatch(/git.*history|history.*git/i);
    expect(msg).toMatch(/filter-repo|BFG/i);
  });

  it("does NOT log git history warning when nothing is removed", async () => {
    const repoDir = path.join(tmpDir, "roost-repo4");
    fs.mkdirSync(repoDir, { recursive: true });

    const { exec } = makeFakeExec([]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      home: tmpDir,
      repoDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = { modules: {} };
    await projectsModule.unmanage(ctx, sel);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── doctor ────────────────────────────────────────────────────────────────────

describe("projectsModule.doctor", () => {
  it("reports git and mise healthy when both succeed", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "git version 2.39.0\n", stderr: "" },
      { code: 0, stdout: "mise 2024.1.0\n", stderr: "" },
    ]);
    const home = tmpDir;
    const repoDir = tmpDir;
    const ctx = makeCtx({ exec, home, repoDir });
    const health = await projectsModule.doctor(ctx);

    const git = health.find((h) => h.name === "git");
    const mise = health.find((h) => h.name === "mise");
    expect(git?.ok).toBe(true);
    expect(mise?.ok).toBe(true);
    expect(mise?.detail).toBeUndefined();
  });

  it("reports mise not ok when mise is absent, with detail", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "git version 2.39.0\n", stderr: "" },
      { code: 127, stdout: "", stderr: "mise: command not found" },
    ]);
    const ctx = makeCtx({ exec, home: tmpDir, repoDir: tmpDir });
    const health = await projectsModule.doctor(ctx);

    const mise = health.find((h) => h.name === "mise");
    expect(mise?.ok).toBe(false);
    expect(mise?.detail).toMatch(/mise not found/i);
  });

  it("reports git not ok when git is absent", async () => {
    const { exec } = makeFakeExec([
      { code: 127, stdout: "", stderr: "git: command not found" },
      { code: 0, stdout: "mise 2024.1.0\n", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, home: tmpDir, repoDir: tmpDir });
    const health = await projectsModule.doctor(ctx);

    const git = health.find((h) => h.name === "git");
    expect(git?.ok).toBe(false);
  });
});
