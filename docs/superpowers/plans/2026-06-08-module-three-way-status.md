# Module Three-Way Status — Implementation Plan (Plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make modules emit three-way hashes (`localHash`/`repoHash`/`baselineHash`) on their `status()` items so `computeSyncState` (Plan 1) can auto-resolve Behind items instead of surfacing every difference as a decision. Plan 2 covers the shared helper + the two clean file-content modules (**appconfig**, **env**). Bespoke modules (dotfiles/packages/projects/skills) keep Plan 1's *safe legacy fallback* and get three-way in a later Plan 2b.

**Architecture:** A new pure-ish helper (`sync-baseline.ts`) provides `hashContent` (sha256) and `loadModuleBaseline` (this machine's persisted baseline bag via `readState`/`readBaseline`). Each upgraded `status()` loads its baseline once, then sets the three hashes per item. The legacy `state` field is preserved (back-compat). No apply/baseline-write yet — that is Plan 4.

**Tech Stack:** TypeScript strict, vitest, node:crypto. Run a test file: `npx vitest run <path>`. Branch `feat_sync_state`. Do not push.

---

### Task 1: `sync-baseline.ts` — hashContent + loadModuleBaseline

**Files:**
- Create: `packages/core/src/sync-baseline.ts`
- Create: `packages/core/src/sync-baseline.test.ts`

- [ ] **Step 1: Failing test** — create `packages/core/src/sync-baseline.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { hashContent, loadModuleBaseline } from "./sync-baseline.js";
import { writeState, stateDir } from "./state.js";

describe("hashContent", () => {
  it("null in → null out", () => {
    expect(hashContent(null)).toBeNull();
  });
  it("is deterministic and content-sensitive", () => {
    expect(hashContent("a")).toBe(hashContent("a"));
    expect(hashContent("a")).not.toBe(hashContent("b"));
    expect(hashContent("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("loadModuleBaseline", () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-bl-")); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("returns {} when no state file exists", () => {
    expect(loadModuleBaseline(tmp, "appconfig")).toEqual({});
  });
  it("returns the module's baseline bag when present", () => {
    writeState(tmp, {
      host: os.hostname(),
      schemaVersion: 2,
      capturedAt: null,
      modules: { appconfig: { baseline: { "domain:x": "h1" } } },
    });
    expect(loadModuleBaseline(tmp, "appconfig")).toEqual({ "domain:x": "h1" });
  });
  it("returns {} (no throw) on a malformed state file", () => {
    const dir = stateDir(tmp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${os.hostname()}.json`), "{not json", "utf8");
    expect(loadModuleBaseline(tmp, "appconfig")).toEqual({});
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/core/src/sync-baseline.test.ts` → cannot find `./sync-baseline.js`.

- [ ] **Step 3: Implement** — create `packages/core/src/sync-baseline.ts`:

```typescript
// Helpers for modules to emit three-way hashes (ADR-0016/0017). Hashing is pure;
// baseline loading reads this machine's persisted state.
import { createHash } from "node:crypto";
import * as os from "node:os";
import { readState, readBaseline } from "./state.js";
import type { ModuleBaseline } from "./state.js";

export function hashContent(content: string | null): string | null {
  if (content === null) return null;
  return createHash("sha256").update(content).digest("hex");
}

// This machine's persisted baseline bag for a module (empty if none / unreadable).
export function loadModuleBaseline(repoDir: string, moduleName: string): ModuleBaseline {
  try {
    const st = readState(repoDir, os.hostname());
    return st ? readBaseline(st, moduleName) : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run packages/core/src/sync-baseline.test.ts`.

- [ ] **Step 5: Commit** — `git add packages/core/src/sync-baseline.ts packages/core/src/sync-baseline.test.ts && git commit -m "feat(core): sync-baseline helper — hashContent + loadModuleBaseline (ADR-0016)"`

---

### Task 2: appconfig three-way status

**Files:**
- Modify: `packages/core/src/modules/appconfig.ts:170-194`
- Modify: `packages/core/src/modules/appconfig.test.ts`

- [ ] **Step 1: Failing test** — append to `packages/core/src/modules/appconfig.test.ts` a test asserting three-way fields. Find the existing `makeCtx`/`makeFakeExec` helpers in that file and reuse them. Add:

```typescript
import { hashContent } from "../sync-baseline.js";

describe("appconfig status three-way", () => {
  it("sets repoHash from the stored plist and localHash from defaults export", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ac-"));
    try {
      // stored plist in repo
      const repoPlist = "<plist>STORED</plist>";
      const dir = path.join(tmp, "roost", "appconfig");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "com.example.app.plist"), repoPlist, "utf8");
      // live defaults export returns something different
      const exec = { async run() { return { code: 0, stdout: "<plist>LIVE</plist>", stderr: "" }; } };
      const ctx = { repoDir: tmp, home: tmp, profile: "base", dryRun: true, exec,
        log: { info() {}, warn() {}, error() {} }, t: (k: string) => k } as never;
      const sel = { modules: { appconfig: ["domain:com.example.app"] } };
      const report = await appconfigModule.status(ctx, sel);
      const item = report.items[0]!;
      expect(item.repoHash).toBe(hashContent(repoPlist));
      expect(item.localHash).toBe(hashContent("<plist>LIVE</plist>"));
      expect(item.baselineHash).toBeNull();
      expect(item.state).toBe("drift");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

> NOTE: match the actual `plistPath`/`stripPrefix` layout — the stored file path is `plistPath(ctx.repoDir, domain)`. If the existing test file already imports `appconfigModule`, `fs`, `path`, `os`, do not re-import.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/core/src/modules/appconfig.test.ts` (new test fails: `repoHash` undefined).

- [ ] **Step 3: Implement** — in `packages/core/src/modules/appconfig.ts`, replace the `status` body (lines 170-194) with:

```typescript
  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const ids = sel.modules["appconfig"] ?? [];
    const items: DriftReport["items"] = [];
    const baseline = loadModuleBaseline(ctx.repoDir, "appconfig");

    for (const id of ids) {
      const domain = stripPrefix(id);
      const storedFile = plistPath(ctx.repoDir, domain);
      const stored = fs.existsSync(storedFile) ? fs.readFileSync(storedFile, "utf8") : null;
      const r = await ctx.exec.run("defaults", ["export", domain, "-"]);
      const current = r.code === 0 ? r.stdout : null;
      const synced = stored !== null && stored === current;
      items.push({
        id,
        state: stored === null ? "drift" : synced ? "synced" : "drift",
        detail: stored === null ? "not captured yet" : undefined,
        localHash: hashContent(current),
        repoHash: hashContent(stored),
        baselineHash: baseline[id] ?? null,
      });
    }

    return { module: "appconfig", items };
  },
```

Add the import near the top of the file (with the other `../` imports):

```typescript
import { hashContent, loadModuleBaseline } from "../sync-baseline.js";
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run packages/core/src/modules/appconfig.test.ts` (all, including pre-existing).

- [ ] **Step 5: Commit** — `git add packages/core/src/modules/appconfig.ts packages/core/src/modules/appconfig.test.ts && git commit -m "feat(core): appconfig three-way status hashes (ADR-0017)"`

---

### Task 3: env (env.sh) three-way status

**Files:**
- Modify: `packages/core/src/modules/env.ts:518-545`
- Modify: `packages/core/src/modules/env.test.ts`

- [ ] **Step 1: Failing test** — append to `packages/core/src/modules/env.test.ts` (reuse its helpers; it already manipulates a temp repo + home). Add:

```typescript
import { hashContent } from "../sync-baseline.js";

describe("env status three-way (env.sh)", () => {
  it("sets repoHash from the generated preview and localHash from the live env.sh", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-env3-"));
    try {
      // minimal env.yaml in repo
      const roostDir = path.join(tmp, "roost");
      fs.mkdirSync(roostDir, { recursive: true });
      fs.writeFileSync(
        path.join(roostDir, "env.yaml"),
        "schemaVersion: 1\naliases: []\nenv: []\npath: []\nfunctions: []\n",
        "utf8",
      );
      const ctx = { repoDir: tmp, home: tmp, profile: "base", dryRun: true,
        exec: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
        log: { info() {}, warn() {}, error() {} }, t: (k: string) => k } as never;
      const report = await envModule.status(ctx, { modules: {} });
      const envItem = report.items.find((i) => i.id === "env.sh")!;
      // no live env.sh yet → untracked, localHash null, repoHash set
      expect(envItem.state).toBe("untracked");
      expect(envItem.localHash).toBeNull();
      expect(envItem.repoHash).not.toBeNull();
      expect(envItem.baselineHash).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

> NOTE: if `env.test.ts` already imports `envModule`, `fs`, `path`, `os`, do not re-import. The exact env.yaml shape must satisfy `loadEnvData`; mirror an existing env test fixture in that file if this minimal one fails to parse.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/core/src/modules/env.test.ts` (new test fails: `repoHash` undefined / `localHash` undefined).

- [ ] **Step 3: Implement** — in `packages/core/src/modules/env.ts`, replace the env.sh portion of `status` (lines 522-530) with:

```typescript
    // Compare the non-secret preview against the live artifact (three-way: ADR-0017).
    const baseline = loadModuleBaseline(ctx.repoDir, "env");
    const preview = generateEnvSh(data);
    const livePath = envShPath(ctx.home);
    const live = fs.existsSync(livePath) ? readFileSafe(livePath) : null;
    const envHashes = {
      localHash: hashContent(live),
      repoHash: hashContent(preview),
      baselineHash: baseline["env.sh"] ?? null,
    };
    if (live === null) {
      items.push({ id: "env.sh", state: "untracked", detail: "env.sh not generated yet", ...envHashes });
    } else {
      items.push({ id: "env.sh", state: live === preview ? "synced" : "drift", ...envHashes });
    }
```

Add the import near the top of the file (with the other `../` imports):

```typescript
import { hashContent, loadModuleBaseline } from "../sync-baseline.js";
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run packages/core/src/modules/env.test.ts` (all).

- [ ] **Step 5: Commit** — `git add packages/core/src/modules/env.ts packages/core/src/modules/env.test.ts && git commit -m "feat(core): env env.sh three-way status hashes (ADR-0017)"`

---

### Task 4: Verification gate

- [ ] **Step 1: Full core suite** — `npx vitest run packages/core` → all pass.
- [ ] **Step 2: Build** — `pnpm --filter @roost/core build` → pass.
- [ ] **Step 3: Lint** — `pnpm lint` → clean.

---

## Self-Review

- **Spec coverage (Plan 2 scope):** §7.1 per-module `status` three-way → Tasks 2-3 (appconfig, env); shared hashing/baseline infra → Task 1. dotfiles coarse (§7.3) + packages/projects/skills bespoke three-way → deferred to Plan 2b (documented; legacy fallback keeps them safe meanwhile).
- **Placeholder scan:** none — all code shown. The two `NOTE`s are implementer guidance to reuse existing test helpers, not missing code.
- **Type consistency:** `hashContent`/`loadModuleBaseline` defined in Task 1, imported in Tasks 2-3; `ModuleBaseline`/`readState`/`readBaseline` from Plan 1's `state.ts`; `DriftItem.localHash/repoHash/baselineHash` from Plan 1 Task 1. Consistent.
