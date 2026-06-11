import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  Exec,
  ExecResult,
  ModuleContext,
  SyncModule,
  Selection,
  DriftReport,
  ChangeSet,
  ApplyResult,
  Health,
  Candidate,
  ApplyPlan,
} from "@roost/shared";
import { ModuleRegistry, saveSelection, loadSelection, emptySelection, addItem, defaultRegistry, createExec, saveEnvData, skillsModule, loadSkillsTargets } from "@roost/core";
import { buildServer, computeConflicts, classifyGitError } from "./server.js";
import { ensureGitRepo } from "./gitRepo.js";

// A real-exec ctx so git commits actually run (for capture finalization tests).
function makeRealCtx(repoDir: string, dryRun = false): ModuleContext {
  return {
    repoDir,
    home: os.homedir(),
    profile: "base",
    dryRun,
    exec: createExec(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (k: string) => k,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFakeExec(): Exec {
  const ok: ExecResult = { code: 0, stdout: "", stderr: "" };
  return { async run(): Promise<ExecResult> { return ok; } };
}

// A stateful git fake: tracks origin + repo state so init/remote round-trips are testable.
function makeGitFake(opts?: { isRepo?: boolean; origin?: string; cloneFails?: boolean }): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  let origin: string | null = opts?.origin ?? null;
  let isRepo = opts?.isRepo ?? false;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push([cmd, ...args]);
      const a = args.join(" ");
      if (cmd !== "git") return { code: 0, stdout: "", stderr: "" };
      if (a.includes("rev-parse --is-inside-work-tree")) return { code: isRepo ? 0 : 1, stdout: isRepo ? "true" : "", stderr: "" };
      if (a.includes("init -b main")) { isRepo = true; return { code: 0, stdout: "", stderr: "" }; }
      if (a.includes("rev-parse --verify HEAD")) return { code: 0, stdout: "abc123", stderr: "" };
      if (a.includes("remote get-url origin")) return origin ? { code: 0, stdout: origin, stderr: "" } : { code: 1, stdout: "", stderr: "no origin" };
      if (a.includes("remote add origin")) { origin = args[args.length - 1] ?? null; return { code: 0, stdout: "", stderr: "" }; }
      if (a.includes("remote set-url origin")) { origin = args[args.length - 1] ?? null; return { code: 0, stdout: "", stderr: "" }; }
      if (a.startsWith("clone")) return opts?.cloneFails ? { code: 1, stdout: "", stderr: "fatal: destination path already exists" } : { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { exec, calls };
}

function makeCtx(repoDir: string, dryRun = false): ModuleContext {
  return {
    repoDir,
    home: os.homedir(),
    profile: "base",
    dryRun,
    exec: makeFakeExec(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (k: string) => k,
  };
}

/**
 * Builds a fake SyncModule with configurable status/capture/apply callbacks.
 */
function makeFakeModule(opts: {
  name: string;
  statusFn?: (ctx: ModuleContext, sel: Selection) => Promise<DriftReport>;
  captureFn?: (ctx: ModuleContext, sel: Selection) => Promise<ChangeSet>;
  applyFn?: (ctx: ModuleContext, plan: ApplyPlan) => Promise<ApplyResult>;
  doctorFn?: (ctx: ModuleContext) => Promise<Health[]>;
}): SyncModule {
  return {
    name: opts.name,
    async discover(): Promise<Candidate[]> { return []; },
    async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
      if (opts.statusFn) return opts.statusFn(ctx, sel);
      return { module: opts.name, items: [] };
    },
    async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
      if (opts.captureFn) return opts.captureFn(ctx, sel);
      return { module: opts.name, written: [], encrypted: [] };
    },
    async apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult> {
      if (opts.applyFn) return opts.applyFn(ctx, plan);
      const ids = plan.actions.map((a) => a.id);
      if (ctx.dryRun) return { module: opts.name, applied: [], backedUp: [], skipped: ids };
      return { module: opts.name, applied: ids, backedUp: [], skipped: [] };
    },
    async diff(): Promise<string> { return ""; },
    async unmanage(): Promise<ApplyResult> { return { module: opts.name, applied: [], backedUp: [], skipped: [] }; },
    async doctor(ctx: ModuleContext): Promise<Health[]> {
      if (opts.doctorFn) return opts.doctorFn(ctx);
      return [];
    },
  };
}

// ── test state ────────────────────────────────────────────────────────────────

let tmpDir: string;
let importHome: string; // isolated $HOME for skill-import tests (never the real home)

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-server-test-"));
  importHome = fs.mkdtempSync(path.join(os.tmpdir(), "roost-imp-home-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(importHome, { recursive: true, force: true });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("buildServer", () => {
  it("GET /api/health → 200 { ok: true, name: hostname, repoDir, ageKey }", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; name: string; repoDir: string; ageKey: boolean };
    expect(body.ok).toBe(true);
    expect(body.name).toBe(os.hostname());
    expect(body.repoDir).toBe(tmpDir);
    expect(typeof body.ageKey).toBe("boolean");
    await server.close();
  });

  it("becomes ready with a RELATIVE webDir (docs show --web packages/web/dist)", async () => {
    // @fastify/static rejects a non-absolute root; the server must resolve it.
    // Regression for the documented `roost serve --web packages/web/dist`.
    const webAbs = fs.mkdtempSync(path.join(os.tmpdir(), "roost-web-"));
    fs.writeFileSync(path.join(webAbs, "index.html"), "<!doctype html>");
    const relWeb = path.relative(process.cwd(), webAbs);
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d), webDir: relWeb });
    await expect(server.ready()).resolves.toBeDefined();
    await server.close();
    fs.rmSync(webAbs, { recursive: true, force: true });
  });

  it("POST /api/env/apply regenerates env.sh and returns a reload command for the current shell", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-home-"));
    saveEnvData(tmpDir, {
      schemaVersion: 2,
      aliases: [
        { kind: "alias", name: "gps", value: "git push", enabled: true },
        { kind: "alias", name: "gp", value: "git pull", enabled: false },
      ],
      env: [],
      path: [],
      functions: [],
    });
    const reg = defaultRegistry();
    const ctx = (dryRun: boolean): ModuleContext => ({
      repoDir: tmpDir, home, profile: "base", dryRun, exec: createExec(),
      log: { info: () => {}, warn: () => {}, error: () => {} }, t: (k: string) => k,
    });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: ctx });
    const res = await server.inject({ method: "POST", url: "/api/env/apply" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { applied: string[]; reload: string };
    // The live env.sh was regenerated: enabled alias present, disabled one gone.
    const sh = fs.readFileSync(path.join(home, ".config", "roost", "env.sh"), "utf8");
    expect(sh).toContain("alias gps='git push'");
    expect(sh).not.toContain("alias gp=");
    // The reload command resets the CURRENT shell (unalias all managed names, re-source).
    expect(body.reload).toContain("unalias gps gp");
    expect(body.reload).toContain("source");
    expect(body.reload).toContain("env.sh");
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("GET /api/modules → 200 lists registered module names", async () => {
    const reg = new ModuleRegistry();
    reg.register(makeFakeModule({ name: "alpha" }));
    reg.register(makeFakeModule({ name: "beta" }));
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/modules" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ modules: ["alpha", "beta"] });
    await server.close();
  });

  it("GET /api/selection → 200 returns the saved selection document", async () => {
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", "/home/user/.zshrc");
    saveSelection(tmpDir, sel);
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/selection" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { schemaVersion: number; modules: Record<string, string[]> };
    expect(body.modules["dotfiles"]).toContain("/home/user/.zshrc");
    await server.close();
  });

  it("GET /api/status → 200 { reports: DriftReport[] }", async () => {
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        statusFn: async () => ({
          module: "dotfiles",
          items: [{ id: "~/.zshrc", state: "synced" as const }],
        }),
      }),
    );
    // save a selection so statusAll has something to report
    const sel = emptySelection();
    saveSelection(tmpDir, sel);
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reports: DriftReport[] };
    expect(Array.isArray(body.reports)).toBe(true);
    expect(body.reports.some((r) => r.module === "dotfiles")).toBe(true);
    await server.close();
  });

  it("GET /api/sync-state → 200 with counts/overall derived from three-way hashes", async () => {
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        statusFn: async () => ({
          module: "dotfiles",
          items: [
            { id: "behind", state: "drift" as const, localHash: null, repoHash: "r", baselineHash: null },
            { id: "div", state: "conflict" as const, localHash: "a", repoHash: "b", baselineHash: "o" },
          ],
        }),
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/sync-state" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: { id: string; direction: string; exception: string | null }[];
      counts: { auto: number; diverged: number };
      overall: string;
    };
    expect(body.counts.auto).toBe(1);
    expect(body.counts.diverged).toBe(1);
    expect(body.overall).toBe("diverged");
    expect(body.items.find((i) => i.id === "div")!.exception).toBe("diverged");
    await server.close();
  });

  it("GET /api/environment → reports missing required tools", async () => {
    const reg = new ModuleRegistry();
    // exec where only git is present
    const exec = {
      async run(cmd: string) {
        return cmd === "git" ? { code: 0, stdout: "v", stderr: "" } : { code: 127, stdout: "", stderr: "nf" };
      },
    };
    const server = buildServer({
      repoDir: tmpDir,
      registry: reg,
      makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }),
    });
    const res = await server.inject({ method: "GET", url: "/api/environment" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { checks: { id: string; ok: boolean; brewFormula?: string }[] };
    const by = Object.fromEntries(body.checks.map((c) => [c.id, c]));
    expect(by["git"]!.ok).toBe(true);
    expect(by["chezmoi"]!.ok).toBe(false);
    expect(by["chezmoi"]!.brewFormula).toBe("chezmoi");
    await server.close();
  });

  it("POST /api/environment/install runs brew install; 400 on empty", async () => {
    const reg = new ModuleRegistry();
    const calls: { cmd: string; args: string[] }[] = [];
    const exec = {
      async run(cmd: string, args: string[]) {
        calls.push({ cmd, args });
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const server = buildServer({
      repoDir: tmpDir,
      registry: reg,
      makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }),
    });
    const ok = await server.inject({ method: "POST", url: "/api/environment/install", payload: { formulae: ["chezmoi", "age"] } });
    expect(ok.statusCode).toBe(200);
    expect(calls.find((c) => c.cmd === "brew" && c.args[0] === "install")?.args).toEqual(["install", "chezmoi", "age"]);
    const bad = await server.inject({ method: "POST", url: "/api/environment/install", payload: { formulae: [] } });
    expect(bad.statusCode).toBe(400);
    await server.close();
  });

  it("POST /api/resolve take-repo is BLOCKED when a required tool is missing", async () => {
    let applied = false;
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        doctorFn: async () => [{ name: "chezmoi", ok: false, blocking: true }],
        applyFn: async () => {
          applied = true;
          return { module: "dotfiles", applied: [], backedUp: [], skipped: [] };
        },
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/resolve", payload: { module: "dotfiles", id: "x", action: "take-repo" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { blocked?: boolean };
    expect(body.blocked).toBe(true);
    expect(applied).toBe(false);
    await server.close();
  });

  it("GET /api/item-diff → 200 with local/repo for an appconfig domain", async () => {
    const dir = path.join(tmpDir, "roost", "appconfig");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "com.example.app.plist"), "<plist>REPO</plist>", "utf8");
    const reg = new ModuleRegistry();
    const server = buildServer({
      repoDir: tmpDir,
      registry: reg,
      makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec: { async run() { return { code: 0, stdout: "<plist>LIVE</plist>", stderr: "" }; } } }),
    });
    const res = await server.inject({
      method: "GET",
      url: "/api/item-diff?module=appconfig&id=domain:com.example.app",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { kind: string; local: string | null; repo: string | null };
    expect(body.kind).toBe("text");
    expect(body.local).toBe("<plist>LIVE</plist>");
    expect(body.repo).toBe("<plist>REPO</plist>");
    await server.close();
  });

  it("GET /api/item-diff → 400 when params missing", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/item-diff?module=appconfig" });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  // exec that fakes `git clone …<dest>` and `ditto -x -k …<dest>` by writing a
  // SKILL.md into the destination dir, so import endpoints are testable offline.
  const fakeImportExec = {
    async run(cmd: string, args: string[]) {
      const dest = cmd === "git" ? args[args.length - 1] : cmd === "ditto" ? args[3] : null;
      if (dest) {
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "SKILL.md"), "---\nname: remote-skill\n---\n# x", "utf8");
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };

  it("POST /api/skills/import-git clones + ingests a skill into the source dir", async () => {
    const reg = new ModuleRegistry();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-imp-home-"));
    try {
      const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), home, exec: fakeImportExec }) });
      const res = await server.inject({ method: "POST", url: "/api/skills/import-git", payload: { url: "https://github.com/me/skill.git" } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { imported: string[] }).imported).toContain("remote-skill");
      // Lands in source (→ Discover), not the repo.
      expect(fs.existsSync(path.join(home, ".agents", "skills", "remote-skill", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "skills", "remote-skill"))).toBe(false);
      await server.close();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("POST /api/skills/import-git → 400 on a non-URL", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/import-git", payload: { url: "not a url" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it("POST /api/skills/import-zip ingests an uploaded zip", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), home: importHome, exec: fakeImportExec }) });
    const dataBase64 = Buffer.from("PK fake zip bytes").toString("base64");
    const res = await server.inject({ method: "POST", url: "/api/skills/import-zip", payload: { filename: "remote-skill.zip", dataBase64 } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { imported: string[] }).imported).toContain("remote-skill");
    await server.close();
  });

  it("POST /api/skills/import-zip → 400 without data", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/import-zip", payload: {} });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it("import-scan lists skills, then import-apply ingests only the selected ones", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), home: importHome, exec: fakeImportExec }) });
    const scan = await server.inject({ method: "POST", url: "/api/skills/import-scan", payload: { url: "https://github.com/me/pack.git" } });
    expect(scan.statusCode).toBe(200);
    const sb = scan.json() as { token: string; skills: { name: string }[] };
    expect(sb.token).toBeTruthy();
    expect(sb.skills.map((s) => s.name)).toContain("remote-skill");
    const apply = await server.inject({ method: "POST", url: "/api/skills/import-apply", payload: { token: sb.token, names: ["remote-skill"] } });
    expect(apply.statusCode).toBe(200);
    expect((apply.json() as { imported: string[] }).imported).toContain("remote-skill");
    expect(fs.existsSync(path.join(importHome, ".agents", "skills", "remote-skill", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "skills", "remote-skill"))).toBe(false);
    await server.close();
  });

  it("POST /api/skills/import-apply → 400 on unknown token", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/import-apply", payload: { token: "nope", names: [] } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it("POST /api/resolve take-repo → applies just that item", async () => {
    const reg = new ModuleRegistry();
    const applied: string[] = [];
    reg.register(
      makeFakeModule({
        name: "appconfig",
        statusFn: async () => ({ module: "appconfig", items: [] }),
        applyFn: async (_ctx, plan) => {
          for (const a of plan.actions) applied.push(a.id);
          return { module: "appconfig", applied: plan.actions.map((a) => a.id), backedUp: [], skipped: [] };
        },
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({
      method: "POST",
      url: "/api/resolve",
      payload: { module: "appconfig", id: "domain:x", action: "take-repo" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; applied: string[] };
    expect(body.ok).toBe(true);
    expect(body.applied).toContain("domain:x");
    expect(applied).toEqual(["domain:x"]);
    await server.close();
  });

  it("POST /api/resolve keep-local → no-op, applies nothing", async () => {
    const reg = new ModuleRegistry();
    let applyCalled = false;
    reg.register(
      makeFakeModule({
        name: "appconfig",
        statusFn: async () => ({ module: "appconfig", items: [] }),
        applyFn: async () => {
          applyCalled = true;
          return { module: "appconfig", applied: [], backedUp: [], skipped: [] };
        },
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({
      method: "POST",
      url: "/api/resolve",
      payload: { module: "appconfig", id: "domain:x", action: "keep-local" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { applied: string[] }).applied).toEqual([]);
    expect(applyCalled).toBe(false);
    await server.close();
  });

  it("POST /api/resolve → 400 when fields missing", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/resolve", payload: { module: "x" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it("POST /api/load apply=true is BLOCKED when a required tool is missing", async () => {
    let applied = false;
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        doctorFn: async () => [{ name: "chezmoi", ok: false, blocking: true, detail: "not installed" }],
        applyFn: async () => {
          applied = true;
          return { module: "dotfiles", applied: [], backedUp: [], skipped: [] };
        },
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/load", payload: { apply: true } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { blocked?: boolean; blockers?: { name: string }[] };
    expect(body.blocked).toBe(true);
    expect(body.blockers?.[0]?.name).toBe("chezmoi");
    expect(applied).toBe(false);
    await server.close();
  });

  it("POST /api/load dry-run still previews even with a blocking failure", async () => {
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        doctorFn: async () => [{ name: "chezmoi", ok: false, blocking: true }],
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/load", payload: { apply: false } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { blocked?: boolean; results?: unknown[] };
    expect(body.blocked).toBeUndefined();
    expect(Array.isArray(body.results)).toBe(true);
    await server.close();
  });

  it("GET /api/preflight → 200 { ok, blockers, checks }", async () => {
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "packages",
        doctorFn: async () => [{ name: "brew", ok: false, blocking: true }],
      }),
    );
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/preflight" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; blockers: { name: string }[] };
    expect(body.ok).toBe(false);
    expect(body.blockers[0]?.name).toBe("brew");
    await server.close();
  });

  it("GET /api/machines → 200 { hosts: string[], states: Record<string, unknown> }", async () => {
    // Write a fake state file
    const stateDir = path.join(tmpDir, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const stateObj = { host: "myhost", schemaVersion: 1, capturedAt: null, modules: {} };
    fs.writeFileSync(path.join(stateDir, "myhost.json"), JSON.stringify(stateObj));
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/machines" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hosts: string[]; states: Record<string, unknown> };
    expect(body.hosts).toContain("myhost");
    expect(body.states["myhost"]).toBeDefined();
    await server.close();
  });

  it("POST /api/capture → 200 { changes: ChangeSet[] }", async () => {
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        captureFn: async () => ({
          module: "dotfiles",
          written: ["~/.zshrc"],
          encrypted: [],
        }),
      }),
    );
    // Put dotfiles in the selection so captureAll visits it
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", "~/.zshrc");
    saveSelection(tmpDir, sel);
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/capture" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { changes: ChangeSet[] };
    expect(Array.isArray(body.changes)).toBe(true);
    expect(body.changes.some((c) => c.module === "dotfiles")).toBe(true);
    await server.close();
  });

  it("POST /api/load with no body → dry-run: returns results with skipped items", async () => {
    const reg = new ModuleRegistry();
    reg.register(makeFakeModule({ name: "packages" }));
    let sel = emptySelection();
    sel = addItem(sel, "packages", "Brewfile");
    saveSelection(tmpDir, sel);
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/load" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: ApplyResult[] };
    expect(Array.isArray(body.results)).toBe(true);
    const pkgResult = body.results.find((r) => r.module === "packages");
    expect(pkgResult).toBeDefined();
    // dry-run so items should be skipped
    expect(pkgResult?.skipped).toContain("Brewfile");
    expect(pkgResult?.applied).toHaveLength(0);
    await server.close();
  });

  it("POST /api/load with { apply: true } → real path: returns results with applied items", async () => {
    const reg = new ModuleRegistry();
    reg.register(makeFakeModule({ name: "packages" }));
    let sel = emptySelection();
    sel = addItem(sel, "packages", "Brewfile");
    saveSelection(tmpDir, sel);
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({
      method: "POST",
      url: "/api/load",
      payload: { apply: true },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: ApplyResult[] };
    const pkgResult = body.results.find((r) => r.module === "packages");
    expect(pkgResult).toBeDefined();
    expect(pkgResult?.applied).toContain("Brewfile");
    expect(pkgResult?.skipped).toHaveLength(0);
    await server.close();
  });

  it("handler error → 500 { error: string }", async () => {
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        statusFn: async () => { throw new Error("module exploded"); },
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/module exploded/);
    await server.close();
  });

  it("GET / with no webDir → 200 fallback hint JSON", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; hint: string };
    expect(body.name).toBe("roost");
    expect(typeof body.hint).toBe("string");
    await server.close();
  });

  // ── Unit 2 — new endpoints ────────────────────────────────────────────────────

  it("POST /api/selection/add → mutates on-disk selection and returns updated doc", async () => {
    // Start with an empty selection
    saveSelection(tmpDir, emptySelection());
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });

    const res = await server.inject({
      method: "POST",
      url: "/api/selection/add",
      payload: { module: "dotfiles", id: "/home/.zshrc" },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { schemaVersion: number; modules: Record<string, string[]> };
    expect(body.modules["dotfiles"]).toContain("/home/.zshrc");

    // Verify on-disk state
    const { loadSelection: _load } = await import("@roost/core");
    const onDisk = _load(tmpDir);
    expect(onDisk.modules["dotfiles"]).toContain("/home/.zshrc");

    await server.close();
  });

  it("POST /api/selection/remove → mutates on-disk selection and returns updated doc", async () => {
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", "/home/.zshrc");
    sel = addItem(sel, "dotfiles", "/home/.vimrc");
    saveSelection(tmpDir, sel);

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });

    const res = await server.inject({
      method: "POST",
      url: "/api/selection/remove",
      payload: { module: "dotfiles", id: "/home/.zshrc" },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { schemaVersion: number; modules: Record<string, string[]> };
    expect(body.modules["dotfiles"]).not.toContain("/home/.zshrc");
    expect(body.modules["dotfiles"]).toContain("/home/.vimrc");

    await server.close();
  });

  it("POST /api/selection/remove → also calls module.unmanage for the removed id", async () => {
    const unmanageCalls: { id: string }[] = [];

    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", "/home/.zshrc");
    sel = addItem(sel, "dotfiles", "/home/.vimrc");
    saveSelection(tmpDir, sel);

    const fakeExecWithForget = makeFakeExec();
    const dotfilesWithSpy: SyncModule = {
      ...makeFakeModule({ name: "dotfiles" }),
      async unmanage(_ctx: ModuleContext, unmanageSel: Selection): Promise<ApplyResult> {
        const ids = unmanageSel.modules["dotfiles"] ?? [];
        for (const id of ids) unmanageCalls.push({ id });
        return { module: "dotfiles", applied: ids, backedUp: [], skipped: [] };
      },
    };

    const reg = new ModuleRegistry();
    reg.register(dotfilesWithSpy);

    function makeCtxWithForget(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: fakeExecWithForget,
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtxWithForget(tmpDir, d) });

    const res = await server.inject({
      method: "POST",
      url: "/api/selection/remove",
      payload: { module: "dotfiles", id: "/home/.zshrc" },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);

    // unmanage was called with just the removed id
    expect(unmanageCalls).toHaveLength(1);
    expect(unmanageCalls[0]!.id).toBe("/home/.zshrc");

    // response includes unmanaged summary
    const body = res.json() as { unmanaged?: { module: string; applied: string[] } };
    expect(body.unmanaged).toBeDefined();
    expect(body.unmanaged!.applied).toContain("/home/.zshrc");

    await server.close();
  });

  it("GET /api/timeline → parses git log output into entries", async () => {
    const sha = "abc123def456";
    const subject = "feat: add something";
    const date = "2026-05-30T10:00:00+00:00";
    const gitLine = `${sha}\x1f${subject}\x1f${date}`;

    function makeGitExec(): Exec {
      return {
        async run(cmd: string, args: string[]): Promise<ExecResult> {
          if (cmd === "git" && args.includes("log")) {
            return { code: 0, stdout: gitLine, stderr: "" };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      };
    }

    function makeGitCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: makeGitExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeGitCtx(tmpDir, d) });

    const res = await server.inject({ method: "GET", url: "/api/timeline" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: { sha: string; subject: string; date: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toEqual({ sha, subject, date });

    await server.close();
  });

  it("GET /api/timeline → returns [] on non-zero git exit", async () => {
    function makeFailExec(): Exec {
      return {
        async run(): Promise<ExecResult> {
          return { code: 128, stdout: "", stderr: "not a git repo" };
        },
      };
    }

    function makeFailCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: makeFailExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeFailCtx(tmpDir, d) });

    const res = await server.inject({ method: "GET", url: "/api/timeline" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: unknown[] };
    expect(body.entries).toEqual([]);

    await server.close();
  });

  it("GET /api/discover → returns per-module candidate arrays", async () => {
    const reg = new ModuleRegistry();
    const candidateA: Candidate = {
      id: "~/.zshrc",
      path: "/home/user/.zshrc",
      category: "shell",
      recommendation: "track",
    };
    const modWithCandidates: SyncModule = {
      ...makeFakeModule({ name: "dotfiles" }),
      async discover(): Promise<Candidate[]> { return [candidateA]; },
    };
    reg.register(modWithCandidates);
    reg.register(makeFakeModule({ name: "packages" }));

    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/discover" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { candidates: Record<string, Candidate[]> };
    expect(body.candidates["dotfiles"]).toHaveLength(1);
    expect(body.candidates["dotfiles"]?.[0]?.id).toBe("~/.zshrc");
    expect(body.candidates["packages"]).toHaveLength(0);

    await server.close();
  });

  it("GET /api/diff → returns per-module diff text from registered modules", async () => {
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        statusFn: async () => ({ module: "dotfiles", items: [] }),
      }),
    );

    // Override diff on the fake module for this test
    const modWithDiff: SyncModule = {
      ...makeFakeModule({ name: "packages" }),
      async diff(): Promise<string> { return "--- a\n+++ b\n@@ -1 +1 @@"; },
    };
    reg.register(modWithDiff);

    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });

    const res = await server.inject({ method: "GET", url: "/api/diff" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { diffs: { module: string; text: string }[] };
    expect(Array.isArray(body.diffs)).toBe(true);
    expect(body.diffs).toHaveLength(2);
    const pkgDiff = body.diffs.find((d) => d.module === "packages");
    expect(pkgDiff?.text).toContain("@@ -1 +1 @@");

    await server.close();
  });

  // ── /api/env structured editing ───────────────────────────────────────────────

  it("GET /api/env → redacts secret env values to ''", async () => {
    const { saveEnvData } = await import("@roost/core");
    saveEnvData(tmpDir, {
      schemaVersion: 1,
      aliases: [{ kind: "alias", name: "ll", value: "ls -la", enabled: true }],
      env: [
        { kind: "env", name: "EDITOR", value: "nvim", secret: false, enabled: true },
        { kind: "env", name: "TOKEN", value: "stored-secret", secret: true, enabled: true },
      ],
      path: [],
      functions: [],
    });

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/env" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      env: { name: string; value: string; secret: boolean }[];
    };
    const tokenEntry = body.env.find((e) => e.name === "TOKEN")!;
    expect(tokenEntry.value).toBe(""); // redacted
    const editorEntry = body.env.find((e) => e.name === "EDITOR")!;
    expect(editorEntry.value).toBe("nvim"); // non-secret preserved
    // raw plaintext must not leak anywhere in the response
    expect(res.body).not.toContain("stored-secret");

    await server.close();
  });

  it("PUT /api/env → encrypts a new secret value, never returns it, blanks it on disk", async () => {
    // age-simulating exec + a fake key file under a sandboxed home so
    // recipientFromKey/encrypt succeed without touching the real $HOME.
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "roost-env-server-home-"));
    const keyPath = path.join(fakeHome, ".config", "sops", "age", "keys.txt");
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, "AGE-SECRET-KEY-FAKE", { mode: 0o600 });

    function makeAgeExec(): Exec {
      return {
        async run(cmd: string, args: string[]): Promise<ExecResult> {
          if (cmd === "age-keygen" && args[0] === "-y") {
            return { code: 0, stdout: "age1faketestrecipient\n", stderr: "" };
          }
          if (cmd === "age" && args.includes("-r")) {
            const oIdx = args.indexOf("-o");
            const dest = args[oIdx + 1]!;
            const src = args[args.length - 1]!;
            const plain = fs.readFileSync(src, "utf8");
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, `CIPHER:${plain}`, "utf8");
            return { code: 0, stdout: "", stderr: "" };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      };
    }
    function makeAgeCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: fakeHome,
        profile: "base",
        dryRun,
        exec: makeAgeExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    try {
      const reg = new ModuleRegistry();
      const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeAgeCtx(tmpDir, d) });

      const payload = {
        schemaVersion: 1,
        aliases: [],
        env: [{ kind: "env", name: "TOKEN", value: "fresh-plaintext", secret: true, enabled: true }],
        path: [],
        functions: [],
      };
      const res = await server.inject({
        method: "PUT",
        url: "/api/env",
        payload,
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(200);

      // response never echoes the plaintext
      expect(res.body).not.toContain("fresh-plaintext");
      const body = res.json() as { env: { name: string; value: string }[] };
      expect(body.env.find((e) => e.name === "TOKEN")?.value).toBe("");

      // ciphertext written, yaml blanked
      expect(fs.existsSync(path.join(tmpDir, "roost", "env-secrets", "TOKEN.age"))).toBe(true);
      const yamlRaw = fs.readFileSync(path.join(tmpDir, "roost", "env.yaml"), "utf8");
      expect(yamlRaw).not.toContain("fresh-plaintext");

      await server.close();
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("GET /api/env → returns source+ref but blanks the secret value (ADR-0004)", async () => {
    const { saveEnvData } = await import("@roost/core");
    saveEnvData(tmpDir, {
      schemaVersion: 2,
      aliases: [],
      env: [
        {
          kind: "env",
          name: "TOKEN",
          value: "",
          secret: true,
          source: { kind: "ref", backend: "op", ref: "op://Vault/Item/field" },
          enabled: true,
        },
      ],
      path: [],
      functions: [],
    });
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/env" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      env: { name: string; value: string; source?: { kind: string; backend?: string; ref?: string } }[];
    };
    const token = body.env.find((e) => e.name === "TOKEN")!;
    expect(token.value).toBe("");
    expect(token.source).toEqual({ kind: "ref", backend: "op", ref: "op://Vault/Item/field" });
    await server.close();
  });

  it("PUT /api/env → persists a ref item without encryption (ADR-0004)", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const payload = {
      schemaVersion: 2,
      aliases: [],
      env: [
        {
          kind: "env",
          name: "TOKEN",
          value: "",
          secret: true,
          source: { kind: "ref", backend: "rbw", ref: "my-entry" },
          enabled: true,
        },
      ],
      path: [],
      functions: [],
    };
    const res = await server.inject({
      method: "PUT",
      url: "/api/env",
      payload,
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    // No ciphertext for a ref item.
    expect(fs.existsSync(path.join(tmpDir, "roost", "env-secrets", "TOKEN.age"))).toBe(false);
    const { loadEnvData } = await import("@roost/core");
    const onDisk = loadEnvData(tmpDir).env.find((e) => e.name === "TOKEN")!;
    expect(onDisk.value).toBe("");
    expect(onDisk.source).toEqual({ kind: "ref", backend: "rbw", ref: "my-entry" });
    await server.close();
  });

  it("PUT /api/env → 400 on malformed body", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({
      method: "PUT",
      url: "/api/env",
      payload: { schemaVersion: "not-a-number" },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(typeof body.error).toBe("string");
    await server.close();
  });

  // ── short-TTL response cache (status/discover) ────────────────────────────────

  it("GET /api/status → computes once across two quick calls (cached)", async () => {
    let statusCalls = 0;
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        statusFn: async () => {
          statusCalls += 1;
          return { module: "dotfiles", items: [] };
        },
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });

    await server.inject({ method: "GET", url: "/api/status" });
    await server.inject({ method: "GET", url: "/api/status" });
    expect(statusCalls).toBe(1);

    await server.close();
  });

  it("GET /api/discover → computes once across two quick calls (cached)", async () => {
    let discoverCalls = 0;
    const reg = new ModuleRegistry();
    reg.register({
      ...makeFakeModule({ name: "dotfiles" }),
      async discover(): Promise<Candidate[]> {
        discoverCalls += 1;
        return [];
      },
    });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });

    await server.inject({ method: "GET", url: "/api/discover" });
    await server.inject({ method: "GET", url: "/api/discover" });
    expect(discoverCalls).toBe(1);

    await server.close();
  });

  it("POST /api/capture invalidates the cache → next /api/status recomputes", async () => {
    let statusCalls = 0;
    const reg = new ModuleRegistry();
    reg.register(
      makeFakeModule({
        name: "dotfiles",
        statusFn: async () => {
          statusCalls += 1;
          return { module: "dotfiles", items: [] };
        },
      }),
    );
    saveSelection(tmpDir, emptySelection());
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });

    await server.inject({ method: "GET", url: "/api/status" }); // computes (1)
    await server.inject({ method: "GET", url: "/api/status" }); // cached
    expect(statusCalls).toBe(1);

    await server.inject({ method: "POST", url: "/api/capture" }); // invalidates
    await server.inject({ method: "GET", url: "/api/status" }); // recomputes (2)
    expect(statusCalls).toBe(2);

    await server.close();
  });

  it("PUT /api/env invalidates the cache → next /api/discover recomputes", async () => {
    let discoverCalls = 0;
    const reg = new ModuleRegistry();
    reg.register({
      ...makeFakeModule({ name: "dotfiles" }),
      async discover(): Promise<Candidate[]> {
        discoverCalls += 1;
        return [];
      },
    });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });

    await server.inject({ method: "GET", url: "/api/discover" }); // computes (1)
    await server.inject({ method: "GET", url: "/api/discover" }); // cached
    expect(discoverCalls).toBe(1);

    await server.inject({
      method: "PUT",
      url: "/api/env",
      payload: { schemaVersion: 1, aliases: [], env: [], path: [], functions: [] },
      headers: { "content-type": "application/json" },
    });
    await server.inject({ method: "GET", url: "/api/discover" }); // recomputes (2)
    expect(discoverCalls).toBe(2);

    await server.close();
  });

  it("POST /api/projects/test → { reachable, message } (400 on missing remote)", async () => {
    const reg = defaultRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const bad = await server.inject({ method: "POST", url: "/api/projects/test", payload: {} });
    expect(bad.statusCode).toBe(400);
    const ok = await server.inject({ method: "POST", url: "/api/projects/test", payload: { remote: "git@github.com:u/r.git" } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { reachable: boolean; message: string };
    expect(typeof body.reachable).toBe("boolean");
    await server.close();
  });

  // ── /api/git/* ────────────────────────────────────────────────────────────────

  it("GET /api/git/status → parses ahead/behind from rev-list output", async () => {
    function makeGitStatusExec(): Exec {
      return {
        async run(cmd: string, args: string[]): Promise<ExecResult> {
          const joined = args.join(" ");
          if (cmd === "git" && joined.includes("rev-parse --is-inside-work-tree")) {
            return { code: 0, stdout: "true", stderr: "" };
          }
          if (cmd === "git" && joined.includes("remote get-url origin")) {
            return { code: 0, stdout: "git@github.com:u/cfg.git\n", stderr: "" };
          }
          if (cmd === "git" && joined.includes("rev-parse --abbrev-ref HEAD")) {
            return { code: 0, stdout: "main\n", stderr: "" };
          }
          if (cmd === "git" && joined.includes("rev-list --left-right --count")) {
            return { code: 0, stdout: "1\t2\n", stderr: "" };
          }
          if (cmd === "git" && joined.includes("status --porcelain")) {
            return { code: 0, stdout: "", stderr: "" };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      };
    }

    function makeGitStatusCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: makeGitStatusExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeGitStatusCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/git/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      isRepo: boolean;
      remote: string | null;
      branch: string | null;
      ahead: number;
      behind: number;
      clean: boolean;
    };
    expect(body.isRepo).toBe(true);
    expect(body.remote).toBe("git@github.com:u/cfg.git");
    expect(body.branch).toBe("main");
    expect(body.behind).toBe(1);
    expect(body.ahead).toBe(2);
    expect(body.clean).toBe(true);
    await server.close();
  });

  it("GET /api/git/status → isRepo:false when rev-parse fails", async () => {
    function makeNotRepoExec(): Exec {
      return {
        async run(): Promise<ExecResult> {
          return { code: 128, stdout: "", stderr: "not a git repository" };
        },
      };
    }

    function makeNotRepoCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: makeNotRepoExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeNotRepoCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/git/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { isRepo: boolean; remote: null; branch: null; ahead: number; behind: number };
    expect(body.isRepo).toBe(false);
    expect(body.remote).toBeNull();
    expect(body.branch).toBeNull();
    expect(body.ahead).toBe(0);
    expect(body.behind).toBe(0);
    await server.close();
  });

  it("POST /api/git/push → ok:true on exit 0", async () => {
    function makePushExec(): Exec {
      return {
        async run(cmd: string, args: string[]): Promise<ExecResult> {
          if (cmd === "git" && args.includes("push")) {
            return { code: 0, stdout: "Everything up-to-date", stderr: "" };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      };
    }

    function makePushCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: makePushExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makePushCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/git/push" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; output: string };
    expect(body.ok).toBe(true);
    expect(body.output).toContain("Everything up-to-date");
    await server.close();
  });

  it("POST /api/git/push → ok:false on non-zero exit", async () => {
    function makeFailPushExec(): Exec {
      return {
        async run(cmd: string, args: string[]): Promise<ExecResult> {
          if (cmd === "git" && args.includes("push")) {
            return { code: 1, stdout: "", stderr: "rejected: non-fast-forward" };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      };
    }

    function makeFailPushCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: makeFailPushExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeFailPushCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/git/push" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; output: string };
    expect(body.ok).toBe(false);
    expect(body.output).toContain("rejected");
    await server.close();
  });

  it("POST /api/git/push → sets upstream on the first push when the branch has no upstream", async () => {
    const calls: string[][] = [];
    function makeNoUpstreamExec(): Exec {
      return {
        async run(cmd: string, args: string[]): Promise<ExecResult> {
          calls.push([cmd, ...args]);
          const a = args.join(" ");
          // No upstream yet → @{u} resolution fails. This is the locale-independent
          // signal (git's "no upstream branch" message is translated).
          if (a.includes("symbolic-full-name @{u}")) return { code: 1, stdout: "", stderr: "no upstream" };
          if (a.includes("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "main", stderr: "" };
          if (cmd === "git" && args.includes("push")) return { code: 0, stdout: "branch 'main' set up to track 'origin/main'.", stderr: "" };
          return { code: 0, stdout: "", stderr: "" };
        },
      };
    }
    function makeNoUpstreamCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: makeNoUpstreamExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeNoUpstreamCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/git/push" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
    // The first push must set the upstream: `git push -u origin main`.
    expect(
      calls.some((c) => c[0] === "git" && c.includes("push") && c.includes("-u") && c.includes("origin") && c.includes("main")),
    ).toBe(true);
    await server.close();
  });

  it("POST /api/git/pull → ok:true on exit 0", async () => {
    function makePullExec(): Exec {
      return {
        async run(cmd: string, args: string[]): Promise<ExecResult> {
          if (cmd === "git" && args.includes("pull")) {
            return { code: 0, stdout: "Already up to date.", stderr: "" };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      };
    }

    function makePullCtx(repoDir: string, dryRun = false): ModuleContext {
      return {
        repoDir,
        home: os.homedir(),
        profile: "base",
        dryRun,
        exec: makePullExec(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        t: (k: string) => k,
      };
    }

    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makePullCtx(tmpDir, d) });
    const res = await server.inject({ method: "POST", url: "/api/git/pull" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; output: string };
    expect(body.ok).toBe(true);
    expect(body.output).toContain("Already up to date");
    await server.close();
  });

  it("GET /api/discover?module=projects → only the projects key", async () => {
    const reg = defaultRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/discover?module=projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { candidates: Record<string, unknown[]> };
    expect(Object.keys(body.candidates)).toEqual(["projects"]);
    await server.close();
  }, 20000); // projects discover scans the filesystem; allow headroom under load

  it("GET /api/packages/brewfile → 200 shape; parses an on-disk Brewfile", async () => {
    const brewDir = path.join(tmpDir, "roost");
    fs.mkdirSync(brewDir, { recursive: true });
    fs.writeFileSync(
      path.join(brewDir, "Brewfile"),
      ['tap "homebrew/services"', 'brew "git"', 'cask "firefox"', 'mas "Xcode", id: 1'].join("\n"),
    );
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/packages/brewfile" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      available: boolean;
      exists: boolean;
      entries: { taps: string[]; formulae: string[]; casks: string[]; mas: string[] };
    };
    expect(typeof body.available).toBe("boolean"); // makeFakeExec → brew --version exits 0
    expect(body.exists).toBe(true);
    expect(body.entries.taps).toEqual(["homebrew/services"]);
    expect(body.entries.formulae).toEqual(["git"]);
    expect(body.entries.casks).toEqual(["firefox"]);
    expect(body.entries.mas).toEqual(["Xcode"]);
    await server.close();
  });

  it("GET /api/packages/brewfile → exists:false with empty entries when no Brewfile", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/packages/brewfile" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      exists: boolean;
      entries: { formulae: string[] };
    };
    expect(body.exists).toBe(false);
    expect(body.entries.formulae).toEqual([]);
    await server.close();
  });

  it("GET /api/packages/states → 200 { states } keyed by selected per-package ids (skips Brewfile sentinel)", async () => {
    let sel = emptySelection();
    sel = addItem(sel, "packages", "brew:git");
    sel = addItem(sel, "packages", "cask:firefox");
    sel = addItem(sel, "packages", "Brewfile"); // legacy sentinel — must be skipped
    saveSelection(tmpDir, sel);
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/packages/states" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { states: Record<string, string> };
    expect(typeof body.states).toBe("object");
    expect(Object.keys(body.states).sort()).toEqual(["brew:git", "cask:firefox"]);
    // makeFakeExec returns empty stdout → not present in `brew list` → missing.
    expect(body.states["brew:git"]).toBe("missing");
    expect(body.states["cask:firefox"]).toBe("missing");
    await server.close();
  });

  it("GET /api/dotfiles → 200 { available: boolean; managed: string[] }", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/dotfiles" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { available: boolean; managed: string[] };
    expect(typeof body.available).toBe("boolean"); // makeFakeExec → chezmoi --version exits 0
    expect(Array.isArray(body.managed)).toBe(true);
    await server.close();
  });

  it("GET /api/appconfig → 200 { available: true; managed: string[] } listing plist basenames", async () => {
    const reg = new ModuleRegistry();
    const acDir = path.join(tmpDir, "roost/appconfig");
    fs.mkdirSync(acDir, { recursive: true });
    fs.writeFileSync(path.join(acDir, "com.apple.dock.plist"), "x", "utf8");
    fs.writeFileSync(path.join(acDir, "com.googlecode.iterm2.plist"), "x", "utf8");
    fs.writeFileSync(path.join(acDir, "ignore.txt"), "x", "utf8");
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/appconfig" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { available: boolean; managed: string[] };
    expect(body.available).toBe(true);
    expect(body.managed.sort()).toEqual(["com.apple.dock", "com.googlecode.iterm2"]);
    await server.close();
  });

  it("GET /api/appconfig → managed [] when appconfig dir absent", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/appconfig" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { available: boolean; managed: string[] };
    expect(body.available).toBe(true);
    expect(body.managed).toEqual([]);
    await server.close();
  });

  it("GET /api/index → 200 { index: { <module>: ModuleIndex } }", async () => {
    const reg = defaultRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/index" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { index: Record<string, { managed: number; available: boolean }> };
    expect(body.index.projects).toBeDefined();
    expect(typeof body.index.projects!.managed).toBe("number");
    await server.close();
  });

  it("POST /api/capture writes machine state + commits, and GET /api/machines lists the host", async () => {
    // Seed a real git repo with an empty selection so captureAll has nothing to do.
    fs.writeFileSync(path.join(tmpDir, "README"), "hi", "utf8");
    saveSelection(tmpDir, emptySelection());
    await ensureGitRepo(createExec(), tmpDir);

    const reg = defaultRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeRealCtx(tmpDir, d) });

    const cap = await server.inject({ method: "POST", url: "/api/capture" });
    expect(cap.statusCode).toBe(200);

    const host = os.hostname();
    expect(fs.existsSync(path.join(tmpDir, "state", `${host}.json`))).toBe(true);

    const log = await createExec().run("git", ["-C", tmpDir, "log", "--pretty=%s"]);
    expect(log.stdout).toContain("roost: capture");

    const machines = await server.inject({ method: "GET", url: "/api/machines" });
    expect(machines.statusCode).toBe(200);
    const body = machines.json() as { hosts: string[]; states: Record<string, unknown> };
    expect(body.hosts).toContain(host);

    await server.close();
  });
});

describe("skills api", () => {
  it("GET /api/skills returns config + targets + managed skills", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skapi-"));
    fs.mkdirSync(path.join(tmp, "skills", "foo"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "skills", "foo", "SKILL.md"), "# foo");
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "GET", url: "/api/skills" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.config.method).toBe("symlink");
    expect(Array.isArray(body.targets)).toBe(true);
    expect(body.skills.find((s: { name: string }) => s.name === "foo")).toBeTruthy();
    await server.close();
  });

  it("POST /api/skills/toggle persists per-skill enabled=false", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sktog-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/toggle", payload: { skill: "foo", enabled: false } });
    expect(res.statusCode).toBe(200);
    const yaml = fs.readFileSync(path.join(tmp, "roost", "skills.yaml"), "utf8");
    expect(yaml).toMatch(/foo/);
    expect(yaml).toMatch(/enabled: false/);
    await server.close();
  });

  it("POST /api/skills/toggle with target edits per-skill targets", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sktgt-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/toggle", payload: { skill: "foo", target: "codex", enabled: false } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.config.skills.foo.targets).not.toContain("codex");
    await server.close();
  });

  it("POST /api/skills/toggle rejects missing fields", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skbad-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/toggle", payload: { skill: "foo" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it("computeConflicts: enabled target with a REAL non-Roost dir → conflict", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skconf-home-"));
    try {
      const targets = [
        { id: "claude", path: ".claude/skills", label: "Claude Code" },
        { id: "codex", path: ".codex/skills", label: "Codex" },
      ];
      // foo is enabled on both, claude is symlinked (owned), codex is a real dir.
      fs.mkdirSync(path.join(home, ".claude", "skills"), { recursive: true });
      fs.symlinkSync(home, path.join(home, ".claude", "skills", "foo")); // a symlink → not a conflict
      fs.mkdirSync(path.join(home, ".codex", "skills", "foo"), { recursive: true }); // real dir → conflict
      const cfg = {
        sourceDir: "~/.agents/skills",
        method: "symlink" as const,
        targets: ["claude", "codex"],
        skills: {},
      };
      const conflicts = computeConflicts(home, "foo", targets, [], cfg);
      expect(conflicts).toEqual(["codex"]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("computeConflicts: a Roost-owned real dir (in links) is NOT a conflict", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skconf2-home-"));
    try {
      const targets = [{ id: "claude", path: ".claude/skills", label: "Claude Code" }];
      fs.mkdirSync(path.join(home, ".claude", "skills", "foo"), { recursive: true }); // copy-method real dir
      const dest = path.join(home, ".claude", "skills", "foo");
      const cfg = { sourceDir: "~/.agents/skills", method: "copy" as const, targets: ["claude"], skills: {} };
      const links = [{ skill: "foo", target: "claude", path: dest, kind: "copy" as const }];
      expect(computeConflicts(home, "foo", targets, links, cfg)).toEqual([]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("GET /api/skills surfaces conflicts for a target occupied by a real dir", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skconfapi-repo-"));
    // Unique home-relative target dir so we can plant a real dir under the REAL home.
    const uniqueRel = path.join(`.roost-test-${Math.random().toString(36).slice(2)}`, "skills");
    const realDest = path.join(os.homedir(), uniqueRel, "foo");
    try {
      // managed skill foo
      fs.mkdirSync(path.join(repo, "skills", "foo"), { recursive: true });
      fs.writeFileSync(path.join(repo, "skills", "foo", "SKILL.md"), "# foo");
      // catalog override: a single target whose home-relative path is our unique dir
      fs.mkdirSync(path.join(repo, "roost"), { recursive: true });
      fs.writeFileSync(
        path.join(repo, "roost", "skills-catalog.yaml"),
        `targets:\n  - id: t1\n    path: ${uniqueRel}\n    label: T1\n`,
      );
      // recipe: enable foo only on t1
      fs.writeFileSync(
        path.join(repo, "roost", "skills.yaml"),
        `sourceDir: ~/.agents/skills\nmethod: symlink\ntargets:\n  - t1\nskills:\n  foo:\n    enabled: true\n    targets:\n      - t1\n`,
      );
      // plant a REAL (non-Roost) dir at the resolved target path under the real home
      fs.mkdirSync(realDest, { recursive: true });

      const server = buildServer({ repoDir: repo, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(repo, d) });
      const res = await server.inject({ method: "GET", url: "/api/skills" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { skills: { name: string; conflicts: string[] }[] };
      const foo = body.skills.find((s) => s.name === "foo")!;
      expect(foo.conflicts).toContain("t1");
      await server.close();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      // clean the planted dir + its unique parent under the real home
      fs.rmSync(path.join(os.homedir(), uniqueRel.split(path.sep)[0]!), { recursive: true, force: true });
    }
  });
});

describe("skills resolve api", () => {
  it("POST /api/skills/resolve backs up a real dir and links", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-resolve-"));
    fs.mkdirSync(path.join(tmp, "skills", "foo"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "skills", "foo", "SKILL.md"), "# canonical");
    fs.mkdirSync(path.join(tmp, "roost"), { recursive: true });
    const stamp = Date.now();
    const uniqRoot = `.roost-test-${stamp}`;
    const uniq = `${uniqRoot}/skills`;
    fs.writeFileSync(path.join(tmp, "roost", "skills-catalog.yaml"),
      `targets:\n  - { id: claude, path: ${uniq}, label: Claude }\n`);
    fs.writeFileSync(path.join(tmp, "roost", "skills.yaml"),
      `sourceDir: ${path.join(os.homedir(), ".roost-test-src-" + stamp)}\nmethod: symlink\ntargets: [claude]\nskills: { foo: {} }\n`);
    const dest = path.join(os.homedir(), uniq, "foo");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "SKILL.md"), "# USER own");
    try {
      const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
      const res = await server.inject({ method: "POST", url: "/api/skills/resolve", payload: { skill: "foo", target: "claude" } });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(body.backedUp)).toBe(true);
      await server.close();
    } finally {
      fs.rmSync(path.join(os.homedir(), uniqRoot), { recursive: true, force: true });
      fs.rmSync(path.join(os.homedir(), ".roost-test-src-" + stamp), { recursive: true, force: true });
    }
  });

  it("POST /api/skills/resolve returns 400 on a non-conflict", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-resolve2-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/resolve", payload: { skill: "nope", target: "claude" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it("POST /api/skills/resolve returns 400 when fields missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-resolve3-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/resolve", payload: { skill: "foo" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});

describe("settings api", () => {
  it("GET /api/settings returns default maxCaptureMB 100", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-setapi-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).maxCaptureMB).toBe(100);
    await server.close();
  });
  it("POST /api/settings persists maxCaptureMB", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-setapi2-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/settings", payload: { maxCaptureMB: 250 } });
    expect(res.statusCode).toBe(200);
    const get = await server.inject({ method: "GET", url: "/api/settings" });
    expect(JSON.parse(get.body).maxCaptureMB).toBe(250);
    await server.close();
  });
  it("POST /api/settings rejects non-positive with default", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-setapi3-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/settings", payload: { maxCaptureMB: -5 } });
    expect(JSON.parse(res.body).maxCaptureMB).toBe(100);
    await server.close();
  });
});

describe("cors", () => {
  it("allows PUT in the preflight (env save uses PUT)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-corsput-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({
      method: "OPTIONS",
      url: "/api/env",
      headers: { origin: "tauri://localhost", "access-control-request-method": "PUT", "access-control-request-headers": "content-type" },
    });
    expect(res.headers["access-control-allow-methods"]).toContain("PUT");
    await server.close();
  });

  it("allows the Tauri webview origin", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cors-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "GET", url: "/api/health", headers: { origin: "tauri://localhost" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("tauri://localhost");
    await server.close();
  });

  it("allows loopback dev origins (vite)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cors2-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "GET", url: "/api/health", headers: { origin: "http://localhost:5173" } });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    await server.close();
  });

  it("does NOT allow an arbitrary external website", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cors3-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example.com" } });
    // @fastify/cors omits the ACAO header when origin is disallowed → browser blocks it
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await server.close();
  });

  it("allows non-CORS requests (no Origin header, e.g. curl/same-origin)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cors4-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    await server.close();
  });
});

describe("classifyGitError", () => {
  it("flags auth failures", () => {
    expect(classifyGitError("fatal: could not read Username for 'https://github.com'")).toBe("auth");
    expect(classifyGitError("Authentication failed for 'https://...'")).toBe("auth");
    expect(classifyGitError("remote: Permission denied")).toBe("auth");
    expect(classifyGitError("terminal prompts disabled")).toBe("auth");
  });
  it("flags non-fast-forward push rejections as pull-first (push-safety §6.4)", () => {
    expect(
      classifyGitError("! [rejected] main -> main (non-fast-forward)\nUpdates were rejected because the tip of your current branch is behind"),
    ).toBe("pull-first");
    expect(classifyGitError("hint: Updates were rejected; ... fetch first")).toBe("pull-first");
  });
  it("returns undefined for non-auth output", () => {
    expect(classifyGitError("Everything up-to-date")).toBeUndefined();
    expect(classifyGitError("")).toBeUndefined();
  });
});

describe("POST /api/skills/unadopt", () => {
  it("forgets a skill (repo entry gone) but keeps the source dir", async () => {
    const reg = new ModuleRegistry();
    reg.register(skillsModule);
    const aHome = fs.mkdtempSync(path.join(os.tmpdir(), "roost-un-home-"));
    const aRepo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-un-repo-"));
    try {
      fs.mkdirSync(path.join(aRepo, "skills", "y-skill"), { recursive: true });
      fs.writeFileSync(path.join(aRepo, "skills", "y-skill", "SKILL.md"), "# x");
      fs.mkdirSync(path.join(aHome, ".agents", "skills", "y-skill"), { recursive: true });
      fs.writeFileSync(path.join(aHome, ".agents", "skills", "y-skill", "SKILL.md"), "# x");
      const ctxFn = (dryRun: boolean): ModuleContext => ({
        repoDir: aRepo, home: aHome, profile: "base", dryRun,
        exec: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
        log: { info() {}, warn() {}, error() {} }, t: (k) => k,
      });
      const server = buildServer({ repoDir: aRepo, registry: reg, makeCtx: ctxFn });
      const res = await server.inject({ method: "POST", url: "/api/skills/unadopt", payload: { names: ["y-skill"] } });
      expect(res.statusCode).toBe(200);
      expect(res.json().removed).toContain("y-skill");
      expect(fs.existsSync(path.join(aRepo, "skills", "y-skill"))).toBe(false);
      expect(fs.existsSync(path.join(aHome, ".agents", "skills", "y-skill", "SKILL.md"))).toBe(true);
    } finally {
      fs.rmSync(aHome, { recursive: true, force: true });
      fs.rmSync(aRepo, { recursive: true, force: true });
    }
  });
});

describe("POST /api/skills/capture (adopt + decouple)", () => {
  it("captures real content and materializes the source (decouple default on)", async () => {
    const reg = new ModuleRegistry();
    reg.register(skillsModule);
    const aHome = fs.mkdtempSync(path.join(os.tmpdir(), "roost-adopt-home-"));
    const aRepo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-adopt-repo-"));
    try {
      // external real content + a symlink in the source dir (mimics cc-switch)
      const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-adopt-ext-"));
      fs.mkdirSync(path.join(external, "x-skill"), { recursive: true });
      fs.writeFileSync(path.join(external, "x-skill", "SKILL.md"), "# real");
      const srcDir = path.join(aHome, ".agents", "skills");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.symlinkSync(path.join(external, "x-skill"), path.join(srcDir, "x-skill"));

      const ctxFn = (dryRun: boolean): ModuleContext => ({
        repoDir: aRepo, home: aHome, profile: "base", dryRun,
        exec: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
        log: { info() {}, warn() {}, error() {} }, t: (k) => k,
      });
      const server = buildServer({ repoDir: aRepo, registry: reg, makeCtx: ctxFn });
      const res = await server.inject({
        method: "POST", url: "/api/skills/capture",
        payload: { names: ["x-skill"] }, // decouple defaults to true
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.written).toContain("x-skill");
      expect(body.materialized).toContain("x-skill");
      // repo has REAL content (not a symlink)
      expect(fs.lstatSync(path.join(aRepo, "skills", "x-skill")).isSymbolicLink()).toBe(false);
      // source is now a real dir (decoupled)
      expect(fs.lstatSync(path.join(srcDir, "x-skill")).isSymbolicLink()).toBe(false);
      fs.rmSync(external, { recursive: true, force: true });
    } finally {
      fs.rmSync(aHome, { recursive: true, force: true });
      fs.rmSync(aRepo, { recursive: true, force: true });
    }
  });
});

describe("POST /api/skills/catalog", () => {
  it("saves custom targets that loadSkillsTargets then returns", async () => {
    const reg = new ModuleRegistry();
    reg.register(skillsModule);
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cat-ep-"));
    try {
      const server = buildServer({ repoDir: r, registry: reg, makeCtx: (d) => makeCtx(r, d) });
      const targets = [
        { id: "claude", path: ".claude/skills", label: "Claude Code" },
        { id: "myproj", path: "work/.skills", label: "My Proj" },
      ];
      const res = await server.inject({ method: "POST", url: "/api/skills/catalog", payload: { targets } });
      expect(res.statusCode).toBe(200);
      expect(loadSkillsTargets(r).find((t) => t.id === "myproj")?.path).toBe("work/.skills");
    } finally { fs.rmSync(r, { recursive: true, force: true }); }
  });
});

describe("onboarding endpoints", () => {
  it("POST /api/init scaffolds the repo and reports isRepo:true, remote:null when no url", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/init", payload: {}, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: string[]; isRepo: boolean; remote: string | null };
    expect(body.isRepo).toBe(true);
    expect(body.remote).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, "roost", "selection.yaml"))).toBe(true);
    await server.close();
  });

  it("POST /api/init with remoteUrl sets origin and echoes it back", async () => {
    const reg = new ModuleRegistry();
    const { exec, calls } = makeGitFake();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/init", payload: { remoteUrl: "git@github.com:me/dot.git" }, headers: { "content-type": "application/json" } });
    const body = res.json() as { remote: string | null };
    expect(body.remote).toBe("git@github.com:me/dot.git");
    expect(calls.some((c) => c.join(" ").includes("remote add origin git@github.com:me/dot.git"))).toBe(true);
    await server.close();
  });

  it("POST /api/git/remote sets origin and returns it", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake({ isRepo: true });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/git/remote", payload: { url: "git@github.com:me/dot.git" }, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { remote: string }).remote).toBe("git@github.com:me/dot.git");
    await server.close();
  });

  it("POST /api/git/remote 400 when url missing", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake({ isRepo: true });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/git/remote", payload: {}, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it("POST /api/clone returns {ok:true} on success", async () => {
    const reg = new ModuleRegistry();
    const { exec, calls } = makeGitFake();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/clone", payload: { url: "git@github.com:me/dot.git" }, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
    expect(calls.some((c) => c[0] === "git" && c[1] === "clone")).toBe(true);
    await server.close();
  });

  it("POST /api/clone surfaces {ok:false,error} on failure", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake({ cloneFails: true });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/clone", payload: { url: "git@github.com:me/dot.git" }, headers: { "content-type": "application/json" } });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/destination path already exists/);
    await server.close();
  });

  it("POST /api/clone 400 when url missing", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/clone", payload: {}, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});

describe("repo hygiene endpoints (ADR-0021)", () => {
  it("second concurrent push returns hint busy", async () => {
    const reg = new ModuleRegistry();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const exec: Exec = {
      async run(cmd: string, args: string[]): Promise<ExecResult> {
        if (cmd === "git" && args.includes("push")) { await gate; return { code: 0, stdout: "", stderr: "" }; }
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const first = server.inject({ method: "POST", url: "/api/git/push" });
    await new Promise((r) => setTimeout(r, 30)); // let the first reach the gate
    const second = await server.inject({ method: "POST", url: "/api/git/push" });
    expect((second.json() as { hint?: string }).hint).toBe("busy");
    release();
    expect(((await first).json() as { ok: boolean }).ok).toBe(true);
    await server.close();
  });

  it("backup/status lists stock large files with target paths", async () => {
    const reg = new ModuleRegistry();
    // a >10MB file inside the repo source, chezmoi-named
    const dir = path.join(tmpDir, "dot_config", "bigapp");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "encrypted_huge.bin.age"), Buffer.alloc(11 * 1024 * 1024));
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/backup/status" });
    const body = res.json() as { largeItems: { path: string; mb: number }[] };
    expect(body.largeItems.length).toBe(1);
    expect(body.largeItems[0]!.path.endsWith(".config/bigapp/huge.bin")).toBe(true);
    expect(body.largeItems[0]!.mb).toBe(11);
    await server.close();
  });

  it("backup/status omits large files the user approved via dotfiles-large-ok", async () => {
    const reg = new ModuleRegistry();
    const dir = path.join(tmpDir, "dot_config", "bigapp");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "encrypted_huge.bin.age"), Buffer.alloc(11 * 1024 * 1024));
    // approve the file (target path) → the advisory must not list it again
    const target = path.join(os.homedir(), ".config", "bigapp", "huge.bin");
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles-large-ok", target);
    saveSelection(tmpDir, sel);
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/backup/status" });
    expect((res.json() as { largeItems: unknown[] }).largeItems).toEqual([]);
    await server.close();
  });

  it("POST /api/dotfiles/exclude forgets the path and records it in dotfiles-exclude", async () => {
    const reg = new ModuleRegistry();
    const calls: string[][] = [];
    const exec: Exec = {
      async run(cmd: string, args: string[]): Promise<ExecResult> {
        calls.push([cmd, ...args]);
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({
      method: "POST", url: "/api/dotfiles/exclude",
      payload: { path: "/Users/x/.config/bigapp/huge.bin" }, headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    expect(calls.some((c) => c[0] === "chezmoi" && c.includes("forget"))).toBe(true);
    const sel = loadSelection(tmpDir);
    expect(sel.modules["dotfiles-exclude"]).toContain("/Users/x/.config/bigapp/huge.bin");
    await server.close();
  });
});

describe("backup status + settings passthrough", () => {
  it("GET /api/backup/status returns scheduler state and lastCaptureAt", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/backup/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { autoBackup: string; autoPush: boolean; lastRun: unknown; lastCaptureAt: string | null };
    expect(body.autoBackup).toBe("daily");
    expect(body.autoPush).toBe(false);
    expect(body.lastRun).toBeNull();
    expect(body.lastCaptureAt).toBeNull();
    await server.close();
  });

  it("POST /api/settings accepts and persists the freshness fields", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({
      method: "POST", url: "/api/settings",
      payload: { maxCaptureMB: 42, autoBackup: "weekly", autoPush: true, checkUpdates: false },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const get = await server.inject({ method: "GET", url: "/api/settings" });
    expect(get.json()).toMatchObject({ maxCaptureMB: 42, autoBackup: "weekly", autoPush: true, checkUpdates: false });
    await server.close();
  });

  it("POST /api/settings rejects bad autoBackup values back to default", async () => {
    const reg = new ModuleRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    await server.inject({
      method: "POST", url: "/api/settings",
      payload: { autoBackup: "hourly" }, headers: { "content-type": "application/json" },
    });
    const get = await server.inject({ method: "GET", url: "/api/settings" });
    expect((get.json() as { autoBackup: string }).autoBackup).toBe("daily");
    await server.close();
  });
});
