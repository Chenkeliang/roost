# Sync-State Foundation (core) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, well-tested foundation of the sync-state model in `@roost/core`: the additive contract fields, the three-way direction + exception classifier, the extended `MachineState` (baseline + lastSyncedCommit + lastSeen), and the `syncStateAll` orchestration wrapper.

**Architecture:** A machine's position relative to the repo is derived from a three-way comparison (local vs repo vs per-item baseline). Classification is module-agnostic pure logic living in `packages/core/src/sync-state.ts`; modules only emit hashes (later plan). Baseline + sync metadata persist in the existing `state/{host}.json` (`MachineState`), schema bumped to v2 (back-compatible read).

**Tech Stack:** TypeScript (strict), vitest, pnpm monorepo. Tests are co-located `*.test.ts`. Run a single package: `pnpm --filter @roost/core test`. Build a package: `pnpm --filter @roost/shared build`.

**Branch:** `feat_sync_state` (already cut from `origin/main`). Do not push.

---

## Roadmap (this plan = Plan 1 of 5)

Each plan produces working, testable software on its own.

1. **Plan 1 — sync-state foundation (core)** ← *this document*. Contract fields, pure classifier, MachineState v2, `syncStateAll`. No UI, no module changes.
2. **Plan 2 — module three-way status.** Each module's `status()` emits `localHash/repoHash/baselineHash` (+ dotfiles coarse compromise, §7.3). Per-module unit/dry-run/idempotency tests.
3. **Plan 3 — onboarding (cli).** `roost clone`, doctor preflight hard-gate, age-key import guidance, push-safety wiring into capture.
4. **Plan 4 — resolution engine (core+cli).** Auto-managed/exception split in `loadAll`, generic `POST /api/resolve` (generalising skills), "remember decisions".
5. **Plan 5 — review surface (web).** `Drift` → sync-state review (grouped overview), `SyncPolicyBar` (基调), `ConflictItem` (two-column + default-anchored-right + typed exceptions).

---

## File Structure (Plan 1)

- Modify: `packages/shared/src/types.ts` — add `Direction`, `SyncException`; extend `DriftItem` with optional three-way fields (ADR-0017).
- Create: `packages/core/src/sync-state.ts` — pure classifier + aggregation + push-safety (ADR-0016).
- Create: `packages/core/src/sync-state.test.ts` — its tests.
- Modify: `packages/core/src/state.ts` — extend `MachineState` to v2 + baseline accessors (ADR-0018).
- Modify: `packages/core/src/state.test.ts` — v2 + back-compat + accessor tests.
- Modify: `packages/core/src/orchestrate.ts` — add `syncStateAll`.
- Modify: `packages/core/src/orchestrate.test.ts` — `syncStateAll` test.

---

### Task 1: Extend the DriftItem contract (additive) — `@roost/shared`

**Files:**
- Modify: `packages/shared/src/types.ts:31-33`

- [ ] **Step 1: Add the new types and extend `DriftItem`**

Replace lines 31-33 (the `DriftState` / `DriftItem` / `DriftReport` block) with:

```typescript
export type DriftState = "synced" | "drift" | "conflict" | "untracked";

// Sync-state model (ADR-0016 / ADR-0017). All fields optional + additive:
// modules that have not been upgraded keep returning { id, state } and the
// classifier falls back to a safe legacy mapping.
export type Direction = "synced" | "ahead" | "behind" | "diverged";
export type SyncException = "diverged" | "blocked" | "destructive";
export interface DriftItem {
  id: string;
  state: DriftState;
  detail?: string;
  // null = absent on that side; undefined = module did not report a hash.
  localHash?: string | null;
  repoHash?: string | null;
  baselineHash?: string | null;
  direction?: Direction;
  exception?: SyncException;
  blocked?: boolean; // a prerequisite is missing (age key / tool / decrypt)
}
export interface DriftReport { module: string; items: DriftItem[]; }
```

- [ ] **Step 2: Build shared, verify it compiles**

Run: `pnpm --filter @roost/shared build`
Expected: PASS (no type errors). This is a purely additive change; existing consumers reading only `{ id, state }` are unaffected.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): additive sync-state fields on DriftItem (ADR-0017)"
```

---

### Task 2: `classifyDirection` — three-way → direction

**Files:**
- Create: `packages/core/src/sync-state.ts`
- Create: `packages/core/src/sync-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/sync-state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyDirection } from "./sync-state.js";
import type { ThreeWay } from "./sync-state.js";

const tw = (local: string | null, repo: string | null, baseline: string | null): ThreeWay => ({
  localHash: local,
  repoHash: repo,
  baselineHash: baseline,
});

describe("classifyDirection", () => {
  it("synced when local equals repo (regardless of baseline)", () => {
    expect(classifyDirection(tw("a", "a", "a"))).toBe("synced");
    expect(classifyDirection(tw("a", "a", null))).toBe("synced");
    expect(classifyDirection(tw(null, null, "a"))).toBe("synced");
  });
  it("ahead when only local changed", () => {
    expect(classifyDirection(tw("b", "a", "a"))).toBe("ahead");
    expect(classifyDirection(tw("a", null, null))).toBe("ahead"); // locally new
  });
  it("behind when only repo changed", () => {
    expect(classifyDirection(tw("a", "b", "a"))).toBe("behind");
    expect(classifyDirection(tw(null, "a", null))).toBe("behind"); // fresh machine
  });
  it("diverged when both changed", () => {
    expect(classifyDirection(tw("b", "c", "a"))).toBe("diverged");
    expect(classifyDirection(tw("b", "c", null))).toBe("diverged");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roost/core test -- sync-state`
Expected: FAIL — cannot find module `./sync-state.js` / `classifyDirection` is not a function.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/sync-state.ts`:

```typescript
// Sync-state model (ADR-0016): a machine's position relative to the repo is
// DERIVED from a three-way compare. Pure, module-agnostic logic — no I/O here.
import type { Direction } from "@roost/shared";

export interface ThreeWay {
  localHash: string | null; // null = absent locally
  repoHash: string | null; // null = absent in repo
  baselineHash: string | null; // null = never synced this item
}

export function classifyDirection(t: ThreeWay): Direction {
  // Already aligned — nothing to do, even without a baseline.
  if (t.localHash === t.repoHash) return "synced";
  const localChanged = t.localHash !== t.baselineHash;
  const repoChanged = t.repoHash !== t.baselineHash;
  if (localChanged && repoChanged) return "diverged";
  if (localChanged) return "ahead";
  if (repoChanged) return "behind";
  return "synced"; // unreachable given local !== repo
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roost/core test -- sync-state`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync-state.ts packages/core/src/sync-state.test.ts
git commit -m "feat(core): classifyDirection three-way classifier (ADR-0016)"
```

---

### Task 3: `classifyException` — which items need a human

**Files:**
- Modify: `packages/core/src/sync-state.ts`
- Modify: `packages/core/src/sync-state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/sync-state.test.ts`:

```typescript
import { classifyException } from "./sync-state.js";
import type { ItemSignal } from "./sync-state.js";

const sig = (three: ThreeWay, blocked = false): ItemSignal => ({ three, blocked });

describe("classifyException", () => {
  it("blocked wins over everything", () => {
    expect(classifyException(sig(tw("a", "b", "a"), true))).toBe("blocked");
  });
  it("destructive when repo deleted a managed item still present locally", () => {
    expect(classifyException(sig(tw("a", null, "a")))).toBe("destructive");
  });
  it("diverged when both changed", () => {
    expect(classifyException(sig(tw("b", "c", "a")))).toBe("diverged");
  });
  it("null (auto-resolvable) for behind / ahead / synced", () => {
    expect(classifyException(sig(tw(null, "a", null)))).toBeNull(); // behind
    expect(classifyException(sig(tw("b", "a", "a")))).toBeNull(); // ahead
    expect(classifyException(sig(tw("a", "a", "a")))).toBeNull(); // synced
  });
  it("locally-new absent-in-repo is NOT destructive (it is ahead)", () => {
    expect(classifyException(sig(tw("a", null, null)))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roost/core test -- sync-state`
Expected: FAIL — `classifyException` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/sync-state.ts`:

```typescript
import type { SyncException } from "@roost/shared";

export interface ItemSignal {
  three: ThreeWay;
  blocked?: boolean; // prerequisite missing (age key / tool / decrypt failure)
}

// Returns the exception class that REQUIRES a human, or null if the item can be
// auto-resolved (synced/behind/ahead). Order matters: blocked > destructive > diverged.
export function classifyException(sig: ItemSignal): SyncException | null {
  if (sig.blocked) return "blocked";
  const { localHash, repoHash, baselineHash } = sig.three;
  // Repo removed an item we have AND used to track → deleting local content.
  if (repoHash === null && localHash !== null && baselineHash !== null) {
    return "destructive";
  }
  if (classifyDirection(sig.three) === "diverged") return "diverged";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roost/core test -- sync-state`
Expected: PASS (all sync-state tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync-state.ts packages/core/src/sync-state.test.ts
git commit -m "feat(core): classifyException — diverged/blocked/destructive (ADR-0016)"
```

---

### Task 4: `computeSyncState` — aggregate reports into a review model

**Files:**
- Modify: `packages/core/src/sync-state.ts`
- Modify: `packages/core/src/sync-state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/sync-state.test.ts`:

```typescript
import { computeSyncState } from "./sync-state.js";
import type { DriftReport } from "@roost/shared";

describe("computeSyncState", () => {
  it("classifies items from hashes and tallies counts", () => {
    const reports: DriftReport[] = [
      {
        module: "dotfiles",
        items: [
          { id: "synced.txt", state: "synced", localHash: "a", repoHash: "a", baselineHash: "a" },
          { id: "behind.txt", state: "drift", localHash: null, repoHash: "x", baselineHash: null },
          { id: "div.txt", state: "conflict", localHash: "b", repoHash: "c", baselineHash: "a" },
        ],
      },
      {
        module: "env",
        items: [
          { id: "EDITOR", state: "drift", localHash: "v", repoHash: null, baselineHash: "v", blocked: false },
        ],
      },
    ];
    const out = computeSyncState(reports);
    expect(out.items).toHaveLength(4);
    expect(out.counts).toEqual({ synced: 1, auto: 1, diverged: 1, blocked: 0, destructive: 1 });
    expect(out.overall).toBe("diverged");
    const div = out.items.find((i) => i.id === "div.txt");
    expect(div).toMatchObject({ module: "dotfiles", direction: "diverged", exception: "diverged" });
    const del = out.items.find((i) => i.id === "EDITOR");
    expect(del).toMatchObject({ direction: "behind", exception: "destructive" });
  });

  it("legacy fallback: items without hashes map state safely (differences need a decision)", () => {
    const reports: DriftReport[] = [
      { module: "m", items: [
        { id: "a", state: "synced" },
        { id: "b", state: "untracked" },
        { id: "c", state: "drift" },
        { id: "d", state: "conflict" },
      ] },
    ];
    const out = computeSyncState(reports);
    expect(out.items.find((i) => i.id === "a")!.direction).toBe("synced");
    expect(out.items.find((i) => i.id === "b")!.direction).toBe("behind");
    // drift/conflict with no hashes → surface as a decision, never silent
    expect(out.items.find((i) => i.id === "c")!.exception).toBe("diverged");
    expect(out.items.find((i) => i.id === "d")!.exception).toBe("diverged");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roost/core test -- sync-state`
Expected: FAIL — `computeSyncState` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/sync-state.ts`:

```typescript
import type { DriftReport, DriftItem } from "@roost/shared";

export interface SyncItem {
  module: string;
  id: string;
  direction: Direction;
  exception: SyncException | null;
  detail?: string;
}
export interface SyncCounts {
  synced: number;
  auto: number; // behind/ahead, no exception → handled automatically
  diverged: number;
  blocked: number;
  destructive: number;
}
export interface SyncStateReport {
  items: SyncItem[];
  counts: SyncCounts;
  overall: Direction;
}

function hasHashes(item: DriftItem): boolean {
  return (
    item.localHash !== undefined ||
    item.repoHash !== undefined ||
    item.baselineHash !== undefined
  );
}

function legacy(item: DriftItem): { direction: Direction; exception: SyncException | null } {
  switch (item.state) {
    case "synced":
      return { direction: "synced", exception: null };
    case "untracked":
      return { direction: "behind", exception: null };
    case "drift":
    case "conflict":
    default:
      // No three-way info: cannot prove which side changed → require a decision.
      return { direction: "diverged", exception: "diverged" };
  }
}

export function computeSyncState(reports: DriftReport[]): SyncStateReport {
  const items: SyncItem[] = [];
  const counts: SyncCounts = { synced: 0, auto: 0, diverged: 0, blocked: 0, destructive: 0 };

  for (const report of reports) {
    for (const item of report.items) {
      let direction: Direction;
      let exception: SyncException | null;
      if (hasHashes(item)) {
        const three: ThreeWay = {
          localHash: item.localHash ?? null,
          repoHash: item.repoHash ?? null,
          baselineHash: item.baselineHash ?? null,
        };
        direction = classifyDirection(three);
        exception = classifyException({ three, blocked: item.blocked });
      } else {
        const l = legacy(item);
        direction = l.direction;
        exception = l.exception;
      }
      items.push({ module: report.module, id: item.id, direction, exception, detail: item.detail });
      if (exception === "blocked") counts.blocked++;
      else if (exception === "destructive") counts.destructive++;
      else if (exception === "diverged") counts.diverged++;
      else if (direction === "synced") counts.synced++;
      else counts.auto++;
    }
  }

  const overall: Direction =
    counts.diverged > 0 || counts.blocked > 0 || counts.destructive > 0
      ? "diverged"
      : counts.auto > 0
        ? "behind"
        : "synced";

  return { items, counts, overall };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roost/core test -- sync-state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync-state.ts packages/core/src/sync-state.test.ts
git commit -m "feat(core): computeSyncState aggregation + legacy fallback (ADR-0016)"
```

---

### Task 5: `classifyPushSafety` — detect "another machine pushed"

**Files:**
- Modify: `packages/core/src/sync-state.ts`
- Modify: `packages/core/src/sync-state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/sync-state.test.ts`:

```typescript
import { classifyPushSafety } from "./sync-state.js";

describe("classifyPushSafety", () => {
  it("ok when remote head matches what we last synced", () => {
    expect(classifyPushSafety("abc123", "abc123")).toBe("ok");
  });
  it("ok when this machine has no recorded sync yet (first push)", () => {
    expect(classifyPushSafety(undefined, "abc123")).toBe("ok");
  });
  it("pull-first when remote advanced past our last sync", () => {
    expect(classifyPushSafety("abc123", "def456")).toBe("pull-first");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roost/core test -- sync-state`
Expected: FAIL — `classifyPushSafety` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/sync-state.ts`:

```typescript
export type PushSafety = "ok" | "pull-first";

// Pure decision: given the remote HEAD this machine recorded at its last sync
// and the remote HEAD now, decide whether a capture push is safe. A different
// current head means another machine pushed since — pull/merge first.
export function classifyPushSafety(
  recordedRemoteHead: string | undefined,
  currentRemoteHead: string,
): PushSafety {
  if (!recordedRemoteHead) return "ok"; // never synced from here yet
  return recordedRemoteHead === currentRemoteHead ? "ok" : "pull-first";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roost/core test -- sync-state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync-state.ts packages/core/src/sync-state.test.ts
git commit -m "feat(core): classifyPushSafety guard (ADR-0016)"
```

---

### Task 6: Extend `MachineState` to v2 — baseline + sync metadata

**Files:**
- Modify: `packages/core/src/state.ts:5-12,18-22`
- Modify: `packages/core/src/state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/state.test.ts` (inside the file, after existing imports add `readBaseline, writeBaseline` to the import list from `./state.js`; if your editor cannot merge, add a new import line):

```typescript
import { readBaseline, writeBaseline } from "./state.js";

describe("MachineState v2 baseline", () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-state-")); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("STATE_SCHEMA_VERSION is 2", () => {
    expect(STATE_SCHEMA_VERSION).toBe(2);
  });

  it("reads a v1 state file tolerantly (new fields default)", () => {
    const dir = stateDir(tmp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "old.json"),
      JSON.stringify({ host: "old", schemaVersion: 1, capturedAt: null, modules: {} }),
      "utf8",
    );
    const s = readState(tmp, "old");
    expect(s).not.toBeNull();
    expect(s!.lastSyncedCommit).toBeUndefined();
    expect(readBaseline(s!, "dotfiles")).toEqual({});
  });

  it("writeBaseline + readBaseline round-trips per module", () => {
    const s = { host: "h", schemaVersion: STATE_SCHEMA_VERSION, capturedAt: null, modules: {} };
    const next = writeBaseline(s, "env", { EDITOR: "hash1", PAGER: "hash2" });
    expect(readBaseline(next, "env")).toEqual({ EDITOR: "hash1", PAGER: "hash2" });
    expect(readBaseline(next, "dotfiles")).toEqual({}); // untouched module
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roost/core test -- state`
Expected: FAIL — `STATE_SCHEMA_VERSION` is 1; `readBaseline`/`writeBaseline` not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/state.ts`, change line 5:

```typescript
export const STATE_SCHEMA_VERSION = 2;
```

Replace the `MachineState` interface (lines 7-12) with:

```typescript
// Per-module baseline bag: { itemId -> contentHash } at last successful sync.
export type ModuleBaseline = Record<string, string>;

export interface MachineState {
  host: string;
  schemaVersion: number;
  capturedAt: string | null;
  // v2 (ADR-0018) — all optional so v1 files read cleanly:
  lastSeen?: string;
  lastSyncedCommit?: string;
  // modules holds, per module name, an object that MAY carry { baseline }.
  modules: Record<string, unknown>;
}
```

Add these accessors at the end of the file (after `commitRepo`):

```typescript
// Read a module's baseline bag from a MachineState, tolerating missing/legacy shapes.
export function readBaseline(state: MachineState, moduleName: string): ModuleBaseline {
  const entry = state.modules[moduleName];
  if (entry && typeof entry === "object" && "baseline" in entry) {
    const b = (entry as { baseline?: unknown }).baseline;
    if (b && typeof b === "object") return { ...(b as ModuleBaseline) };
  }
  return {};
}

// Return a NEW MachineState with the given module's baseline replaced (immutable).
export function writeBaseline(
  state: MachineState,
  moduleName: string,
  baseline: ModuleBaseline,
): MachineState {
  const prevEntry = state.modules[moduleName];
  const prevObj = prevEntry && typeof prevEntry === "object" ? (prevEntry as Record<string, unknown>) : {};
  return {
    ...state,
    modules: { ...state.modules, [moduleName]: { ...prevObj, baseline } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roost/core test -- state`
Expected: PASS. (The existing `isMachineState` already accepts these — `capturedAt` null and `modules` object remain required; new fields are optional.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state.ts packages/core/src/state.test.ts
git commit -m "feat(core): MachineState v2 — baseline accessors, sync metadata (ADR-0018)"
```

---

### Task 7: `syncStateAll` orchestration wrapper

**Files:**
- Modify: `packages/core/src/orchestrate.ts`
- Modify: `packages/core/src/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/orchestrate.test.ts` (reuse the file's existing test helpers for `ModuleContext`/registry; if it builds contexts inline, mirror that). Add:

```typescript
import { syncStateAll } from "./orchestrate.js";
import { ModuleRegistry } from "./registry.js";
import type { SyncModule, DriftReport, ModuleContext, Selection } from "@roost/shared";

function fakeModule(name: string, report: DriftReport): SyncModule {
  return {
    name,
    async discover() { return []; },
    async status() { return report; },
    async capture() { return { module: name, written: [], encrypted: [] }; },
    async apply() { return { module: name, applied: [], backedUp: [], skipped: [] }; },
    async diff() { return ""; },
    async unmanage() { return { module: name, applied: [], backedUp: [], skipped: [] }; },
    async doctor() { return []; },
  };
}

describe("syncStateAll", () => {
  it("runs every module's status and returns an aggregated SyncStateReport", async () => {
    const reg = new ModuleRegistry();
    reg.register(fakeModule("dotfiles", {
      module: "dotfiles",
      items: [{ id: "x", state: "drift", localHash: null, repoHash: "r", baselineHash: null }],
    }));
    reg.register(fakeModule("env", {
      module: "env",
      items: [{ id: "y", state: "conflict", localHash: "a", repoHash: "b", baselineHash: "o" }],
    }));
    const ctx = { repoDir: "/r", home: "/h", profile: "default", dryRun: true } as unknown as ModuleContext;
    const sel: Selection = { modules: { dotfiles: ["x"], env: ["y"] } };

    const out = await syncStateAll(reg, ctx, sel);
    expect(out.items).toHaveLength(2);
    expect(out.counts.auto).toBe(1); // x is behind
    expect(out.counts.diverged).toBe(1); // y is diverged
    expect(out.overall).toBe("diverged");
  });
});
```

> NOTE for the implementer: check `orchestrate.test.ts`'s existing imports — it already imports from `./registry.js` and builds a `ModuleContext`. Reuse whatever helper it has rather than the inline cast above if one exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roost/core test -- orchestrate`
Expected: FAIL — `syncStateAll` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/orchestrate.ts`: add an import for `computeSyncState` and its type, and the wrapper. At the top with the other imports:

```typescript
import { computeSyncState } from "./sync-state.js";
import type { SyncStateReport } from "./sync-state.js";
```

After the existing `statusAll` function, add:

```typescript
// Aggregate every module's status into the sync-state review model (ADR-0016).
// Thin wrapper: statusAll already runs each module; computeSyncState is pure.
export async function syncStateAll(
  reg: ModuleRegistry,
  ctx: ModuleContext,
  sel: Selection,
): Promise<SyncStateReport> {
  const reports = await statusAll(reg, ctx, sel);
  return computeSyncState(reports);
}
```

> If `statusAll`'s exact name/signature differs, match it. As of this plan it is `statusAll(reg, ctx, sel): Promise<DriftReport[]>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roost/core test -- orchestrate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestrate.ts packages/core/src/orchestrate.test.ts
git commit -m "feat(core): syncStateAll orchestration wrapper (ADR-0016)"
```

---

### Task 8: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the whole core test suite**

Run: `pnpm --filter @roost/core test`
Expected: PASS — all existing tests plus the new sync-state/state/orchestrate tests.

- [ ] **Step 2: Typecheck + build core and shared**

Run: `pnpm --filter @roost/shared build && pnpm --filter @roost/core build`
Expected: PASS (no type errors).

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS. Fix any lint introduced by the new files (import order, unused).

- [ ] **Step 4: Confirm branch base is still clean**

Run: `git rev-list --count origin/main..HEAD`
Expected: a small integer = number of commits added by this plan (sanity check we are on `feat_sync_state`, not on a shared branch). Do NOT push.

---

## Self-Review (completed against the spec)

- **Spec coverage (Plan 1 scope):** §3 three-way model → Tasks 2-4; §6.3 three exceptions → Task 3; §6.4 push-safety → Task 5; §4 / ADR-0018 MachineState baseline → Task 6; §3.2 `syncStateAll` orchestration落点 → Task 7; ADR-0017 contract → Task 1. Module hash emission (§7.1 per-module `status`), onboarding (§5), resolution engine (§6.1-6.2), and UI (§6.6) are explicitly deferred to Plans 2-5 (see Roadmap).
- **Placeholder scan:** none — every code step shows complete code.
- **Type consistency:** `Direction`/`SyncException` defined in shared (Task 1) and imported by `sync-state.ts` (Tasks 2-4); `ThreeWay`/`ItemSignal`/`SyncStateReport` defined in `sync-state.ts` and consumed by `orchestrate.ts` (Task 7); `ModuleBaseline`/`readBaseline`/`writeBaseline` defined in Task 6. Names are consistent across tasks.
- **Known follow-up for Plan 2:** modules must populate `localHash/repoHash/baselineHash` (and `blocked`) on their `DriftItem`s, reading the baseline via `readBaseline` and writing it via `writeBaseline` after a successful apply; until then `computeSyncState`'s legacy fallback keeps behaviour safe (differences surface as decisions, never silent overwrites).
