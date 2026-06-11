# Roost Repo Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop config-repo bloat: skip re-encryption when plaintext is unchanged, gate new >10MB files (advise stock ones), and single-flight pushes — per `docs/superpowers/specs/2026-06-11-roost-repo-hygiene-design.md` and ADR-0021.

**Architecture:** `encHashes` (plaintext sha256 per file) stored beside the ADR-0018 baseline in `state/<host>.json`; the dotfiles module short-circuits `chezmoi add --encrypt` on hash match and post-add-forgets large/excluded files; the server gains a push lock, `largeItems` on `/api/backup/status`, and `POST /api/dotfiles/exclude`; the web surfaces blocked-"large" actions and a stock-large-files advisory. **Invariant: never modify/delete a user's local file** — all remediation is repo/selection-side (`chezmoi forget`).

**Tech Stack:** TS strict, Fastify, React+Vite, vitest. Branch `feat_repo_hygiene` (already cut from main). Stage explicitly, one commit per task, no push.

---

## Shared contracts

```ts
// shared/src/types.ts
export type BlockReason = "secret" | "too-large" | "managed" | "error" | "large";

// core: constants + helpers
export const LARGE_FILE_MB = 10;                       // exported from core (dotfiles.ts), re-exported in core index
// state.ts (mirror readBaseline/writeBaseline):
export function readEncHashes(state: MachineState, moduleName: string): Record<string, string>;
export function writeEncHashes(state: MachineState, moduleName: string, hashes: Record<string, string>): MachineState;
// sync-baseline.ts (mirror loadModuleBaseline/recordModuleBaseline):
export function loadModuleEncHashes(repoDir: string, moduleName: string): Record<string, string>;
export function recordModuleEncHashes(repoDir: string, host: string, moduleName: string, hashes: Record<string, string>): void; // MERGE into existing bag

// selection convention lists (strings in selection.yaml modules map, like dotfiles-encrypt):
//   "dotfiles-exclude"   — sticky never-capture paths (absolute target paths)
//   "dotfiles-large-ok"  — user-approved large files (absolute target paths)

// server:
//   guardedPush(): runGitPush wrapped in a single-flight lock; concurrent → { ok:false, output:"push already in progress", hint:"busy" }
//   GET /api/backup/status response gains: largeItems: { path: string; mb: number }[]   (path = TARGET path, e.g. /Users/x/.config/foo.dat)
//   POST /api/dotfiles/exclude { path } → chezmoi forget (tolerant) + addItem(sel,"dotfiles-exclude",path) + finalizeCapture + cache.invalidateAll → { ok:true }

// web/src/api.ts:
//   GitOpResult.hint: "auth" | "pull-first" | "busy"
//   BackupStatus gains largeItems: { path: string; mb: number }[]
//   export function excludeDotfile(path: string): Promise<{ ok: boolean }>
```

`sourceToTarget(rel, home)` (server-local helper): maps a repo-source-relative path to the absolute target path — per segment: leading `dot_` → `.`; strip attribute prefixes `encrypted_`, `private_`, `literal_`, `executable_`, `readonly_`, `exact_`, `empty_`, `symlink_` (repeatedly); strip one trailing `.age` then `.tmpl` on the filename. Join under `home`.

## File map

**Modified:** `packages/shared/src/types.ts` · `packages/core/src/state.ts` + `state.test.ts`-style additions in `packages/core/src/sync-baseline.test.ts` (create if missing) · `packages/core/src/sync-baseline.ts` · `packages/core/src/modules/dotfiles.ts` + `dotfiles.test.ts` · `packages/core/src/index.ts` (exports) · `packages/cli/src/server.ts` + `server.test.ts` · `packages/web/src/api.ts` · `packages/web/src/i18n/strings.ts` · `packages/web/src/views/Overview.tsx` + `Overview.test.tsx` · `packages/web/src/components/FreshnessBanners.tsx` + `FreshnessBanners.test.tsx`.
**New:** `packages/web/src/components/LargeFilesAdvisory.tsx` + `packages/web/src/LargeFilesAdvisory.test.tsx`.

---

### Task 1: shared + core — `"large"` reason, encHashes helpers

**Files:** Modify `packages/shared/src/types.ts:63`, `packages/core/src/state.ts`, `packages/core/src/sync-baseline.ts`, `packages/core/src/index.ts`; Test `packages/core/src/sync-baseline.test.ts` (append; create with the same imports style as `state.test.ts` if missing).

- [ ] **Step 1: Failing test** (`packages/core/src/sync-baseline.test.ts`, append or create)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadModuleEncHashes, recordModuleEncHashes } from "./sync-baseline.js";
import { readState, readBaseline } from "./state.js";

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ench-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("encHashes (ADR-0021)", () => {
  it("round-trips and MERGES per-module plaintext hashes", () => {
    const host = "test-host";
    recordModuleEncHashes(tmpDir, host, "dotfiles", { "/a": "h1", "/b": "h2" });
    recordModuleEncHashes(tmpDir, host, "dotfiles", { "/b": "h2x", "/c": "h3" });
    // loadModuleEncHashes reads THIS machine's host; emulate by reading state directly
    const st = readState(tmpDir, host);
    expect(st).not.toBeNull();
    const entry = st!.modules["dotfiles"] as { encHashes?: Record<string, string> };
    expect(entry.encHashes).toEqual({ "/a": "h1", "/b": "h2x", "/c": "h3" });
  });

  it("does not disturb the ADR-0018 baseline bag", () => {
    const host = "test-host";
    recordModuleEncHashes(tmpDir, host, "dotfiles", { "/a": "h1" });
    const st = readState(tmpDir, host)!;
    expect(readBaseline(st, "dotfiles")).toEqual({});
  });

  it("loadModuleEncHashes returns {} when no state exists", () => {
    expect(loadModuleEncHashes(tmpDir, "dotfiles")).toEqual({});
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/core/src/sync-baseline.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement.**

3a. `packages/shared/src/types.ts` line 63:

```ts
export type BlockReason = "secret" | "too-large" | "managed" | "error" | "large";
```

3b. `packages/core/src/state.ts` — append after `writeBaseline` (mirror its style):

```ts
// Read a module's plaintext-hash bag (ADR-0021), tolerating missing/legacy shapes.
export function readEncHashes(state: MachineState, moduleName: string): Record<string, string> {
  const entry = state.modules[moduleName];
  if (entry && typeof entry === "object" && "encHashes" in entry) {
    const b = (entry as { encHashes?: unknown }).encHashes;
    if (b && typeof b === "object") return { ...(b as Record<string, string>) };
  }
  return {};
}

// Return a NEW MachineState with the given module's encHashes replaced (immutable).
export function writeEncHashes(
  state: MachineState,
  moduleName: string,
  hashes: Record<string, string>,
): MachineState {
  const prevEntry = state.modules[moduleName];
  const prevObj =
    prevEntry && typeof prevEntry === "object" ? (prevEntry as Record<string, unknown>) : {};
  return {
    ...state,
    modules: { ...state.modules, [moduleName]: { ...prevObj, encHashes: hashes } },
  };
}
```

3c. `packages/core/src/sync-baseline.ts` — extend the state.js import with `readEncHashes, writeEncHashes`, and append:

```ts
// This machine's plaintext-hash bag for a module's encrypted files (ADR-0021).
export function loadModuleEncHashes(repoDir: string, moduleName: string): Record<string, string> {
  try {
    const st = readState(repoDir, os.hostname());
    return st ? readEncHashes(st, moduleName) : {};
  } catch {
    return {};
  }
}

// Merge newly captured plaintext hashes into this machine's record, so the next
// capture can skip re-encrypting unchanged files. Never throws.
export function recordModuleEncHashes(
  repoDir: string,
  host: string,
  moduleName: string,
  hashes: Record<string, string>,
): void {
  let st: MachineState | null = null;
  try {
    st = readState(repoDir, host);
  } catch {
    st = null;
  }
  let next: MachineState = st ?? {
    host,
    schemaVersion: STATE_SCHEMA_VERSION,
    capturedAt: null,
    modules: {},
  };
  const merged = { ...readEncHashes(next, moduleName), ...hashes };
  next = writeEncHashes(next, moduleName, merged);
  next.schemaVersion = STATE_SCHEMA_VERSION;
  writeState(repoDir, next);
}
```

3d. `packages/core/src/index.ts` — add `loadModuleEncHashes`, `recordModuleEncHashes` to the sync-baseline export line, and `readEncHashes`, `writeEncHashes` to the state export line (match the file's existing export grouping).

- [ ] **Step 4: Run, verify pass** — `npx vitest run packages/core/src/sync-baseline.test.ts` and `npx vitest run packages/core packages/shared` → green.
- [ ] **Step 5: Commit** — `git add packages/shared/src/types.ts packages/core/src/state.ts packages/core/src/sync-baseline.ts packages/core/src/sync-baseline.test.ts packages/core/src/index.ts && git commit -m "feat(core): encHashes record + 'large' block reason (ADR-0021)"`

---

### Task 2: core — dotfiles capture: skip-unchanged encryption + large-file gate

**Files:** Modify `packages/core/src/modules/dotfiles.ts` (capture, lines ~244-330); Test `packages/core/src/modules/dotfiles.test.ts` (append).

- [ ] **Step 1: Failing tests** (append to `dotfiles.test.ts`; reuse its existing fake-exec/ctx harness — read the top of the file and mirror how other capture tests build `ctx`, fake exec and selection. The fake exec must record calls so we can assert which `chezmoi` subcommands ran.)

```ts
describe("capture churn control + large-file gate (ADR-0021)", () => {
  it("skips chezmoi add --encrypt when plaintext hashes are unchanged and source has the file", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const f = path.join(home, ".secret-conf");
    fs.writeFileSync(f, "value=1\n", "utf8");

    // mark for encryption via the marked-encrypt convention
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", f);
    sel = addItem(sel, "dotfiles-encrypt", f);

    const { exec, calls } = makeFakeExec([]); // every call exits 0; "chezmoi managed" returns "" by default
    const ctx = makeCtx({ exec, home, repoDir });

    // 1st capture: must add (no recorded hash yet)
    await dotfilesModule.capture(ctx, sel);
    const adds1 = calls.filter((c) => c.cmd === "chezmoi" && c.args.includes("add")).length;
    expect(adds1).toBe(1);

    // pretend the source now holds the ciphertext: chezmoi managed lists the file
    const rel = path.relative(home, f);
    const { exec: exec2, calls: calls2 } = makeFakeExec([]);
    (exec2 as { run: (c: string, a: string[]) => Promise<ExecResult> }).run = async (cmd, args) => {
      calls2.push({ cmd, args });
      if (cmd === "chezmoi" && args.includes("managed")) return { code: 0, stdout: rel + "\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const ctx2 = makeCtx({ exec: exec2, home, repoDir });

    // 2nd capture, unchanged plaintext: must SKIP the add
    await dotfilesModule.capture(ctx2, sel);
    expect(calls2.filter((c) => c.cmd === "chezmoi" && c.args.includes("add")).length).toBe(0);

    // change the plaintext → must add again
    fs.writeFileSync(f, "value=2\n", "utf8");
    await dotfilesModule.capture(ctx2, sel);
    expect(calls2.filter((c) => c.cmd === "chezmoi" && c.args.includes("add")).length).toBe(1);
  });

  it("blocks a NEW >10MB file with reason 'large' and forgets it from the source — local file untouched", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const dir = path.join(home, ".bigapp");
    fs.mkdirSync(dir);
    const big = path.join(dir, "huge.bin");
    fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024)); // 11MB
    fs.writeFileSync(path.join(dir, "small.conf"), "ok\n", "utf8");

    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", dir);

    const { exec, calls } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home, repoDir });
    const cs = await dotfilesModule.capture(ctx, sel);

    expect(cs.blockedDetail?.some((b) => b.id === big && b.reason === "large")).toBe(true);
    // forgotten from the source after the dir add
    expect(calls.some((c) => c.cmd === "chezmoi" && c.args.includes("forget") && c.args.includes(big))).toBe(true);
    // the local file is untouched
    expect(fs.existsSync(big)).toBe(true);
  });

  it("respects dotfiles-large-ok (no block) and dotfiles-exclude (silent forget)", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const dir = path.join(home, ".bigapp2");
    fs.mkdirSync(dir);
    const big = path.join(dir, "huge.bin");
    const noisy = path.join(dir, "cache.db");
    fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024));
    fs.writeFileSync(noisy, "x", "utf8");

    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", dir);
    sel = addItem(sel, "dotfiles-large-ok", big);
    sel = addItem(sel, "dotfiles-exclude", noisy);

    const { exec, calls } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home, repoDir });
    const cs = await dotfilesModule.capture(ctx, sel);

    expect(cs.blockedDetail?.some((b) => b.reason === "large")).toBe(false);
    // approved big file NOT forgotten; excluded path IS forgotten (silently)
    expect(calls.some((c) => c.cmd === "chezmoi" && c.args.includes("forget") && c.args.includes(big))).toBe(false);
    expect(calls.some((c) => c.cmd === "chezmoi" && c.args.includes("forget") && c.args.includes(noisy))).toBe(true);
    expect(fs.existsSync(noisy)).toBe(true); // local file untouched
  });
});
```

(Adapt harness names — `makeFakeExec`/`makeCtx`/`emptySelection`/`addItem`/`dotfilesModule` — to the test file's actual imports; check how the existing capture tests get the module instance.)

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/core/src/modules/dotfiles.test.ts -t "ADR-0021"` → FAIL.

- [ ] **Step 3: Implement in `dotfiles.ts`:**

3a. Imports: add `import { createHash } from "node:crypto";` and extend the sync-baseline import with `loadModuleEncHashes, recordModuleEncHashes`; add `import * as os from "node:os";` if absent. Export the threshold near the top:

```ts
// Per-file size gate (ADR-0021): new files above this are blocked pending user
// confirmation. Repo-side only — local files are never touched.
export const LARGE_FILE_MB = 10;
```

3b. Local helpers (module scope):

```ts
// Regular files under a path (the path itself if it is a file). Symlinks skipped.
function walkRegularFiles(p: string): string[] {
  let st: fs.Stats;
  try { st = fs.lstatSync(p); } catch { return []; }
  if (st.isSymbolicLink()) return [];
  if (st.isFile()) return [p];
  if (!st.isDirectory()) return [];
  let out: string[] = [];
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) out = out.concat(walkRegularFiles(path.join(p, e.name)));
  return out;
}

function sha256File(p: string): string | null {
  try { return createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } catch { return null; }
}
```

3c. In `capture`, before the `for (const id of ids)` loop:

```ts
    const excludeList = sel.modules["dotfiles-exclude"] ?? [];
    const largeOk = new Set(sel.modules["dotfiles-large-ok"] ?? []);
    const prevEncHashes = loadModuleEncHashes(ctx.repoDir, "dotfiles");
    const newEncHashes: Record<string, string> = {};
    // Target paths chezmoi already manages (relative to home) → absolute set.
    let managedAbs: Set<string>;
    try {
      managedAbs = new Set((await chezmoi.managed()).map((rel) => path.join(ctx.home, rel)));
    } catch {
      managedAbs = new Set();
    }
    const isExcluded = (f: string): boolean =>
      excludeList.some((e) => f === e || f.startsWith(e.endsWith("/") ? e : e + "/"));
```

3d. Inside the loop — replace the `wantsEncrypt` add block and the plain add tail with gate-aware versions. After the existing `scan.tooLarge` / secret-gate checks, insert the shared gate computation, then the encrypted-skip:

```ts
      const files = walkRegularFiles(id);
      const largeNew = files.filter(
        (f) =>
          !isExcluded(f) &&
          !largeOk.has(f) &&
          !managedAbs.has(f) &&
          (fs.statSync(f).size > LARGE_FILE_MB * 1024 * 1024),
      );
      const toForget = [...new Set([...files.filter(isExcluded), ...largeNew])];

      const forgetOffenders = async (): Promise<void> => {
        for (const f of toForget) {
          try { await chezmoi.forget(f); } catch { /* not managed → nothing to remove */ }
        }
        for (const f of largeNew) {
          blocked.push(f);
          blockedDetail.push({
            id: f,
            reason: "large",
            detail: `${Math.round(fs.statSync(f).size / 1048576)}MB`,
          });
        }
      };
```

In the `wantsEncrypt` branch, before `await chezmoi.add(id, { encrypt: true })`:

```ts
        // Churn control (ADR-0021): age output is non-deterministic, so skip the
        // re-encrypt entirely when every plaintext hash is unchanged and the
        // source already holds the ciphertext.
        const hashable = files.filter((f) => !isExcluded(f));
        const hashes: Record<string, string> = {};
        let allKnown = hashable.length > 0;
        for (const f of hashable) {
          const h = sha256File(f);
          if (h === null) { allKnown = false; break; }
          hashes[f] = h;
        }
        const unchanged =
          allKnown &&
          hashable.every((f) => prevEncHashes[f] === hashes[f] && managedAbs.has(f));
        if (unchanged) {
          encrypted.push(id); // state is current; no new ciphertext produced
          continue;
        }
        await chezmoi.add(id, { encrypt: true });
        await forgetOffenders();
        Object.assign(newEncHashes, hashes);
        encrypted.push(id);
        continue;
```

(The original `await chezmoi.add(id, { encrypt: true }); encrypted.push(id); continue;` lines are replaced by the above.) In the plain tail, replace `await chezmoi.add(id, { encrypt: false }); written.push(id);` with:

```ts
      await chezmoi.add(id, { encrypt: false });
      await forgetOffenders();
      written.push(id);
```

3e. After the loop, before the `return`:

```ts
    if (Object.keys(newEncHashes).length > 0) {
      recordModuleEncHashes(ctx.repoDir, os.hostname(), "dotfiles", newEncHashes);
    }
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run packages/core/src/modules/dotfiles.test.ts` then `npx vitest run packages/core` → all green (existing capture tests must still pass).
- [ ] **Step 5: Commit** — `git add packages/core/src/modules/dotfiles.ts packages/core/src/modules/dotfiles.test.ts && git commit -m "feat(core): dotfiles capture skips unchanged re-encryption; gates new large files (ADR-0021)"`

---

### Task 3: server — push lock, `largeItems`, exclude endpoint

**Files:** Modify `packages/cli/src/server.ts`; Test `packages/cli/src/server.test.ts` (append).

- [ ] **Step 1: Failing tests**

```ts
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
```

(`loadSelection` is already imported in the test file's `@roost/core` import; add it if not.)

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/cli/src/server.test.ts -t "ADR-0021"` → FAIL.

- [ ] **Step 3: Implement in `server.ts`:**

3a. Add `LARGE_FILE_MB` to the `@roost/core` import list (export it from `packages/core/src/index.ts` alongside the dotfiles module export — add that re-export in this task if Task 2's implementer didn't).

3b. `sourceToTarget` helper at module scope (after `setOrigin`):

```ts
// Map a repo-source-relative path to its absolute target path (subset of
// chezmoi's source-state naming — enough for display + forget).
export function sourceToTarget(rel: string, home: string): string {
  const ATTRS = ["encrypted_", "private_", "literal_", "executable_", "readonly_", "exact_", "empty_", "symlink_"];
  const segs = rel.split("/").map((seg) => {
    let s = seg;
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of ATTRS) {
        if (s.startsWith(a)) { s = s.slice(a.length); changed = true; }
      }
      if (s.startsWith("dot_")) { s = "." + s.slice(4); changed = true; }
    }
    return s;
  });
  let file = segs[segs.length - 1] ?? "";
  if (file.endsWith(".age")) file = file.slice(0, -4);
  if (file.endsWith(".tmpl")) file = file.slice(0, -5);
  segs[segs.length - 1] = file;
  return path.join(home, ...segs);
}
```

3c. Single-flight push lock inside `buildServer` (next to the autoBackup block); reroute both consumers:

```ts
  // Single-flight pushes (ADR-0021): the API route and the auto-backup scheduler
  // share this lock so two pushes never race for bandwidth.
  let pushInFlight = false;
  const guardedPush = async (): Promise<{ ok: boolean; output: string; hint?: "auth" | "pull-first" | "busy" }> => {
    if (pushInFlight) return { ok: false, output: "push already in progress", hint: "busy" };
    pushInFlight = true;
    try {
      return await runGitPush(makeCtx(false).exec, repoDir);
    } finally {
      pushInFlight = false;
    }
  };
```

Change the scheduler's `runPush` dep to `runPush: async () => { const r = await guardedPush(); return { ok: r.ok, hint: r.hint === "busy" ? undefined : r.hint }; }` (a busy auto-push just means a push is already happening — fine). Change the route body to `return reply.send(await guardedPush());` (keep `cache.invalidateAll()` first). NOTE: the scheduler is created BEFORE this lock today — move the `autoBackup` creation below `guardedPush` so it can close over it.

3d. Extend `GET /api/backup/status`:

```ts
  server.get("/api/backup/status", async (_req, reply) => {
    const s = loadRoostSettings(repoDir);
    const state = readState(repoDir, os.hostname());
    const home = os.homedir();
    const largeItems: { path: string; mb: number }[] = [];
    const SKIP = new Set([".git", "roost", "state"]);
    const walk = (dir: string, rel: string): void => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (rel === "" && SKIP.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        const r = rel === "" ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) walk(abs, r);
        else if (e.isFile()) {
          let size = 0;
          try { size = fs.statSync(abs).size; } catch { continue; }
          if (size > LARGE_FILE_MB * 1024 * 1024) {
            largeItems.push({ path: sourceToTarget(r, home), mb: Math.round(size / 1048576) });
          }
        }
      }
    };
    walk(repoDir, "");
    return reply.send({
      autoBackup: s.autoBackup,
      autoPush: s.autoPush,
      lastRun: autoBackup.lastRun(),
      lastCaptureAt: state?.capturedAt ?? null,
      largeItems,
    });
  });
```

3e. New endpoint (near `/api/selection/add`):

```ts
  // ── POST /api/dotfiles/exclude ───────────────────────────────────────────────
  // Stop backing up a path: forget it from the source repo and record it in the
  // sticky exclude list. NEVER touches the user's local file (ADR-0021).
  server.post<{ Body: { path?: string } }>("/api/dotfiles/exclude", async (req, reply) => {
    const p = req.body?.path?.trim();
    if (!p) return reply.status(400).send({ error: "path is required" });
    try {
      cache.invalidateAll();
      const ctx = makeCtx(false);
      const chezmoi = createChezmoi(ctx.exec, { sourceDir: repoDir });
      try { await chezmoi.forget(p); } catch { /* not managed → nothing to remove */ }
      let doc = loadSelection(repoDir);
      doc = addItem(doc, "dotfiles-exclude", p);
      saveSelection(repoDir, doc);
      await finalizeCapture(ctx.exec, repoDir, ctx.home);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
```

(`chezmoi.forget` runs `chezmoi --source <repo> forget <path>` — confirm the adapter's `forget` passes `--force`; if not, it prompts. Check `packages/core/src/adapters/chezmoi.ts:84` and ensure the args include `--force`; if missing, add it there with a one-line comment — headless server, Roost never deletes local files via forget.)

- [ ] **Step 4: Run, verify pass** — `npx vitest run packages/cli/src/server.test.ts` → all green (existing push tests included).
- [ ] **Step 5: Commit** — `git add packages/cli/src/server.ts packages/cli/src/server.test.ts packages/core/src/adapters/chezmoi.ts packages/core/src/index.ts && git commit -m "feat(server): push lock, stock large-file listing, dotfiles exclude endpoint"`

---

### Task 4: web — api types + i18n

**Files:** Modify `packages/web/src/api.ts`, `packages/web/src/i18n/strings.ts`.

- [ ] **Step 1: api.ts.** Widen `GitOpResult.hint` to `"auth" | "pull-first" | "busy"`. Extend `BackupStatus` with `largeItems: { path: string; mb: number }[]`. Add:

```ts
export function excludeDotfile(path: string): Promise<{ ok: boolean }> {
  return apiFetch("/api/dotfiles/exclude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}
```

- [ ] **Step 2: strings.ts** (append in the fresh/overview areas respectively):

```ts
  "fresh.ahead.busy": { en: "A push is already running — try again shortly.", zh: "已有推送在进行,稍候再试。" },
  "overview.blocked.large": { en: "large file", zh: "大文件" },
  "overview.blocked.keepLarge": { en: "Back up anyway", zh: "仍要备份" },
  "overview.blocked.excludeLarge": { en: "Stop backing up (keeps local file)", zh: "移出管理(不动本地文件)" },
  "overview.blocked.largeKept": { en: "Will be included next capture.", zh: "下次备份将包含它。" },
  "overview.blocked.largeExcluded": { en: "Excluded from backups — local file untouched.", zh: "已移出备份 —— 本地文件未受影响。" },
  "large.title": { en: "large file(s) in your backup, total", zh: "个大文件在备份中,共" },
  "large.expand": { en: "Show", zh: "展开" },
  "large.collapse": { en: "Hide", zh: "收起" },
  "large.remove": { en: "Stop backing up (keeps local file)", zh: "移出备份(不影响本地文件)" },
  "large.removed": { en: "Removed from backups — local file untouched.", zh: "已移出备份 —— 本地文件未受影响。" },
```

- [ ] **Step 3: Verify + commit** — `pnpm --filter @roost/web build` → PASS. `git add packages/web/src/api.ts packages/web/src/i18n/strings.ts && git commit -m "feat(web): hygiene api types + strings"`

---

### Task 5: web — blocked-"large" actions + `LargeFilesAdvisory` + busy hint

**Files:** Create `packages/web/src/components/LargeFilesAdvisory.tsx`; Modify `packages/web/src/views/Overview.tsx`, `packages/web/src/components/FreshnessBanners.tsx`; Tests `packages/web/src/LargeFilesAdvisory.test.tsx` + append to `Overview.test.tsx` and `FreshnessBanners.test.tsx`.

- [ ] **Step 1: Failing tests.**

`packages/web/src/LargeFilesAdvisory.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LargeFilesAdvisory } from "./components/LargeFilesAdvisory";
import * as api from "./api";

vi.mock("./api", () => ({ excludeDotfile: vi.fn().mockResolvedValue({ ok: true }) }));
const t = (k: string) => k;

describe("LargeFilesAdvisory", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders nothing when there are no large items", () => {
    const { container } = render(<LargeFilesAdvisory t={t} items={[]} onChanged={() => {}} />);
    expect(container.textContent).toBe("");
  });
  it("expands to list items and excludes one (repo-side only)", async () => {
    const onChanged = vi.fn();
    render(<LargeFilesAdvisory t={t} items={[{ path: "/u/.config/big.bin", mb: 25 }]} onChanged={onChanged} />);
    screen.getByRole("button", { name: "large.expand" }).click();
    expect(await screen.findByText(/big\.bin/)).toBeInTheDocument();
    screen.getByRole("button", { name: "large.remove" }).click();
    await waitFor(() => expect(api.excludeDotfile).toHaveBeenCalledWith("/u/.config/big.bin"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
```

Append to `Overview.test.tsx` (mock factory: add `excludeDotfile: vi.fn().mockResolvedValue({ ok: true })`, and give `getBackupStatus` mock `largeItems: []`):

```tsx
  it("blocked 'large' item offers keep + exclude actions", async () => {
    vi.mocked(api.postCapture).mockResolvedValueOnce({
      changes: [{ module: "dotfiles", written: [], encrypted: [], blocked: ["/u/.x/huge.bin"], blockedDetail: [{ id: "/u/.x/huge.bin", reason: "large", detail: "11MB" }] }],
    });
    await act(async () => { render(<Overview showHud={noop} />); });
    const captureBtn = await screen.findByRole("button", { name: /Capture/i });
    await act(async () => { fireEvent.click(captureBtn); });
    expect(await screen.findByRole("button", { name: /Back up anyway|仍要备份/ })).toBeInTheDocument();
    const exclude = screen.getByRole("button", { name: /Stop backing up|移出管理/ });
    await act(async () => { fireEvent.click(exclude); });
    await waitFor(() => expect(api.excludeDotfile).toHaveBeenCalledWith("/u/.x/huge.bin"));
  });
```

Append to `FreshnessBanners.test.tsx`:

```tsx
  it("busy push shows the busy hint", async () => {
    vi.mocked(api.gitPush).mockResolvedValueOnce({ ok: false, output: "push already in progress", hint: "busy" });
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ ahead: 1 })} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    screen.getByRole("button", { name: "fresh.ahead.push" }).click();
    expect(await screen.findByText("fresh.ahead.busy")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- "LargeFilesAdvisory|Overview|FreshnessBanners"` → new tests FAIL.

- [ ] **Step 3: Implement.**

3a. `LargeFilesAdvisory.tsx`:

```tsx
import { useState } from "react";
import { Files } from "@phosphor-icons/react";
import { excludeDotfile } from "../api";

const banner: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", background: "var(--surface)", border: "1px solid #4a3a1e", borderRadius: "var(--rc)", marginBottom: 14, fontSize: 13.5 };
const ghost: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12, padding: "3px 10px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" };

export function LargeFilesAdvisory({ t, items, onChanged }: {
  t: (k: string) => string;
  items: { path: string; mb: number }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  if (items.length === 0) return null;
  const total = items.reduce((n, i) => n + i.mb, 0);

  const exclude = async (p: string) => {
    setBusyPath(p);
    try { await excludeDotfile(p); onChanged(); } catch { /* stays listed; Hud handled upstream if desired */ }
    finally { setBusyPath(null); }
  };

  return (
    <div style={banner} role="status">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Files size={15} style={{ color: "var(--amber)", flexShrink: 0 }} />
        <span>{items.length} {t("large.title")} {total} MB</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setOpen(!open)} style={ghost}>{open ? t("large.collapse") : t("large.expand")}</button>
      </div>
      {open && items.map((i) => (
        <div key={i.path} style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 6, borderTop: "1px solid var(--border-soft)" }}>
          <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 12.5 }}>{i.path}</span>
          <span style={{ color: "var(--muted)", fontSize: 12.5, flexShrink: 0 }}>{i.mb} MB</span>
          <button onClick={() => void exclude(i.path)} disabled={busyPath !== null} style={{ ...ghost, color: "var(--accent)" }}>
            {busyPath === i.path ? "…" : t("large.remove")}
          </button>
        </div>
      ))}
    </div>
  );
}
```

3b. `Overview.tsx`: import `LargeFilesAdvisory` + `excludeDotfile` + `addSelection` (already imported). Render below `<FreshnessBanners …/>`:

```tsx
      <LargeFilesAdvisory t={t} items={backupStatus?.largeItems ?? []} onChanged={() => void fetchData()} />
```

In the blocked-item map: extend `reasonLabel` with `: item.reason === "large" ? t("overview.blocked.large")`, and add the action block alongside the existing secret/too-large buttons:

```tsx
                {item.reason === "large" && (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button
                      onClick={() => {
                        void addSelection("dotfiles-large-ok", item.id).then(() => {
                          setBlockedDetail((d) => d.filter((b) => b.id !== item.id));
                          showHud?.({ text: t("overview.blocked.largeKept"), type: "success" });
                        });
                      }}
                      style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 9px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      {t("overview.blocked.keepLarge")}
                    </button>
                    <button
                      onClick={() => {
                        void excludeDotfile(item.id).then(() => {
                          setBlockedDetail((d) => d.filter((b) => b.id !== item.id));
                          showHud?.({ text: t("overview.blocked.largeExcluded"), type: "success" });
                        });
                      }}
                      style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 9px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      {t("overview.blocked.excludeLarge")}
                    </button>
                  </span>
                )}
```

3c. `FreshnessBanners.tsx`: in `push()`'s failure mapping add `: hint === "busy" ? "fresh.ahead.busy"` before the fallback.

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test` → all green.
- [ ] **Step 5: Commit** — `git add packages/web/src/components/LargeFilesAdvisory.tsx packages/web/src/LargeFilesAdvisory.test.tsx packages/web/src/views/Overview.tsx packages/web/src/Overview.test.tsx packages/web/src/components/FreshnessBanners.tsx packages/web/src/FreshnessBanners.test.tsx && git commit -m "feat(web): large-file blocked actions + stock advisory + busy push hint"`

---

### Task 6: Full verification (controller-run)

- `pnpm -r build` · `pnpm lint` · `pnpm test` · `pnpm --filter @roost/web test` · `pnpm build:sidecar` — all green.
- Live churn test on the real repo: two back-to-back captures; the second must produce **no new commit** (`git -C ~/.local/share/chezmoi log --oneline -3` unchanged, no new `.age` blobs).
- Then the operational task D (bundle backup → squash history → force push) per the spec.

---

## Self-Review

**1. Spec coverage:** A → T1 (storage) + T2 (skip logic); B → T3 (lock, both consumers); C gate-new → T2 (block/forget/allowlist/exclude) + actions T5; C advise-stock → T3 (`largeItems`) + T5 (advisory); endpoint → T3; busy hint → T3+T4+T5; invariant (never touch local files) → asserted in T2 tests (`fs.existsSync` after forget) and stated in all UI copy (T4 strings); D + live churn test → T6.
**2. Placeholder scan:** none — every step has complete code; the two "check the harness/adapter" notes are concrete verifications against existing files (dotfiles.test.ts harness names; chezmoi `forget --force`), not deferred work.
**3. Type consistency:** `LARGE_FILE_MB` defined T2, re-exported + consumed T3; `BlockReason "large"` T1 → produced T2 → rendered T5; `encHashes` helpers T1 → consumed T2; `hint "busy"` produced T3 → typed T4 → rendered T5; `largeItems {path,mb}` produced T3 → typed T4 → consumed T5; `excludeDotfile` T4 → used T5; selection keys `dotfiles-exclude`/`dotfiles-large-ok` consistent across T2/T3/T5.
