# Roost Backup Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-capture while the app runs (sidecar scheduler), unpushed/repo-newer/stale/update banners on Overview, an 自动备份 Settings section, and a GitHub update check — per `docs/superpowers/specs/2026-06-11-roost-freshness-design.md` and ADR-0020.

**Architecture:** A scheduler module in the CLI package (injected deps, fully unit-testable) wired into `runServe`; one new endpoint `GET /api/backup/status`; extended `RoostSettings`; web-side `FreshnessBanners` + `updateCheck` helper + Settings section. Push logic is extracted into a shared `runGitPush` helper reused by the route and the scheduler.

**Tech Stack:** TS strict, Fastify, React+Vite, vitest (node for core/cli, jsdom for web). Branch `feat_freshness` (already cut from main). Stage explicitly, one commit per task, no push.

---

## Shared contracts (all tasks must match these exactly)

```ts
// core/src/settings.ts
export type AutoBackupFreq = "off" | "daily" | "weekly";
export interface RoostSettings { maxCaptureMB: number; autoBackup: AutoBackupFreq; autoPush: boolean; checkUpdates: boolean }
export const DEFAULT_ROOST_SETTINGS: RoostSettings = { maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true };

// cli/src/autoBackup.ts
export interface AutoBackupRun { at: string; captured: number; blocked: number; blockedDetail: BlockedItem[]; pushed?: boolean; pushHint?: "auth" | "pull-first"; error?: string }
export interface AutoBackupDeps {
  loadSettings: () => RoostSettings;
  isRepo: () => Promise<boolean>;
  runCapture: () => Promise<{ captured: number; blocked: number; blockedDetail: BlockedItem[] }>;
  runPush: () => Promise<{ ok: boolean; hint?: "auth" | "pull-first" }>;
  initialDelayMs?: number;            // default 60_000
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout }; // injectable for tests
}
export interface AutoBackup { runNow(): Promise<void>; reconfigure(): void; lastRun(): AutoBackupRun | null; stop(): void }
export function createAutoBackup(deps: AutoBackupDeps): AutoBackup;

// server: GET /api/backup/status →
//   { autoBackup: AutoBackupFreq; autoPush: boolean; lastRun: AutoBackupRun | null; lastCaptureAt: string | null }
// server: runGitPush(exec, repoDir) → { ok: boolean; output: string; hint?: "auth" | "pull-first" } (extracted from the push route)

// web/src/api.ts
export interface BackupStatus { autoBackup: "off" | "daily" | "weekly"; autoPush: boolean; lastRun: { at: string; captured: number; blocked: number; blockedDetail: BlockedItem[]; pushed?: boolean; pushHint?: "auth" | "pull-first"; error?: string } | null; lastCaptureAt: string | null }
export function getBackupStatus(): Promise<BackupStatus>;
export interface SettingsResponse { maxCaptureMB: number; autoBackup: "off" | "daily" | "weekly"; autoPush: boolean; checkUpdates: boolean }

// web/src/updateCheck.ts
export function isNewerVersion(latest: string, current: string): boolean; // tolerant of leading "v"
export interface UpdateInfo { version: string; url: string }
export function checkForUpdate(currentVersion: string, fetchImpl?: typeof fetch): Promise<UpdateInfo | null>; // null = up-to-date or check failed

// web/src/components/FreshnessBanners.tsx
export function FreshnessBanners(props: {
  t: (k: string) => string; locale: string;
  gitStatus: GitStatus | null;
  lastCaptureAt: string | null;
  update: UpdateInfo | null;
  onDismissUpdate: () => void;
  onRefresh: () => void;                  // re-fetch Overview data after pull/push
  showHud?: (m: HudMessage) => void;
}): JSX.Element | null;
```

`STALE_DAYS = 7` (constant in FreshnessBanners). i18n namespace `fresh.*` + `settings.auto*` (Task 5 defines every key; later tasks must use those exact keys). Banner priority inside FreshnessBanners: update → behind → ahead → stale (missing-deps stays where it is in Overview, above them).

## File map

**New:** `packages/cli/src/autoBackup.ts` + `autoBackup.test.ts` · `packages/web/src/updateCheck.ts` + `updateCheck.test.ts` · `packages/web/src/components/FreshnessBanners.tsx` + `FreshnessBanners.test.tsx`.
**Modified:** `packages/core/src/settings.ts` + `settings.test.ts` (create if missing) · `packages/cli/src/server.ts` (+`server.test.ts`) · `packages/web/src/api.ts` · `packages/web/src/i18n/strings.ts` · `packages/web/src/views/Overview.tsx` (+`Overview.test.tsx`) · `packages/web/src/views/Settings.tsx` (+`SettingsAuto.test.tsx`) · `packages/web/src-tauri/tauri.conf.json` (CSP).

---

### Task 1: core — extend `RoostSettings`

**Files:** Modify `packages/core/src/settings.ts`; Test `packages/core/src/settings.test.ts` (create if absent; if present, append).

- [ ] **Step 1: Write the failing test** (`packages/core/src/settings.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadRoostSettings, saveRoostSettings, DEFAULT_ROOST_SETTINGS } from "./settings.js";

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-settings-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("RoostSettings freshness fields", () => {
  it("defaults: autoBackup daily, autoPush off, checkUpdates on", () => {
    const s = loadRoostSettings(tmpDir);
    expect(s).toEqual({ maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true });
  });
  it("round-trips all fields", () => {
    saveRoostSettings(tmpDir, { maxCaptureMB: 50, autoBackup: "weekly", autoPush: true, checkUpdates: false });
    expect(loadRoostSettings(tmpDir)).toEqual({ maxCaptureMB: 50, autoBackup: "weekly", autoPush: true, checkUpdates: false });
  });
  it("invalid values fall back per-field (forward compatible)", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "roost", "settings.yaml"), "maxCaptureMB: 25\nautoBackup: hourly\nautoPush: maybe\n", "utf8");
    const s = loadRoostSettings(tmpDir);
    expect(s.maxCaptureMB).toBe(25);
    expect(s.autoBackup).toBe(DEFAULT_ROOST_SETTINGS.autoBackup);
    expect(s.autoPush).toBe(false);
    expect(s.checkUpdates).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/core/src/settings.test.ts` → FAIL (missing fields).

- [ ] **Step 3: Implement** — replace `packages/core/src/settings.ts` body:

```ts
import * as fs from "node:fs"; import * as path from "node:path"; import * as yaml from "js-yaml";
export type AutoBackupFreq = "off" | "daily" | "weekly";
export interface RoostSettings { maxCaptureMB: number; autoBackup: AutoBackupFreq; autoPush: boolean; checkUpdates: boolean }
export const DEFAULT_ROOST_SETTINGS: RoostSettings = { maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true };
function settingsPath(repoDir: string): string { return path.join(repoDir, "roost", "settings.yaml"); }
const FREQS: AutoBackupFreq[] = ["off", "daily", "weekly"];
export function loadRoostSettings(repoDir: string): RoostSettings {
  const s = { ...DEFAULT_ROOST_SETTINGS };
  try {
    const raw = yaml.load(fs.readFileSync(settingsPath(repoDir), "utf8"));
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      if (typeof r["maxCaptureMB"] === "number" && r["maxCaptureMB"] > 0) s.maxCaptureMB = r["maxCaptureMB"];
      if (FREQS.includes(r["autoBackup"] as AutoBackupFreq)) s.autoBackup = r["autoBackup"] as AutoBackupFreq;
      if (typeof r["autoPush"] === "boolean") s.autoPush = r["autoPush"];
      if (typeof r["checkUpdates"] === "boolean") s.checkUpdates = r["checkUpdates"];
    }
  } catch { /* missing/corrupt file → defaults */ }
  return s;
}
export function saveRoostSettings(repoDir: string, s: RoostSettings): void {
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  fs.writeFileSync(settingsPath(repoDir), yaml.dump(s), "utf8");
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run packages/core/src/settings.test.ts` → PASS. Also `npx vitest run packages/cli/src/server.test.ts -t "settings"` (existing settings route tests must stay green; if one asserts the exact old response shape `{ok,maxCaptureMB}`, leave it — route changes in Task 3).
- [ ] **Step 5: Commit** — `git add packages/core/src/settings.ts packages/core/src/settings.test.ts && git commit -m "feat(core): RoostSettings gains autoBackup/autoPush/checkUpdates (ADR-0020)"`

---

### Task 2: cli — `createAutoBackup` scheduler module

**Files:** Create `packages/cli/src/autoBackup.ts`; Test `packages/cli/src/autoBackup.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import type { RoostSettings } from "@roost/core";
import { createAutoBackup, intervalMsFor } from "./autoBackup.js";

const SETTINGS = (over: Partial<RoostSettings> = {}): RoostSettings =>
  ({ maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true, ...over });

function makeDeps(over: Partial<Parameters<typeof createAutoBackup>[0]> = {}) {
  const timer = { handles: [] as { fn: () => void; ms: number }[] };
  return {
    timer,
    deps: {
      loadSettings: () => SETTINGS(),
      isRepo: async () => true,
      runCapture: vi.fn().mockResolvedValue({ captured: 2, blocked: 0, blockedDetail: [] }),
      runPush: vi.fn().mockResolvedValue({ ok: true }),
      initialDelayMs: 0,
      timers: {
        set: ((fn: () => void, ms: number) => { timer.handles.push({ fn, ms }); return timer.handles.length as unknown as NodeJS.Timeout; }) as typeof setTimeout,
        clear: (() => {}) as typeof clearTimeout,
      },
      ...over,
    },
  };
}

describe("intervalMsFor", () => {
  it("maps daily/weekly", () => {
    expect(intervalMsFor("daily")).toBe(24 * 60 * 60 * 1000);
    expect(intervalMsFor("weekly")).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("createAutoBackup", () => {
  it("runNow captures and records lastRun", async () => {
    const { deps } = makeDeps();
    const ab = createAutoBackup(deps);
    await ab.runNow();
    expect(deps.runCapture).toHaveBeenCalledOnce();
    expect(ab.lastRun()).toMatchObject({ captured: 2, blocked: 0 });
    expect(deps.runPush).not.toHaveBeenCalled(); // autoPush off
  });

  it("pushes after capture when autoPush is on and something was captured", async () => {
    const { deps } = makeDeps({ loadSettings: () => SETTINGS({ autoPush: true }) });
    const ab = createAutoBackup(deps);
    await ab.runNow();
    expect(deps.runPush).toHaveBeenCalledOnce();
    expect(ab.lastRun()?.pushed).toBe(true);
  });

  it("skips push when nothing captured, records pushHint on failure", async () => {
    const { deps } = makeDeps({
      loadSettings: () => SETTINGS({ autoPush: true }),
      runCapture: vi.fn().mockResolvedValue({ captured: 0, blocked: 0, blockedDetail: [] }),
    });
    const ab = createAutoBackup(deps);
    await ab.runNow();
    expect(deps.runPush).not.toHaveBeenCalled();

    const failing = makeDeps({
      loadSettings: () => SETTINGS({ autoPush: true }),
      runPush: vi.fn().mockResolvedValue({ ok: false, hint: "auth" as const }),
    });
    const ab2 = createAutoBackup(failing.deps);
    await ab2.runNow();
    expect(ab2.lastRun()?.pushed).toBe(false);
    expect(ab2.lastRun()?.pushHint).toBe("auth");
  });

  it("does nothing when no repo or autoBackup off", async () => {
    const noRepo = makeDeps({ isRepo: async () => false });
    const ab = createAutoBackup(noRepo.deps);
    await ab.runNow();
    expect(noRepo.deps.runCapture).not.toHaveBeenCalled();

    const off = makeDeps({ loadSettings: () => SETTINGS({ autoBackup: "off" }) });
    const ab2 = createAutoBackup(off.deps);
    await ab2.runNow();
    expect(off.deps.runCapture).not.toHaveBeenCalled();
  });

  it("captures errors into lastRun instead of throwing", async () => {
    const { deps } = makeDeps({ runCapture: vi.fn().mockRejectedValue(new Error("boom")) });
    const ab = createAutoBackup(deps);
    await ab.runNow();
    expect(ab.lastRun()?.error).toBe("boom");
  });

  it("reconfigure schedules with the initial delay then the frequency interval", async () => {
    const { deps, timer } = makeDeps({ initialDelayMs: 60_000 });
    const ab = createAutoBackup(deps);
    ab.reconfigure();
    expect(timer.handles[0]?.ms).toBe(60_000); // first run delayed
    await timer.handles[0]!.fn();              // fire it
    expect(deps.runCapture).toHaveBeenCalledOnce();
    expect(timer.handles[1]?.ms).toBe(24 * 60 * 60 * 1000); // next: daily
  });

  it("reconfigure with off clears and schedules nothing", () => {
    const { deps, timer } = makeDeps({ loadSettings: () => SETTINGS({ autoBackup: "off" }) });
    const ab = createAutoBackup(deps);
    ab.reconfigure();
    expect(timer.handles.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/cli/src/autoBackup.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** (`packages/cli/src/autoBackup.ts`)

```ts
// Auto-backup scheduler (ADR-0020). Pure orchestration with injected deps so it
// is unit-testable; runs inside the sidecar for the app's whole lifetime.
import type { BlockedItem } from "@roost/shared";
import type { RoostSettings, AutoBackupFreq } from "@roost/core";

export interface AutoBackupRun {
  at: string;
  captured: number;
  blocked: number;
  blockedDetail: BlockedItem[];
  pushed?: boolean;
  pushHint?: "auth" | "pull-first";
  error?: string;
}

export interface AutoBackupDeps {
  loadSettings: () => RoostSettings;
  isRepo: () => Promise<boolean>;
  runCapture: () => Promise<{ captured: number; blocked: number; blockedDetail: BlockedItem[] }>;
  runPush: () => Promise<{ ok: boolean; hint?: "auth" | "pull-first" }>;
  initialDelayMs?: number;
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout };
}

export interface AutoBackup {
  runNow(): Promise<void>;
  reconfigure(): void;
  lastRun(): AutoBackupRun | null;
  stop(): void;
}

export function intervalMsFor(freq: Exclude<AutoBackupFreq, "off">): number {
  return freq === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
}

export function createAutoBackup(deps: AutoBackupDeps): AutoBackup {
  const timers = deps.timers ?? { set: setTimeout, clear: clearTimeout };
  const initialDelay = deps.initialDelayMs ?? 60_000;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let last: AutoBackupRun | null = null;

  const runNow = async (): Promise<void> => {
    const settings = deps.loadSettings();
    if (settings.autoBackup === "off") return;
    if (!(await deps.isRepo())) return;
    const run: AutoBackupRun = { at: new Date().toISOString(), captured: 0, blocked: 0, blockedDetail: [] };
    try {
      const r = await deps.runCapture();
      run.captured = r.captured;
      run.blocked = r.blocked;
      run.blockedDetail = r.blockedDetail;
      if (settings.autoPush && r.captured > 0) {
        const p = await deps.runPush();
        run.pushed = p.ok;
        if (!p.ok) run.pushHint = p.hint;
      }
    } catch (e) {
      run.error = e instanceof Error ? e.message : String(e);
    }
    last = run;
  };

  const clear = (): void => {
    if (handle !== null) { timers.clear(handle); handle = null; }
  };

  const schedule = (delayMs: number): void => {
    clear();
    const freq = deps.loadSettings().autoBackup;
    if (freq === "off") return;
    handle = timers.set(() => {
      void runNow().finally(() => schedule(intervalMsFor(freq === "off" ? "daily" : freq)));
    }, delayMs);
    // Never keep the process alive just for the backup timer.
    (handle as { unref?: () => void }).unref?.();
  };

  return {
    runNow,
    reconfigure: () => schedule(initialDelay),
    lastRun: () => last,
    stop: clear,
  };
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run packages/cli/src/autoBackup.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add packages/cli/src/autoBackup.ts packages/cli/src/autoBackup.test.ts && git commit -m "feat(cli): auto-backup scheduler module (injected deps, ADR-0020)"`

---

### Task 3: server — `runGitPush` helper, scheduler wiring, `/api/backup/status`, settings passthrough

**Files:** Modify `packages/cli/src/server.ts`; Test `packages/cli/src/server.test.ts`.

- [ ] **Step 1: Write the failing tests** (append a describe block; reuse `makeCtx`, `ModuleRegistry`, `buildServer` from the file)

```ts
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
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/cli/src/server.test.ts -t "backup status"` → FAIL (404 / old shape).

- [ ] **Step 3: Implement in `server.ts`:**

3a. Imports: add `import { createAutoBackup } from "./autoBackup.js";` (after the `gitRepo.js` import) and add `DEFAULT_ROOST_SETTINGS` to the `@roost/core` import list. Add `import type { RoostSettings, AutoBackupFreq } from "@roost/core";` if not importable from the value import.

3b. Extract the push body into a module-scope helper (place right after `classifyGitError`) and make the route use it:

```ts
// Shared by POST /api/git/push and the auto-backup scheduler (ADR-0020).
export async function runGitPush(
  exec: Exec,
  repoDir: string,
): Promise<{ ok: boolean; output: string; hint?: "auth" | "pull-first" }> {
  // A freshly-initialized repo's branch has no upstream yet. Detect by exit
  // code (git's message is localized) and set the upstream on the first push.
  const hasUpstream =
    (await exec.run("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).code === 0;
  const branch =
    (await exec.run("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim() || "main";
  const args = hasUpstream ? ["-C", repoDir, "push"] : ["-C", repoDir, "push", "-u", "origin", branch];
  // Fail fast instead of hanging on an interactive credential prompt.
  const result = await exec.run("git", args, { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const ok = result.code === 0;
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return { ok, output, hint: ok ? undefined : classifyGitError(output) };
}
```

Route becomes:

```ts
  // ── POST /api/git/push ────────────────────────────────────────────────────────
  server.post("/api/git/push", async (_req, reply) => {
    cache.invalidateAll();
    return reply.send(await runGitPush(makeCtx(false).exec, repoDir));
  });
```

3c. Inside `buildServer` (after `const cache = createTtlCache(25_000);`), create the scheduler + start it:

```ts
  // ── auto-backup scheduler (ADR-0020) ─────────────────────────────────────────
  const autoBackup = createAutoBackup({
    loadSettings: () => loadRoostSettings(repoDir),
    isRepo: async () =>
      (await makeCtx(true).exec.run("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"])).code === 0,
    runCapture: async () => {
      const sel = loadSelection(repoDir);
      const ctx = makeCtx(false);
      const changes = await captureAll(registry, ctx, sel);
      await finalizeCapture(ctx.exec, repoDir, ctx.home);
      cache.invalidateAll();
      return {
        captured: changes.reduce((n, c) => n + c.written.length + c.encrypted.length, 0),
        blocked: changes.reduce((n, c) => n + (c.blocked?.length ?? 0), 0),
        blockedDetail: changes.flatMap((c) => c.blockedDetail ?? []),
      };
    },
    runPush: async () => {
      const r = await runGitPush(makeCtx(false).exec, repoDir);
      return { ok: r.ok, hint: r.hint };
    },
  });
  autoBackup.reconfigure();
  server.addHook("onClose", async () => autoBackup.stop());
```

3d. New endpoint (place near `/api/machines`):

```ts
  // ── GET /api/backup/status ────────────────────────────────────────────────────
  server.get("/api/backup/status", async (_req, reply) => {
    const s = loadRoostSettings(repoDir);
    const state = readState(repoDir, os.hostname());
    return reply.send({
      autoBackup: s.autoBackup,
      autoPush: s.autoPush,
      lastRun: autoBackup.lastRun(),
      lastCaptureAt: state?.capturedAt ?? null,
    });
  });
```

3e. Replace the `/api/settings` POST route:

```ts
  server.post("/api/settings", async (req, reply) => {
    const b = (req.body ?? {}) as Partial<Record<keyof RoostSettings, unknown>>;
    const prev = loadRoostSettings(repoDir);
    const freqs: AutoBackupFreq[] = ["off", "daily", "weekly"];
    const next: RoostSettings = {
      maxCaptureMB: typeof b.maxCaptureMB === "number" && b.maxCaptureMB > 0 ? b.maxCaptureMB : prev.maxCaptureMB,
      autoBackup: freqs.includes(b.autoBackup as AutoBackupFreq) ? (b.autoBackup as AutoBackupFreq) : prev.autoBackup,
      autoPush: typeof b.autoPush === "boolean" ? b.autoPush : prev.autoPush,
      checkUpdates: typeof b.checkUpdates === "boolean" ? b.checkUpdates : prev.checkUpdates,
    };
    saveRoostSettings(repoDir, next);
    autoBackup.reconfigure(); // apply frequency changes immediately
    cache.invalidateAll();
    return reply.send({ ok: true, ...next });
  });
```

Note: `os` and `readState` are already imported in server.ts. If an existing settings-route test asserts the old exact body `{ok, maxCaptureMB}`, update it to `toMatchObject({ ok: true, maxCaptureMB: ... })`.

- [ ] **Step 4: Run, verify pass** — `npx vitest run packages/cli/src/server.test.ts` → all green (incl. existing push tests, which now exercise `runGitPush`).
- [ ] **Step 5: Commit** — `git add packages/cli/src/server.ts packages/cli/src/server.test.ts && git commit -m "feat(server): auto-backup wiring, /api/backup/status, settings passthrough"`

---

### Task 4: web api — `getBackupStatus` + settings types

**Files:** Modify `packages/web/src/api.ts`.

- [ ] **Step 1: Implement** (no dedicated test — thin wrappers covered by component tests). Replace the existing `getSettings`/`saveSettings` section types and add the backup wrapper near `getMachines`:

```ts
// ── Backup freshness (ADR-0020) ───────────────────────────────────────────────
export interface BackupLastRun { at: string; captured: number; blocked: number; blockedDetail: BlockedItem[]; pushed?: boolean; pushHint?: "auth" | "pull-first"; error?: string }
export interface BackupStatus { autoBackup: "off" | "daily" | "weekly"; autoPush: boolean; lastRun: BackupLastRun | null; lastCaptureAt: string | null }
export function getBackupStatus(): Promise<BackupStatus> {
  return apiFetch<BackupStatus>("/api/backup/status");
}
```

And widen the settings shapes (find the existing `getSettings`/`saveSettings` and their response type; update to):

```ts
export interface SettingsResponse { maxCaptureMB: number; autoBackup: "off" | "daily" | "weekly"; autoPush: boolean; checkUpdates: boolean }
export function getSettings(): Promise<SettingsResponse> {
  return apiFetch<SettingsResponse>("/api/settings");
}
export function saveSettings(s: Partial<SettingsResponse>): Promise<{ ok: boolean } & SettingsResponse> {
  return apiFetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
}
```

(Check the current `saveSettings` signature first; if callers pass `{maxCaptureMB}` only, `Partial` keeps them compiling.)

- [ ] **Step 2: Typecheck** — `pnpm --filter @roost/web build` → PASS.
- [ ] **Step 3: Commit** — `git add packages/web/src/api.ts && git commit -m "feat(web): backup-status + settings api types"`

---

### Task 5: i18n — `fresh.*` + settings strings

**Files:** Modify `packages/web/src/i18n/strings.ts` (append before the closing `};`).

- [ ] **Step 1: Add the strings**

```ts
  // ── Backup freshness (banners + settings) ─────────────────────────────────
  "fresh.update.title": { en: "New version available:", zh: "新版本可用:" },
  "fresh.update.download": { en: "Download", zh: "去下载" },
  "fresh.update.dismiss": { en: "Dismiss", zh: "关闭" },
  "fresh.behind.title": { en: "Another machine pushed newer backups — behind by", zh: "另一台机器推送了新备份 —— 落后" },
  "fresh.behind.commits": { en: "commit(s)", zh: "个提交" },
  "fresh.behind.pull": { en: "Pull", zh: "拉取" },
  "fresh.behind.pulled": { en: "Updated from remote.", zh: "已从远端更新。" },
  "fresh.behind.pullFailed": { en: "Pull failed — resolve in Sync Review or a terminal.", zh: "拉取失败 —— 请在同步复核或终端处理。" },
  "fresh.ahead.title": { en: "Local backups not pushed yet:", zh: "本地备份尚未推送:" },
  "fresh.ahead.commits": { en: "commit(s)", zh: "个提交" },
  "fresh.ahead.push": { en: "Push", zh: "推送" },
  "fresh.ahead.pushed": { en: "Pushed.", zh: "已推送。" },
  "fresh.ahead.authHint": { en: "Push needs credentials — run `git push` once in a terminal, then retry.", zh: "推送需要凭据 —— 先在终端运行一次 `git push`,再重试。" },
  "fresh.ahead.pullFirstHint": { en: "Remote moved on — pull first, then push.", zh: "远端有更新 —— 先拉取再推送。" },
  "fresh.ahead.pushFailed": { en: "Push failed.", zh: "推送失败。" },
  "fresh.stale.title": { en: "Last backup was", zh: "上次备份已是" },
  "fresh.stale.daysAgo": { en: "day(s) ago", zh: "天前" },
  "fresh.stale.never": { en: "No backup has been made yet.", zh: "还没有进行过备份。" },
  "fresh.stale.backupNow": { en: "Back up now", zh: "立即备份" },
  "fresh.lastBackup": { en: "Last backup:", zh: "上次备份:" },
  "fresh.lastBackup.auto": { en: "· auto", zh: "· 自动" },
  "fresh.autoError": { en: "Auto-backup failed:", zh: "自动备份失败:" },
  "settings.autoBackup.heading": { en: "Auto backup", zh: "自动备份" },
  "settings.autoBackup.label": { en: "Frequency", zh: "频率" },
  "settings.autoBackup.off": { en: "Off", zh: "关闭" },
  "settings.autoBackup.daily": { en: "Daily", zh: "每天" },
  "settings.autoBackup.weekly": { en: "Weekly", zh: "每周" },
  "settings.autoBackup.note": { en: "Captures changes automatically while Roost is running. Overwrites nothing; the secret scanner still applies.", zh: "Roost 运行期间自动备份变化。不覆盖任何文件,密钥扫描照常生效。" },
  "settings.autoPush.label": { en: "Auto push", zh: "自动推送" },
  "settings.autoPush.note": { en: "Off by default. When on, pushes right after each auto-backup; failures show on the Overview.", zh: "默认关闭。开启后每次自动备份完成即推送,失败会在总览提醒。" },
  "settings.updates.heading": { en: "Updates", zh: "更新" },
  "settings.updates.check": { en: "Check for updates", zh: "检查更新" },
  "settings.updates.checking": { en: "Checking…", zh: "检查中…" },
  "settings.updates.latest": { en: "You're on the latest version.", zh: "已是最新版本。" },
  "settings.updates.available": { en: "New version available:", zh: "发现新版本:" },
  "settings.updates.failed": { en: "Check failed — try again later.", zh: "检查失败 —— 稍后再试。" },
  "settings.updates.toggle": { en: "Check on launch", zh: "启动时检查" },
  "settings.updates.note": { en: "The app's only outbound request — one call to GitHub for release metadata. No telemetry.", zh: "应用唯一的对外请求 —— 仅向 GitHub 查询版本信息,无任何遥测。" },
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @roost/web build` → PASS.
- [ ] **Step 3: Commit** — `git add packages/web/src/i18n/strings.ts && git commit -m "feat(web): fresh.* + auto-backup/update settings strings (en+zh)"`

---

### Task 6: web — `updateCheck.ts`

**Files:** Create `packages/web/src/updateCheck.ts`; Test `packages/web/src/updateCheck.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { isNewerVersion, checkForUpdate } from "./updateCheck";

describe("isNewerVersion", () => {
  it.each([
    ["v0.2.0", "0.1.0", true],
    ["0.1.1", "0.1.0", true],
    ["1.0.0", "0.9.9", true],
    ["0.1.0", "0.1.0", false],
    ["v0.1.0", "0.2.0", false],
    ["garbage", "0.1.0", false],
  ])("latest=%s current=%s → %s", (latest, current, want) => {
    expect(isNewerVersion(latest, current)).toBe(want);
  });
});

describe("checkForUpdate", () => {
  it("returns UpdateInfo when GitHub reports a newer tag", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v0.9.0", html_url: "https://github.com/Chenkeliang/roost/releases/tag/v0.9.0" }),
    }) as unknown as typeof fetch;
    const r = await checkForUpdate("0.1.0", fetchImpl);
    expect(r).toEqual({ version: "v0.9.0", url: "https://github.com/Chenkeliang/roost/releases/tag/v0.9.0" });
  });
  it("returns null when up to date or on any failure", async () => {
    const same = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v0.1.0", html_url: "x" }) }) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", same)).toBeNull();
    const bad = vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", bad)).toBeNull();
    const http = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", http)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- updateCheck` → FAIL.

- [ ] **Step 3: Implement** (`packages/web/src/updateCheck.ts`)

```ts
// Update check (ADR-0020): the app's only outbound request — one GitHub call
// for release metadata, user-disableable, no telemetry.
const LATEST_URL = "https://api.github.com/repos/Chenkeliang/roost/releases/latest";

export interface UpdateInfo { version: string; url: string }

export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const parts = v.replace(/^v/, "").split(".").map(Number);
    return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : null;
  };
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

export async function checkForUpdate(currentVersion: string, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo | null> {
  try {
    const res = await fetchImpl(LATEST_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    if (body.tag_name && body.html_url && isNewerVersion(body.tag_name, currentVersion)) {
      return { version: body.tag_name, url: body.html_url };
    }
    return null;
  } catch {
    return null; // silent at launch; Settings' manual check surfaces its own copy
  }
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- updateCheck` → PASS.
- [ ] **Step 5: Commit** — `git add packages/web/src/updateCheck.ts packages/web/src/updateCheck.test.ts && git commit -m "feat(web): update check helper (GitHub latest vs local version)"`

---

### Task 7: web — `FreshnessBanners`

**Files:** Create `packages/web/src/components/FreshnessBanners.tsx`; Test `packages/web/src/FreshnessBanners.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FreshnessBanners } from "./components/FreshnessBanners";
import * as api from "./api";
import type { GitStatus } from "./api";

vi.mock("./api", () => ({
  gitPush: vi.fn().mockResolvedValue({ ok: true, output: "" }),
  gitPull: vi.fn().mockResolvedValue({ ok: true, output: "" }),
}));
const t = (k: string) => k;
const GS = (over: Partial<GitStatus> = {}): GitStatus =>
  ({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true, ...over });
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

describe("FreshnessBanners", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when everything is fresh", () => {
    const { container } = render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS()} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("update banner: shows version, Download + dismiss", () => {
    const onDismiss = vi.fn();
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS()} lastCaptureAt={daysAgo(1)}
        update={{ version: "v0.9.0", url: "https://x" }} onDismissUpdate={onDismiss} onRefresh={() => {}} />,
    );
    expect(screen.getByText(/v0\.9\.0/)).toBeInTheDocument();
    screen.getByRole("button", { name: "fresh.update.dismiss" }).click();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("behind banner pulls and refreshes", async () => {
    const onRefresh = vi.fn();
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ behind: 3 })} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={onRefresh} />,
    );
    expect(screen.getByText(/3/)).toBeInTheDocument();
    screen.getByRole("button", { name: "fresh.behind.pull" }).click();
    await waitFor(() => expect(api.gitPull).toHaveBeenCalled());
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("ahead banner pushes; auth failure shows the terminal hint", async () => {
    vi.mocked(api.gitPush).mockResolvedValueOnce({ ok: false, output: "denied", hint: "auth" });
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ ahead: 2 })} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    screen.getByRole("button", { name: "fresh.ahead.push" }).click();
    expect(await screen.findByText("fresh.ahead.authHint")).toBeInTheDocument();
  });

  it("ahead banner hidden when there is no remote", () => {
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ ahead: 2, remote: null })} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "fresh.ahead.push" })).toBeNull();
  });

  it("stale banner appears at 7+ days and when never backed up", () => {
    const { rerender } = render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS()} lastCaptureAt={daysAgo(8)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(screen.getByText(/fresh\.stale\.title/)).toBeInTheDocument();
    rerender(
      <FreshnessBanners t={t} locale="en" gitStatus={GS()} lastCaptureAt={null} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(screen.getByText("fresh.stale.never")).toBeInTheDocument();
  });

  it("no banners at all when there is no repo (onboarding owns that state)", () => {
    const { container } = render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ isRepo: false })} lastCaptureAt={null}
        update={{ version: "v9", url: "x" }} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- FreshnessBanners` → FAIL.

- [ ] **Step 3: Implement** (`packages/web/src/components/FreshnessBanners.tsx`)

```tsx
import { useState } from "react";
import { ArrowSquareOut, DownloadSimple, UploadSimple, ClockCounterClockwise, X } from "@phosphor-icons/react";
import { gitPush, gitPull } from "../api";
import type { GitStatus } from "../api";
import type { HudMessage } from "./Hud";
import { openExternal } from "../openExternal";
import type { UpdateInfo } from "../updateCheck";

export const STALE_DAYS = 7;

const banner: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface)", border: "1px solid #4a3a1e", borderRadius: "var(--rc)", marginBottom: 14, fontSize: 13.5, flexWrap: "wrap" };
const cta: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e" };
const dot = (color: string): React.CSSProperties => ({ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 });

export function FreshnessBanners({ t, locale, gitStatus, lastCaptureAt, update, onDismissUpdate, onRefresh, showHud }: {
  t: (k: string) => string;
  locale: string;
  gitStatus: GitStatus | null;
  lastCaptureAt: string | null;
  update: UpdateInfo | null;
  onDismissUpdate: () => void;
  onRefresh: () => void;
  showHud?: (m: HudMessage) => void;
}) {
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [pushErrKey, setPushErrKey] = useState<string | null>(null);
  const [pullFailed, setPullFailed] = useState(false);

  // Onboarding owns the no-repo state; while git status is unknown, stay quiet.
  if (!gitStatus || !gitStatus.isRepo) return null;

  const pull = async () => {
    setBusy("pull"); setPullFailed(false);
    try {
      const r = await gitPull();
      if (r.ok) { showHud?.({ text: t("fresh.behind.pulled"), type: "success" }); onRefresh(); }
      else setPullFailed(true);
    } catch { setPullFailed(true); }
    finally { setBusy(null); }
  };

  const push = async () => {
    setBusy("push"); setPushErrKey(null);
    try {
      const r = await gitPush();
      if (r.ok) { showHud?.({ text: t("fresh.ahead.pushed"), type: "success" }); onRefresh(); }
      else setPushErrKey(r.hint === "auth" ? "fresh.ahead.authHint" : r.hint === "pull-first" ? "fresh.ahead.pullFirstHint" : "fresh.ahead.pushFailed");
    } catch { setPushErrKey("fresh.ahead.pushFailed"); }
    finally { setBusy(null); }
  };

  const staleDays = lastCaptureAt === null
    ? Infinity
    : Math.floor((Date.now() - new Date(lastCaptureAt).getTime()) / (24 * 60 * 60 * 1000));
  void locale; // reserved for future relative-time formatting

  return (
    <>
      {update && (
        <div style={banner} role="status">
          <ArrowSquareOut size={15} style={{ color: "var(--amber)", flexShrink: 0 }} />
          <span>{t("fresh.update.title")} <span className="mono">{update.version}</span></span>
          <span style={{ flex: 1 }} />
          <button onClick={() => void openExternal(update.url)} style={cta}>{t("fresh.update.download")}</button>
          <button onClick={onDismissUpdate} aria-label={t("fresh.update.dismiss")} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2 }} title={t("fresh.update.dismiss")}>
            <X size={14} />
          </button>
        </div>
      )}

      {gitStatus.behind > 0 && (
        <div style={banner} role="status">
          <span style={dot("var(--amber)")} />
          <span>{t("fresh.behind.title")} {gitStatus.behind} {t("fresh.behind.commits")}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => void pull()} disabled={busy !== null} style={cta}><DownloadSimple size={13} style={{ marginRight: 4, verticalAlign: -2 }} />{busy === "pull" ? "…" : t("fresh.behind.pull")}</button>
          {pullFailed && <span style={{ color: "var(--red)", fontSize: 12.5, width: "100%" }}>{t("fresh.behind.pullFailed")}</span>}
        </div>
      )}

      {gitStatus.ahead > 0 && gitStatus.remote !== null && (
        <div style={banner} role="status">
          <span style={dot("var(--amber)")} />
          <span>{t("fresh.ahead.title")} {gitStatus.ahead} {t("fresh.ahead.commits")}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => void push()} disabled={busy !== null} style={cta}><UploadSimple size={13} style={{ marginRight: 4, verticalAlign: -2 }} />{busy === "push" ? "…" : t("fresh.ahead.push")}</button>
          {pushErrKey && <span style={{ color: "var(--red)", fontSize: 12.5, width: "100%" }}>{t(pushErrKey)}</span>}
        </div>
      )}

      {staleDays >= STALE_DAYS && (
        <div style={banner} role="status">
          <ClockCounterClockwise size={15} style={{ color: "var(--amber)", flexShrink: 0 }} />
          <span>
            {lastCaptureAt === null
              ? t("fresh.stale.never")
              : `${t("fresh.stale.title")} ${staleDays} ${t("fresh.stale.daysAgo")}`}
          </span>
        </div>
      )}
    </>
  );
}
```

Note: the stale banner intentionally has **no button** — the coral Capture button sits directly below it on the Overview; a second capture trigger would duplicate the primary action. (The spec sketch said "立即备份"; pointing at the existing primary button is the cleaner interaction — flag this refinement in the PR.) `openExternal` exists at `packages/web/src/openExternal.ts`.

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- FreshnessBanners` → PASS.
- [ ] **Step 5: Commit** — `git add packages/web/src/components/FreshnessBanners.tsx packages/web/src/FreshnessBanners.test.tsx && git commit -m "feat(web): FreshnessBanners (update / behind / ahead / stale)"`

---

### Task 8: web — Overview wiring

**Files:** Modify `packages/web/src/views/Overview.tsx`; Test `packages/web/src/Overview.test.tsx` (extend the existing mock + add cases).

- [ ] **Step 1: Write the failing tests.** In `Overview.test.tsx`'s `vi.mock("./api", ...)` factory add:

```ts
  getBackupStatus: vi.fn().mockResolvedValue({ autoBackup: "daily", autoPush: false, lastRun: null, lastCaptureAt: new Date().toISOString() }),
  gitPull: vi.fn().mockResolvedValue({ ok: true, output: "" }),
  gitPush: vi.fn().mockResolvedValue({ ok: true, output: "" }),
```

Then append:

```tsx
  it("shows the unpushed banner when git status reports ahead > 0", async () => {
    vi.mocked(api.getGitStatus).mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 2, behind: 0, clean: true });
    await act(async () => { render(<Overview showHud={noop} />); });
    expect(await screen.findByRole("button", { name: /Push|推送/ })).toBeInTheDocument();
  });

  it("shows the stale banner when the last capture is older than 7 days", async () => {
    vi.mocked(api.getBackupStatus).mockResolvedValue({ autoBackup: "daily", autoPush: false, lastRun: null, lastCaptureAt: new Date(Date.now() - 9 * 86400000).toISOString() });
    await act(async () => { render(<Overview showHud={noop} />); });
    expect(await screen.findByText(/Last backup was|上次备份已是/)).toBeInTheDocument();
  });
```

(Note: Overview tests render real English via the no-provider default — assert on English copy or `/en|zh/` regex as the existing file does.)

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- Overview` → FAIL (banners absent).

- [ ] **Step 3: Implement in `Overview.tsx`:**

3a. Imports:

```tsx
import { getBackupStatus } from "../api";
import type { BackupStatus } from "../api";
import { FreshnessBanners } from "../components/FreshnessBanners";
import { checkForUpdate } from "../updateCheck";
import type { UpdateInfo } from "../updateCheck";
```

3b. State (next to `gitStatus`):

```tsx
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
```

3c. In `fetchData`, add `getBackupStatus()` to the fast trio (it is a cheap local read):

```tsx
    const [h, m, git, backup] = await Promise.allSettled([getHealth(), getMachines(), getGitStatus(), getBackupStatus()]);
    if (h.status === "fulfilled") setHealth(h.value);
    if (m.status === "fulfilled") setMachines(m.value);
    if (git.status === "fulfilled") setGitStatus(git.value);
    if (backup.status === "fulfilled") setBackupStatus(backup.value);
```

3d. Update check — once per mount, Tauri-only, respecting the dismissed version (add below the existing data-load `useEffect`):

```tsx
  useEffect(() => {
    // Once per app session; browser/dev mode has no Tauri version — skip silently.
    let cancelled = false;
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const current = await getVersion();
        const info = await checkForUpdate(current);
        if (!cancelled && info && localStorage.getItem("roost.dismissedUpdate") !== info.version) setUpdate(info);
      } catch { /* not running under Tauri */ }
    })();
    return () => { cancelled = true; };
  }, []);
```

3e. Render — directly under the missing-deps banner (before the error block), add:

```tsx
      <FreshnessBanners
        t={t}
        locale={locale}
        gitStatus={gitStatus}
        lastCaptureAt={backupStatus?.lastCaptureAt ?? null}
        update={update}
        onDismissUpdate={() => { if (update) localStorage.setItem("roost.dismissedUpdate", update.version); setUpdate(null); }}
        onRefresh={() => void fetchData()}
        showHud={showHud}
      />
```

(`locale` comes from `const { t, locale } = useT();` — widen the existing destructure.)

3f. Last-backup line — inside the primary-actions row, replace the existing right-side hint span content so it shows freshness first:

```tsx
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 13 }}>
          {backupStatus?.lastCaptureAt && (
            <>
              {t("fresh.lastBackup")} {new Intl.RelativeTimeFormat(locale === "zh" ? "zh" : "en", { numeric: "auto" }).format(Math.round((new Date(backupStatus.lastCaptureAt).getTime() - Date.now()) / 3600000), "hour")}
              {backupStatus.lastRun && backupStatus.lastRun.captured > 0 && new Date(backupStatus.lastRun.at) >= new Date(backupStatus.lastCaptureAt) ? ` ${t("fresh.lastBackup.auto")}` : ""}
              {" · "}
            </>
          )}
          ↵ to capture · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>⌘K actions</span>
        </span>
```

3g. Auto-run error surfacing — right below the banners:

```tsx
      {backupStatus?.lastRun?.error && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: "rgba(242,85,90,.08)", border: "1px solid var(--red)", borderRadius: "var(--rr)", color: "var(--red)", fontSize: 13 }}>
          {t("fresh.autoError")} {backupStatus.lastRun.error}
        </div>
      )}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- Overview` and `-- OnboardingGate` → all green (OnboardingGate's mock factory needs `getBackupStatus: vi.fn()` added with a resolved value — do it).
- [ ] **Step 5: Commit** — `git add packages/web/src/views/Overview.tsx packages/web/src/Overview.test.tsx packages/web/src/OnboardingGate.test.tsx && git commit -m "feat(web): Overview freshness banners + last-backup line + update check"`

---

### Task 9: web — Settings 自动备份 + 更新 section

**Files:** Modify `packages/web/src/views/Settings.tsx`; Test `packages/web/src/SettingsAuto.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Settings } from "./views/Settings";
import * as api from "./api";

vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "mac", repoDir: "/r", ageKey: false }),
  getModules: vi.fn().mockResolvedValue({ modules: [] }),
  getGitStatus: vi.fn().mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true }),
  gitPush: vi.fn(), gitPull: vi.fn(),
  getKey: vi.fn().mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k", encryptedFiles: 0 }),
  generateKey: vi.fn(), rotateKey: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true }),
  saveSettings: vi.fn().mockResolvedValue({ ok: true, maxCaptureMB: 100, autoBackup: "weekly", autoPush: false, checkUpdates: true }),
}));
vi.mock("./updateCheck", () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  isNewerVersion: vi.fn(),
}));

describe("Settings auto-backup section", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changing frequency saves the setting", async () => {
    render(<Settings />);
    const select = await screen.findByLabelText(/Frequency|频率/);
    fireEvent.change(select, { target: { value: "weekly" } });
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoBackup: "weekly" })));
  });

  it("manual update check shows the up-to-date message", async () => {
    render(<Settings />);
    (await screen.findByRole("button", { name: /Check for updates|检查更新/ })).click();
    expect(await screen.findByText(/latest version|已是最新/)).toBeInTheDocument();
  });
});
```

(Settings renders English by default without a provider; if existing Settings tests mock differently, match the existing harness. `getVersion` is unavailable in jsdom — the manual check must tolerate that: when the Tauri import fails, treat current version as `"0.0.0"` so the flow still works in dev/browser.)

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- SettingsAuto` → FAIL.

- [ ] **Step 3: Implement in `Settings.tsx`:**

3a. State + load: extend the existing settings state from `maxCaptureMB` only to the full shape:

```tsx
  const [appSettings, setAppSettings] = useState<{ autoBackup: "off" | "daily" | "weekly"; autoPush: boolean; checkUpdates: boolean }>({ autoBackup: "daily", autoPush: false, checkUpdates: true });
  const [updateResult, setUpdateResult] = useState<"checking" | "latest" | "failed" | { version: string; url: string } | null>(null);
```

In the mount load (where `setMaxCaptureMB(settings.value.maxCaptureMB)` happens), also:

```tsx
        if (settings.status === "fulfilled") {
          setMaxCaptureMB(settings.value.maxCaptureMB);
          setAppSettings({ autoBackup: settings.value.autoBackup, autoPush: settings.value.autoPush, checkUpdates: settings.value.checkUpdates });
        }
```

3b. Save helper:

```tsx
  async function saveApp(next: Partial<{ autoBackup: "off" | "daily" | "weekly"; autoPush: boolean; checkUpdates: boolean }>) {
    const merged = { ...appSettings, ...next };
    setAppSettings(merged);
    try { await saveSettings(merged); } catch { /* keep optimistic state; next load re-syncs */ }
  }
```

3c. Manual check:

```tsx
  async function handleCheckUpdates() {
    setUpdateResult("checking");
    let current = "0.0.0";
    try { current = await (await import("@tauri-apps/api/app")).getVersion(); } catch { /* browser/dev */ }
    try {
      const info = await checkForUpdate(current);
      setUpdateResult(info ?? "latest");
    } catch { setUpdateResult("failed"); }
  }
```

(Import `checkForUpdate` from `../updateCheck`, `openExternal` from `../openExternal`, `saveSettings` already imported.)

3d. JSX — add two sections after the existing maxCapture section, following the `sectionLabel` + `row` style consts already in the file:

```tsx
      {/* ── Auto backup (ADR-0020) ── */}
      <div style={sectionLabel}>{t("settings.autoBackup.heading")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={row}>
          <label htmlFor="auto-backup-freq" style={{ color: "var(--muted)", minWidth: 80 }}>{t("settings.autoBackup.label")}</label>
          <select
            id="auto-backup-freq"
            value={appSettings.autoBackup}
            onChange={(e) => void saveApp({ autoBackup: e.target.value as "off" | "daily" | "weekly" })}
            style={{ background: "var(--raise)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 9px", fontFamily: "var(--font)", fontSize: 13 }}
          >
            <option value="off">{t("settings.autoBackup.off")}</option>
            <option value="daily">{t("settings.autoBackup.daily")}</option>
            <option value="weekly">{t("settings.autoBackup.weekly")}</option>
          </select>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{t("settings.autoBackup.note")}</div>
        <div style={row}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
            <input type="checkbox" checked={appSettings.autoPush} onChange={(e) => void saveApp({ autoPush: e.target.checked })} />
            {t("settings.autoPush.label")}
          </label>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{t("settings.autoPush.note")}</div>
      </div>

      {/* ── Updates ── */}
      <div style={sectionLabel}>{t("settings.updates.heading")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={row}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
            <input type="checkbox" checked={appSettings.checkUpdates} onChange={(e) => void saveApp({ checkUpdates: e.target.checked })} />
            {t("settings.updates.toggle")}
          </label>
          <span style={{ flex: 1 }} />
          <button onClick={() => void handleCheckUpdates()} disabled={updateResult === "checking"}
            style={{ padding: "6px 13px", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rr)", fontSize: 13, cursor: "pointer", color: "var(--text)" }}>
            {updateResult === "checking" ? t("settings.updates.checking") : t("settings.updates.check")}
          </button>
        </div>
        {updateResult === "latest" && <div style={{ fontSize: 13, color: "var(--green)" }}>{t("settings.updates.latest")}</div>}
        {updateResult === "failed" && <div style={{ fontSize: 13, color: "var(--red)" }}>{t("settings.updates.failed")}</div>}
        {updateResult !== null && typeof updateResult === "object" && (
          <div style={{ fontSize: 13 }}>
            {t("settings.updates.available")} <span className="mono">{updateResult.version}</span>{" "}
            <button onClick={() => void openExternal(updateResult.url)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontFamily: "var(--font)", fontSize: 13, padding: 0 }}>
              {t("fresh.update.download")}
            </button>
          </div>
        )}
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{t("settings.updates.note")}</div>
      </div>
```

(`checkUpdates` gating of the launch check lives in Overview via settings? — No: the launch check reads it implicitly because Overview's check runs regardless. Gate it: in Task 8's update-check effect, first `const s = await getSettings().catch(() => null); if (s && !s.checkUpdates) return;` — add that line in this task if it was not added in Task 8, and update the Task 8 effect accordingly. The implementer of Task 8 must include the `getSettings` gate; the implementer of Task 9 verifies it exists.)

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- SettingsAuto` and the existing `-- Settings` tests → green.
- [ ] **Step 5: Commit** — `git add packages/web/src/views/Settings.tsx packages/web/src/SettingsAuto.test.tsx && git commit -m "feat(web): Settings auto-backup + updates sections"`

---

### Task 10: CSP + full verification

**Files:** Modify `packages/web/src-tauri/tauri.conf.json`.

- [ ] **Step 1: CSP** — change the `csp` line's `connect-src` to:

```json
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:4317 https://api.github.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
```

- [ ] **Step 2: Full verification**
  - `pnpm -r build` → PASS
  - `pnpm lint` → clean
  - `pnpm test` (core/cli/shared) → green
  - `pnpm --filter @roost/web test` → green
  - `pnpm build:sidecar` → both arches
- [ ] **Step 3: Commit** — `git add packages/web/src-tauri/tauri.conf.json && git commit -m "feat(desktop): allow GitHub API in CSP for update check"`

---

## Self-Review

**1. Spec coverage:** settings fields → T1; scheduler (60s delay, daily/weekly, autoPush opt-in, lastRun, reconfigure-on-settings) → T2+T3; `runGitPush` extraction → T3; `/api/backup/status` (incl. `lastCaptureAt` from MachineState) → T3; banners update/behind/ahead/stale with priority and exact interactions → T7+T8; dismiss persistence per-version → T8; last-backup line + auto label + auto-error row → T8; update check (launch + manual, Tauri-version, browser-safe, checkUpdates gate) → T6+T8+T9; Settings section → T9; CSP → T10; tests per spec §5 → every task + T10.
**Refinement noted:** the stale banner carries no duplicate "backup now" button (the coral Capture button is directly below) — flagged in T7 for the reviewer/PR.
**2. Placeholder scan:** none; every code step is complete.
**3. Type consistency:** `AutoBackupFreq`/`RoostSettings` (T1) ↔ scheduler deps (T2) ↔ server routes (T3) ↔ `SettingsResponse`/`BackupStatus` (T4) ↔ component props (T7/T8/T9); `runGitPush` return matches `gitPush` wrapper's `GitOpResult` shape (`ok/output/hint`); `UpdateInfo` shared T6→T7/T8/T9; i18n keys defined in T5 are exactly those consumed in T7/T8/T9.
