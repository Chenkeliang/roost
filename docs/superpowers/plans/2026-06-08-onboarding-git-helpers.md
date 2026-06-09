# Onboarding Git Helpers — Implementation Plan (Plan 3 of 5)

> REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** Core, fake-exec-testable git helpers for the second-machine flow: `cloneRepo` (Plan 5 wires a `roost clone` CLI onto it), `remoteHead`, and `checkPushSafety` (combines `remoteHead` with Plan 1's pure `classifyPushSafety`). The doctor preflight hard-gate needs a `Health.blocking` field + a `preflight()` aggregator and is deferred to Plan 3b.

**Architecture:** All logic in `packages/core/src/onboarding.ts`, going through the single `Exec` adapter (I3) so it is unit-testable with a fake exec and never really shells out in tests (core禁联网). No I/O beyond `exec`.

**Tech Stack:** TS strict, vitest. `npx vitest run <path>`. Branch `feat_sync_state`. No push.

---

### Task 1: `onboarding.ts` — cloneRepo, remoteHead, checkPushSafety

**Files:**
- Create: `packages/core/src/onboarding.ts`
- Create: `packages/core/src/onboarding.test.ts`

- [ ] **Step 1: Failing test** — create `packages/core/src/onboarding.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Exec, ExecResult } from "@roost/shared";
import { cloneRepo, remoteHead, checkPushSafety } from "./onboarding.js";

function fakeExec(handler: (cmd: string, args: string[]) => Partial<ExecResult>): Exec {
  return {
    async run(cmd, args) {
      const r = handler(cmd, args);
      return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}

describe("cloneRepo", () => {
  it("ok on exit 0", async () => {
    const exec = fakeExec(() => ({ code: 0 }));
    expect(await cloneRepo(exec, "git@host:me/cfg.git", "/dest")).toEqual({ ok: true });
  });
  it("returns error on non-zero", async () => {
    const exec = fakeExec(() => ({ code: 128, stderr: "fatal: repository not found" }));
    const out = await cloneRepo(exec, "bad", "/dest");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("not found");
  });
});

describe("remoteHead", () => {
  it("parses the sha from ls-remote", async () => {
    const exec = fakeExec(() => ({ code: 0, stdout: "9f3a1c2deadbeef\tHEAD\n" }));
    expect(await remoteHead(exec, "/r")).toBe("9f3a1c2deadbeef");
  });
  it("null when ls-remote fails", async () => {
    const exec = fakeExec(() => ({ code: 1, stderr: "no remote" }));
    expect(await remoteHead(exec, "/r")).toBeNull();
  });
  it("null on empty output", async () => {
    const exec = fakeExec(() => ({ code: 0, stdout: "" }));
    expect(await remoteHead(exec, "/r")).toBeNull();
  });
});

describe("checkPushSafety", () => {
  it("ok when remote unreachable (do not block)", async () => {
    const exec = fakeExec(() => ({ code: 1 }));
    expect(await checkPushSafety(exec, "/r", "abc")).toBe("ok");
  });
  it("ok when remote head matches recorded", async () => {
    const exec = fakeExec(() => ({ code: 0, stdout: "abc\tHEAD" }));
    expect(await checkPushSafety(exec, "/r", "abc")).toBe("ok");
  });
  it("pull-first when remote advanced", async () => {
    const exec = fakeExec(() => ({ code: 0, stdout: "def\tHEAD" }));
    expect(await checkPushSafety(exec, "/r", "abc")).toBe("pull-first");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/core/src/onboarding.test.ts`.

- [ ] **Step 3: Implement** — create `packages/core/src/onboarding.ts`:

```typescript
// Second-machine onboarding git helpers (ADR-0016). All I/O via the Exec
// adapter (I3) so this is unit-testable and never shells out in tests.
import type { Exec } from "@roost/shared";
import { classifyPushSafety } from "./sync-state.js";
import type { PushSafety } from "./sync-state.js";

export async function cloneRepo(
  exec: Exec,
  url: string,
  dest: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await exec.run("git", ["clone", url, dest]);
  if (r.code === 0) return { ok: true };
  return { ok: false, error: r.stderr.trim() || `git clone exited ${r.code}` };
}

// The commit the remote default branch (HEAD) points to, or null if unknown.
export async function remoteHead(exec: Exec, repoDir: string): Promise<string | null> {
  const r = await exec.run("git", ["-C", repoDir, "ls-remote", "origin", "HEAD"]);
  if (r.code !== 0) return null;
  const first = r.stdout.split("\n")[0]?.trim();
  if (!first) return null;
  const sha = first.split(/\s+/)[0];
  return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

// Should a capture push proceed, given this machine's recorded sync head?
// Unknown remote → "ok" (never block on a network hiccup).
export async function checkPushSafety(
  exec: Exec,
  repoDir: string,
  recordedRemoteHead: string | undefined,
): Promise<PushSafety> {
  const current = await remoteHead(exec, repoDir);
  if (current === null) return "ok";
  return classifyPushSafety(recordedRemoteHead, current);
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run packages/core/src/onboarding.test.ts`.

- [ ] **Step 5: Commit** — `git add packages/core/src/onboarding.ts packages/core/src/onboarding.test.ts && git commit -m "feat(core): onboarding git helpers — clone, remoteHead, push-safety (ADR-0016)"`

---

### Task 2: Verification gate

- [ ] Full core suite: `npx vitest run packages/core` → all pass.
- [ ] Build: `pnpm --filter @roost/core build` → pass.
- [ ] Lint: `pnpm lint` → clean.

---

## Self-Review

- **Spec coverage (Plan 3 scope):** §5 step 1 clone → `cloneRepo`; §6.4 push-safety门 → `remoteHead` + `checkPushSafety` (uses Plan 1 `classifyPushSafety`). Doctor preflight hard-gate (§5 step 2) deferred to Plan 3b (needs `Health.blocking` + `preflight()`); `roost clone` CLI surface + age-key import guidance land with the cli/web wiring (Plans 4-5).
- **Placeholder scan:** none.
- **Type consistency:** `PushSafety`/`classifyPushSafety` from Plan 1 `sync-state.ts`; `Exec`/`ExecResult` from `@roost/shared`.
