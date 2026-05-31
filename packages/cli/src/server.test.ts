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
import { ModuleRegistry, saveSelection, emptySelection, addItem, defaultRegistry, createExec } from "@roost/core";
import { buildServer } from "./server.js";
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
    async doctor(): Promise<Health[]> { return []; },
  };
}

// ── test state ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-server-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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
  });

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
