# Dashboard P0 (止血去假) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard fast on cold load and honest (no placeholder data), with no architecture/schema change.

**Architecture:** Five small, independent changes from the approved spec (`docs/superpowers/specs/2026-05-31-dashboard-redesign-design.md` §6/§7/§9/§11 P0). Two are core behavior-tightening (status guards), three are cli/web fixes (real hostname, de-faked Overview cards, real Settings links + docs entry). No `SyncModule` contract change, no `selection.yaml`/schema change, no ADR.

**Tech Stack:** TypeScript (strict), pnpm monorepo, vitest, Fastify (cli server), React (web). Branch: `feat_p1_mvp`.

**Conventions for every commit:** Conventional Commits; end the message with:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
**Gate (must stay green before each commit lands):** `pnpm lint && pnpm -r build && pnpm -r typecheck && pnpm test && pnpm --filter @roost/web test`. Build core before cli when core changed (`pnpm --filter @roost/core build`).

---

### Task 1: Guard `packages.status` — don't call brew when packages unmanaged

**Why:** `packages.status` runs `brew bundle check` unconditionally → ~1.7s+ (cold 24s) even when nothing is managed. Guard on selection so unmanaged = cheap, no brew.

**Files:**
- Modify: `packages/core/src/modules/packages.ts` (the `status` method, ~lines 73–84)
- Test: `packages/core/src/modules/packages.test.ts` (the `packagesModule.status` describe block, ~line 164)

- [ ] **Step 1: Write the failing test** — append inside the `describe("packagesModule.status", …)` block in `packages/core/src/modules/packages.test.ts`:

```ts
  it("does NOT call brew when packages are not selected (status guard)", async () => {
    // A throwing exec proves no external command runs on the unmanaged path.
    const exec = {
      run: async () => {
        throw new Error("exec must not be called when packages unmanaged");
      },
    } as unknown as import("@roost/shared").Exec;
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const report = await packagesModule.status(ctx, { modules: {} });
    expect(report.module).toBe("packages");
    expect(report.items).toHaveLength(0);
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm exec vitest run packages/core/src/modules/packages.test.ts`
Expected: FAIL — the new test throws "exec must not be called…" (current `status` calls brew unconditionally).

- [ ] **Step 3: Add the guard** — in `packages/core/src/modules/packages.ts`, replace the `status` method body so it short-circuits when `Brewfile` is not selected:

```ts
  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    // Unmanaged → cheap, no brew call (cold-path fix).
    const selected = (sel.modules["packages"] ?? []).includes(BREWFILE_ID);
    if (!selected) {
      return { module: "packages", items: [] };
    }
    const r = await ctx.exec.run("brew", [
      "bundle",
      "check",
      "--file",
      brewfilePath(ctx.repoDir),
    ]);
    return {
      module: "packages",
      items: [{ id: BREWFILE_ID, state: r.code === 0 ? "synced" : "drift" }],
    };
  },
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @roost/core build && pnpm exec vitest run packages/core/src/modules/packages.test.ts`
Expected: PASS (new guard test + the two existing status tests, which pass a non-empty `packages` selection, all green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/packages.ts packages/core/src/modules/packages.test.ts
git commit -m "fix(core): packages.status skips brew when unmanaged (cold-path guard)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Guard `dotfiles.status` — don't call chezmoi when nothing managed

**Why:** `dotfiles.status` calls `chezmoi.verify()` unconditionally even with an empty selection. Guard so unmanaged = cheap, no chezmoi.

**Files:**
- Modify: `packages/core/src/modules/dotfiles.ts` (the `status` method, lines 166–174)
- Test: `packages/core/src/modules/dotfiles.test.ts`

- [ ] **Step 1: Write the failing test** — add a `dotfilesModule.status` test in `packages/core/src/modules/dotfiles.test.ts` (place near the other `dotfilesModule` describe blocks; reuse the file's existing `makeCtx` helper):

```ts
describe("dotfilesModule.status guard", () => {
  it("does NOT call chezmoi when no dotfiles are managed", async () => {
    const exec = {
      run: async () => {
        throw new Error("exec must not be called when dotfiles unmanaged");
      },
    } as unknown as import("@roost/shared").Exec;
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo", home: "/tmp/home" });
    const report = await dotfilesModule.status(ctx, { modules: {} });
    expect(report.module).toBe("dotfiles");
    expect(report.items).toHaveLength(0);
  });
});
```

> If `makeCtx` in this file has a different signature, call it the same way the existing tests in `dotfiles.test.ts` do (read the top of the file). `dotfilesModule` is already imported there.

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm exec vitest run packages/core/src/modules/dotfiles.test.ts`
Expected: FAIL — throws "exec must not be called…".

- [ ] **Step 3: Add the guard** — in `packages/core/src/modules/dotfiles.ts`, replace the `status` method (lines 166–174):

```ts
  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const ids = sel.modules["dotfiles"] ?? [];
    // Unmanaged → cheap, no chezmoi call (cold-path guard).
    if (ids.length === 0) {
      return { module: "dotfiles", items: [] };
    }
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const ok = await chezmoi.verify();
    return {
      module: "dotfiles",
      items: ids.map((id) => ({ id, state: ok ? "synced" : "drift" })),
    };
  },
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @roost/core build && pnpm exec vitest run packages/core/src/modules/dotfiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/dotfiles.ts packages/core/src/modules/dotfiles.test.ts
git commit -m "fix(core): dotfiles.status skips chezmoi when unmanaged (cold-path guard)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `/api/health` returns the real hostname

**Why:** `health.name` is hardcoded `"roost"`; the Overview card needs the real machine name. `os` is already imported in `server.ts`.

**Files:**
- Modify: `packages/cli/src/server.ts` (the `/api/health` handler, ~line 49–53)
- Test: `packages/cli/src/server.test.ts` (the health test, ~line 87)

- [ ] **Step 1: Update the failing test** — in `packages/cli/src/server.test.ts`, add `import * as os from "node:os";` at the top if absent, and change the health test's name assertion:

```ts
    expect(body.name).toBe(os.hostname());
```
(replace the existing `expect(body.name).toBe("roost");`). Also update the test's title string from `name: 'roost'` to `name: hostname`.

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm exec vitest run packages/cli/src/server.test.ts`
Expected: FAIL — body.name is still `"roost"`, not `os.hostname()`.

- [ ] **Step 3: Implement** — in `packages/cli/src/server.ts`, change the health handler:

```ts
  server.get("/api/health", async (_req, reply) => {
    const home = makeCtx(true).home;
    const ageKeyPath = path.join(home, ".config", "sops", "age", "keys.txt");
    const ageKey = fs.existsSync(ageKeyPath);
    return reply.send({ ok: true, name: os.hostname(), repoDir, ageKey });
  });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @roost/cli build && pnpm exec vitest run packages/cli/src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "fix(cli): /api/health reports real hostname (was hardcoded 'roost')

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: De-fake Overview machine cards (honest single card + empty state)

**Why:** Overview shows a hardcoded `"Mac mini"` follower with duplicated local counts. Show ONE real local card; replace the fake follower with an honest empty state unless a real second host exists. (Real multi-machine is P2 / ADR-0005.)

**Files:**
- Modify: `packages/web/src/views/Overview.tsx` (the machine-cards `<section>`, ~lines 184–220; imports at top)
- Test: `packages/web/src/Overview.test.tsx`

- [ ] **Step 1: Write the failing test** — in `packages/web/src/Overview.test.tsx`, add a test (the existing mock returns `getMachines → { hosts: ["macbook.local"], states: {} }`, i.e. one host → no follower):

```ts
  it("shows one real machine card and an honest empty state when there is no second machine", async () => {
    await act(async () => {
      render(<Overview showHud={noop} />);
    });
    // Real hostname from /api/health, not a hardcoded follower.
    await waitFor(() => expect(screen.getByText(/macbook\.local|roost/)).toBeInTheDocument());
    // No fake follower.
    expect(screen.queryByText("Mac mini")).not.toBeInTheDocument();
    // Honest empty state for the absent second machine.
    expect(screen.getByText(/No other machine yet/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @roost/web test -- Overview`
Expected: FAIL — "No other machine yet" not found (current code renders a "Mac mini" follower card).

- [ ] **Step 3: Implement** — in `packages/web/src/views/Overview.tsx`:

(a) Ensure `Desktop` is imported from phosphor (add to the existing `@phosphor-icons/react` import if missing):
```ts
import { FloppyDisk, DownloadSimple, FileCode, Package, SlidersHorizontal, GitBranch, Scan, Lock, Desktop } from "@phosphor-icons/react";
```

(b) Replace the machine-cards `<section>` (the `display:"grid"` block with the two `<MachineCard>`s) with:
```tsx
      {/* Machine Cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <MachineCard
          type="primary"
          name={health?.name ?? primaryHost ?? "this machine"}
          hostname={primaryHost ?? health?.name}
          tracked={trackedCount}
          drift={driftedCount}
          lastActionLabel="capture"
          lastAction={primaryHost ? "now" : undefined}
          status={hasConflict ? "conflict" : hasDrift ? "drift" : "synced"}
          loading={loadingData}
        />
        {followerHost ? (
          <MachineCard
            type="follower"
            name={followerHost}
            hostname={followerHost}
            tracked={trackedCount}
            drift={driftedCount}
            lastActionLabel="load"
            status="drift"
            loading={loadingData}
          />
        ) : (
          <article
            style={{
              background: "var(--surface)",
              border: "1px dashed var(--border)",
              borderRadius: "var(--rc)",
              padding: 16,
              display: "flex",
              alignItems: "center",
              gap: 11,
              color: "var(--muted)",
            }}
          >
            <Desktop size={18} style={{ flexShrink: 0 }} />
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              No other machine yet — run <span className="mono">roost load</span> on a second Mac to see it here.
            </div>
          </article>
        )}
      </section>
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @roost/web test -- Overview`
Expected: PASS. (If an older assertion in this file expected two cards or "Mac mini", update it to the single-card + empty-state reality.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Overview.tsx packages/web/src/Overview.test.tsx
git commit -m "fix(web): honest Overview machine cards (real host + empty state, no fake follower)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Settings — real repo links + a Documentation entry

**Why:** Settings docs links use a placeholder `your-org`; there is no entry to the usage docs. Point links at `Chenkeliang/roost` and add a Documentation entry.

**Files:**
- Modify: `packages/web/src/views/Settings.tsx` (the docs links array, ~lines 161–164)
- Test: `packages/web/src/Settings.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `packages/web/src/Settings.test.tsx`:

```ts
  it("links to the real repo and exposes a Documentation entry", async () => {
    await act(async () => {
      render(<Settings />);
    });
    const docs = await screen.findByText(/Documentation/i);
    expect(docs.closest("a")?.getAttribute("href")).toContain("github.com/Chenkeliang/roost");
    // No placeholder org remains.
    document.querySelectorAll("a").forEach((a) => {
      expect(a.getAttribute("href") ?? "").not.toContain("your-org");
    });
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @roost/web test -- Settings`
Expected: FAIL — no "Documentation" entry; existing links contain `your-org`.

- [ ] **Step 3: Implement** — in `packages/web/src/views/Settings.tsx`, replace the docs links array:

```ts
        {[
          { label: "Documentation (使用文档)", href: "https://github.com/Chenkeliang/roost/tree/main/website" },
          { label: "Architecture & design", href: "https://github.com/Chenkeliang/roost/tree/main/docs/superpowers/specs" },
          { label: "Module development guide", href: "https://github.com/Chenkeliang/roost/blob/main/CONTRIBUTING.md" },
          { label: "Changelog", href: "https://github.com/Chenkeliang/roost/releases" },
        ].map(({ label, href }) => (
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @roost/web test -- Settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Settings.tsx packages/web/src/Settings.test.tsx
git commit -m "fix(web): real repo links + Documentation entry in Settings (drop your-org placeholder)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Top-bar alignment (nav aligns with content)

**Why:** The header is full-width/left-aligned while content is `maxWidth:1080` centered → nav and content don't line up. Wrap the header's inner row in the same centered container.

**Files:**
- Modify: `packages/web/src/App.tsx` (the `<header>` element, ~lines 80–165)
- Test: covered by the full web suite + visual; no new unit test required (pure layout).

- [ ] **Step 1: Implement** — in `packages/web/src/App.tsx`, change the `<header>` so the bar is full-width but its inner row is centered to `maxWidth:1080`:

Replace the opening `<header style={{…}}>` (the one with `display:"flex"…padding:"6px 24px 16px"…`) with a bar-only header plus an inner wrapper:
```tsx
      <header
        style={{
          position: "sticky",
          top: 0,
          background: "var(--bg)",
          zIndex: 20,
          borderBottom: "1px solid var(--border-soft)",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            maxWidth: 1080,
            margin: "0 auto",
            padding: "6px 24px 16px",
          }}
        >
```
Then add one closing `</div>` immediately before the closing `</header>` (the inner wrapper). The brand/nav/right-side children stay unchanged between them.

- [ ] **Step 2: Build + run the web suite, verify pass**

Run: `pnpm --filter @roost/web build && pnpm --filter @roost/web test`
Expected: PASS (all web tests still green; layout compiles).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "fix(web): align top bar with content (center header inner row to 1080)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full gate + push

- [ ] **Step 1: Run the full gate**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm -r build && pnpm -r typecheck && pnpm test && pnpm --filter @roost/web test`
Expected: ALL GREEN.

- [ ] **Step 2: Push and confirm CI**

```bash
git push
```
Then confirm the `ci` workflow is green on ubuntu + macOS for the new HEAD.

---

## Verification matrix (spec coverage)

| Spec item (P0) | Task |
|---|---|
| status 短路守卫 (§7, #5) | 1 (packages) + 2 (dotfiles) |
| 真 hostname (§6/§9) | 3 |
| 去假机器卡 (§6/§9) | 4 |
| Settings 文档链接改真 + 文档入口 (§9) | 5 |
| 顶栏对齐 (#6) | 6 |
| 门禁绿 + 推送 | 7 |

## Out of scope (later phases)
- `index()` contract, on-demand discovery, per-module rich pages, sidebar IA → **P1** (own specs + ADR-0006).
- Real multi-machine/roles, Git remote panel, Timeline rollback, Learn Mode, web i18n, path-portability fixes → **P2** (ADR-0005).
- Desktop signing, inventory scrub, docs deploy → **P3**.
