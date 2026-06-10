# Skills Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wall-of-checkmarks Skills "managed" matrix with a calm coverage list (one `n/m` cell per skill, accent reserved for exceptions), preserve full per-tool control via a popover, move row actions into a `⋯` menu, add managed-tab search, and add a target manager for custom symlink directories.

**Architecture:** Mostly `packages/web` (a pure `computeCoverage` helper + `CoverageCell`, `SkillTargetsPopover`, `RowMenu`, `TargetManager` components, reusing existing `toggleSkill`/`saveSkillsConfig`/`unadoptSkills`/`resolveSkillConflict`). One small backend addition: `saveSkillsTargets` in core + `POST /api/skills/catalog`. No schema/architecture change (per spec §7 — no ADR).

**Tech Stack:** React + Vite, TypeScript strict, Phosphor icons (no emoji), existing inline-style consts (`card`/`ic`/`cellPad`), `t()` i18n. Web tests `.test.tsx` (jsdom) via `pnpm --filter @roost/web test`; core/cli tests via `npx vitest run <path>`; build `pnpm -r build`; lint `pnpm lint`. Shell zsh. Branch `feat_skills-redesign` (already cut, stacked on feat_adopt-local-skills).

**Coverage semantics (spec §3):** `m = |effective.targets|` (desired set); `n = ` desired targets with a healthy link (symlink OR copy). `covered` when `n===m` (neutral gray); `partial` when a desired target is broken/missing (amber `#f0b352`); `conflict` when a desired target is occupied by a non-Roost real dir (coral `var(--accent)`); `disabled` when `!effective.enabled` (dimmed row, `—`).

**Phasing note:** the coverage cell and the per-tool popover ship TOGETHER (Phase 1) so removing the matrix never loses per-target control.

---

## File Structure

- Create `packages/web/src/views/skillsCoverage.ts` — pure `computeCoverage(row)` + `targetStatus(row,id)` (moved from Skills.tsx so it's unit-testable).
- Create `packages/web/src/views/skillsCoverage.test.tsx` — unit tests for the helper.
- Modify `packages/web/src/views/Skills.tsx` — managed table: replace the 4 target columns + method column with one `CoverageCell`; add `SkillTargetsPopover`, `RowMenu` (`⋯`), summary strip, search; import `targetStatus`/`computeCoverage` from the new file.
- Modify `packages/web/src/Skills.test.tsx` — update the remove-flow test (移出 now inside `⋯`); add coverage/popover/target-manager tests.
- Modify `packages/web/src/i18n/strings.ts` — `skills.coverage.*`, `skills.targets.*`.
- Modify `packages/core/src/skills-catalog.ts` — add `saveSkillsTargets(repoDir, targets)`.
- Create `packages/core/src/skills-catalog.test.ts` — round-trip tests.
- Modify `packages/core/src/index.ts` — export `saveSkillsTargets`.
- Modify `packages/cli/src/server.ts` — `POST /api/skills/catalog`.
- Modify `packages/cli/src/server.test.ts` — endpoint test.
- Modify `packages/web/src/api.ts` — `saveSkillsTargets(targets)`.
- Create `packages/web/src/views/TargetManager.tsx` — the manage-targets dialog.

---

## Task 1: coverage helper (pure, unit-tested)

**Files:**
- Create: `packages/web/src/views/skillsCoverage.ts`
- Test: `packages/web/src/views/skillsCoverage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/views/skillsCoverage.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { computeCoverage } from "./skillsCoverage";
import type { SkillRow } from "../api";

const row = (over: Partial<SkillRow>): SkillRow => ({
  name: "x",
  effective: { enabled: true, targets: ["claude", "codex", "gemini", "opencode"], method: "symlink" },
  links: [],
  conflicts: [],
  ...over,
});
const link = (target: string) => ({ skill: "x", target, path: "/p", kind: "symlink" as const });

describe("computeCoverage", () => {
  it("covered when every desired target has a healthy link", () => {
    const c = computeCoverage(row({ links: ["claude", "codex", "gemini", "opencode"].map(link) }));
    expect(c).toMatchObject({ state: "covered", desired: 4, healthy: 4 });
  });
  it("partial (amber) when a desired target has no link", () => {
    const c = computeCoverage(row({ links: ["claude", "codex", "gemini"].map(link) }));
    expect(c).toMatchObject({ state: "partial", desired: 4, healthy: 3, broken: 1 });
  });
  it("conflict (coral) when a desired target is in conflicts", () => {
    const c = computeCoverage(row({ links: ["codex", "gemini", "opencode"].map(link), conflicts: ["claude"] }));
    expect(c.state).toBe("conflict");
    expect(c.conflict).toBe(1);
  });
  it("disabled when the skill is off, denominator is its desired set size", () => {
    const c = computeCoverage(row({ effective: { enabled: false, targets: ["claude", "codex"], method: "symlink" } }));
    expect(c.state).toBe("disabled");
  });
  it("a skill scoped to 2 targets reads 2/2 when both linked (not 2/4)", () => {
    const c = computeCoverage(row({ effective: { enabled: true, targets: ["claude", "codex"], method: "symlink" }, links: ["claude", "codex"].map(link) }));
    expect(c).toMatchObject({ state: "covered", desired: 2, healthy: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @roost/web test -- skillsCoverage`
Expected: FAIL — `computeCoverage` not found.

- [ ] **Step 3: Implement**

Create `packages/web/src/views/skillsCoverage.ts`:

```ts
import type { SkillRow } from "../api";

// Per-(skill,target) status derived from effective state + links.
export function targetStatus(row: SkillRow, targetId: string): "linked" | "copy" | "conflict" | "broken" | "off" {
  const wanted = row.effective.enabled && row.effective.targets.includes(targetId);
  const link = row.links.find((l) => l.target === targetId);
  if (!wanted) return "off";
  if (row.conflicts?.includes(targetId)) return "conflict"; // real non-Roost dir occupies the dest
  if (!link) return "broken"; // wanted but no link on disk yet
  if (link.kind === "copy") return "copy";
  return "linked";
}

export type CoverageState = "covered" | "partial" | "conflict" | "disabled";
export type Segment = "healthy" | "broken" | "conflict";
export interface Coverage {
  state: CoverageState;
  desired: number; // m
  healthy: number; // n
  broken: number;
  conflict: number;
  segments: Segment[]; // one per desired target, in effective.targets order
}

// Coverage by the DESIRED set (effective.targets). A skill intentionally scoped
// to 2 tools reads 2/2 (covered), never 2/4.
export function computeCoverage(row: SkillRow): Coverage {
  const desired = row.effective.targets;
  if (!row.effective.enabled) {
    return { state: "disabled", desired: desired.length, healthy: 0, broken: 0, conflict: 0, segments: [] };
  }
  const segments: Segment[] = desired.map((id) => {
    if (row.conflicts?.includes(id)) return "conflict";
    return row.links.some((l) => l.target === id) ? "healthy" : "broken";
  });
  const healthy = segments.filter((s) => s === "healthy").length;
  const conflict = segments.filter((s) => s === "conflict").length;
  const broken = segments.filter((s) => s === "broken").length;
  const state: CoverageState = conflict > 0 ? "conflict" : broken > 0 ? "partial" : "covered";
  return { state, desired: desired.length, healthy, broken, conflict, segments };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @roost/web test -- skillsCoverage`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/skillsCoverage.ts packages/web/src/views/skillsCoverage.test.tsx
git commit -m "feat(web): computeCoverage helper (coverage by desired set)"
```

---

## Task 2: CoverageCell + summary strip (replace the matrix)

**Files:**
- Modify: `packages/web/src/views/Skills.tsx` (imports; remove inline `targetStatus`/`CellToggle` usage in the managed table; managed `<thead>`/`<tbody>` ~lines 339–384 and the trailing method/移出 `<td>`s)
- Modify: `packages/web/src/i18n/strings.ts`
- Test: `packages/web/src/Skills.test.tsx`

Color tokens: `covered` → `var(--muted)`; `partial` → `#f0b352`; `conflict` → `var(--accent)`; `disabled` → row `opacity: 0.45`.

- [ ] **Step 1: Add i18n keys**

In `packages/web/src/i18n/strings.ts` (near other `skills.*`):

```ts
  "skills.coverage.title": { en: "Coverage", zh: "覆盖" },
  "skills.coverage.broken": { en: "broken", zh: "断链" },
  "skills.coverage.conflict": { en: "conflict", zh: "冲突" },
  "skills.coverage.disabled": { en: "disabled", zh: "停用" },
  "skills.summary": { en: "managed · all distributed to their targets", zh: "已纳管 · 均分发至各自目标" },
```

- [ ] **Step 2: Write the failing test**

Add to `packages/web/src/Skills.test.tsx` (the `BASE_VIEW.skills` row `foo` is enabled for `claude` with `conflicts:["claude"]`; extend the mock for coverage cases). Add:

```tsx
it("managed tab shows a coverage cell (n/m) instead of per-tool columns", async () => {
  vi.mocked(api.getSkills).mockResolvedValue({
    ...BASE_VIEW,
    skills: [
      { name: "alpha", effective: { enabled: true, targets: ["claude", "codex"], method: "symlink" },
        links: [{ skill: "alpha", target: "claude", path: "/p", kind: "symlink" }, { skill: "alpha", target: "codex", path: "/p", kind: "symlink" }], conflicts: [] },
      { name: "beta", effective: { enabled: true, targets: ["claude", "codex"], method: "symlink" },
        links: [{ skill: "beta", target: "claude", path: "/p", kind: "symlink" }], conflicts: [] },
    ],
  });
  vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
  render(<Skills />);
  expect(await screen.findByText("2/2")).toBeInTheDocument(); // alpha covered
  expect(await screen.findByText("1/2")).toBeInTheDocument(); // beta partial
  // the old per-tool column headers are gone
  expect(screen.queryByRole("columnheader", { name: "Gemini CLI" })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @roost/web test -- Skills.test`
Expected: FAIL — no `2/2` text; Gemini CLI header still present.

- [ ] **Step 4: Implement**

In `Skills.tsx`:

(a) Update imports — remove the now-moved helper, import the new one, and the dot/menu icons:
```ts
import { Stack, MagnifyingGlass, ArrowsClockwise, CheckCircle, Link as LinkIcon, Warning, UploadSimple, Wrench, DotsThree } from "@phosphor-icons/react";
import { computeCoverage, targetStatus } from "./skillsCoverage";
import type { Coverage } from "./skillsCoverage";
```
Delete the inline `targetStatus` function (now in skillsCoverage.ts). Keep `CellToggle` for now (the popover in Task 3 will reuse a variant) OR delete if unused after Task 3 — leave it until Task 3.

(b) Add the `CoverageCell` component above `export function Skills()`:
```tsx
function CoverageCell({ cov, method, onOpen, t }: { cov: Coverage; method: string; onOpen: () => void; t: (k: string) => string }) {
  const color = cov.state === "conflict" ? "var(--accent)" : cov.state === "partial" ? "#f0b352" : "var(--muted)";
  if (cov.state === "disabled") {
    return <span style={{ color: "var(--muted)", opacity: 0.6, fontSize: 13 }}>—</span>;
  }
  const dotColor = (s: string) => (s === "conflict" ? "var(--accent)" : s === "broken" ? "#f0b352" : "var(--muted)");
  return (
    <button onClick={onOpen} style={{ ...ic, border: 0, background: "transparent", padding: "2px 4px", gap: 8 }} aria-label={`${t("skills.coverage.title")} ${cov.healthy}/${cov.desired}`}>
      <span style={{ display: "inline-flex", gap: 3 }}>
        {cov.segments.map((s, i) => (
          <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: s === "healthy" ? "var(--muted)" : "transparent", border: `1px solid ${dotColor(s)}` }} />
        ))}
      </span>
      <span className="mono" style={{ color, fontSize: 13 }}>{cov.healthy}/{cov.desired}</span>
      <span style={{ color: "var(--muted)", fontSize: 12.5 }}>· {t(`skills.method.${method}`)}</span>
      {cov.state === "partial" && <span style={{ color: "#f0b352", fontSize: 12 }}>{cov.broken} {t("skills.coverage.broken")}</span>}
      {cov.state === "conflict" && <span style={{ color: "var(--accent)", fontSize: 12 }}>{t("skills.coverage.conflict")}</span>}
    </button>
  );
}
```

(c) Replace the managed `<thead>` columns (the `启用`, the `targets.map` headers, the method header, and the trailing `移出` header at ~lines 342–347) with:
```tsx
                  <th style={{ ...cellPad, fontWeight: 600 }}>{t("skills.enabled")}</th>
                  <th style={{ ...cellPad, fontWeight: 600 }}>{t("skills.coverage.title")}</th>
                  <th style={{ ...cellPad, fontWeight: 600 }} aria-label="actions"></th>
```
(Keep the leading `Skill` header.)

(d) Replace the row cells after the enable checkbox `<td>` (the `targets.map(...)` block, the method `<td>`, and the 移出 `<td>`) with a single coverage `<td>` plus a placeholder actions `<td>` (the `⋯` menu lands in Task 4; for now keep the existing 移出 button there so the remove test still passes):
```tsx
                    <td style={cellPad}>
                      <CoverageCell cov={computeCoverage(row)} method={row.effective.method} onOpen={() => setPopover(row.name)} t={t} />
                    </td>
                    <td style={cellPad}>
                      <button aria-label={`remove ${row.name}`} title={t("skills.adopt.removeTitle")} disabled={busy} onClick={() => setRemoving(row.name)} style={{ ...ic, padding: "4px 8px", color: "var(--muted)" }}>
                        {t("skills.adopt.remove")}
                      </button>
                    </td>
```
Dim disabled rows: on the `<tr>` add `style={{ opacity: row.effective.enabled ? 1 : 0.45 }}`.

(e) Add popover state near the others (~line 106): `const [popover, setPopover] = useState<string | null>(null);` (wired in Task 3).

(f) Add the summary strip just above the table (inside `tab === "managed"`, before the `<div style={{ ...card ...}}>`):
```tsx
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
              {skills.length} {t("skills.summary")}
            </div>
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @roost/web test -- Skills.test`
Expected: PASS (new test + existing managed/resolve/adopt tests; the resolve test still finds the conflict via the popover in Task 3 — if the resolve test breaks now because the matrix cell is gone, mark it skipped with a `// re-enabled in Task 3` note and re-enable in Task 3). Run `pnpm --filter @roost/web exec tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/views/Skills.tsx packages/web/src/i18n/strings.ts packages/web/src/Skills.test.tsx
git commit -m "feat(web): coverage cell + summary strip replace the per-tool matrix"
```

---

## Task 3: per-tool popover (preserve per-target control + resolve)

**Files:**
- Modify: `packages/web/src/views/Skills.tsx` (add `SkillTargetsPopover`; render when `popover === row.name`; remove the now-unused `CellToggle`)
- Test: `packages/web/src/Skills.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `Skills.test.tsx`:

```tsx
it("clicking the coverage cell opens a per-tool popover; toggling a tool calls toggleSkill", async () => {
  vi.mocked(api.getSkills).mockResolvedValue({
    ...BASE_VIEW,
    skills: [{ name: "alpha", effective: { enabled: true, targets: ["claude"], method: "symlink" },
      links: [{ skill: "alpha", target: "claude", path: "/p", kind: "symlink" }], conflicts: [] }],
  });
  vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
  vi.mocked(api.toggleSkill).mockResolvedValue({ ok: true, config: {} as never });
  render(<Skills />);
  (await screen.findByLabelText(/Coverage 1\/1/)).click();
  const dialog = await screen.findByRole("dialog");
  // Codex is a catalog target but NOT in alpha's desired set → toggling it ON
  within(dialog).getByRole("switch", { name: /Codex/ }).click();
  await waitFor(() => expect(api.toggleSkill).toHaveBeenCalledWith("alpha", true, "codex"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @roost/web test -- Skills.test`
Expected: FAIL — no dialog opens.

- [ ] **Step 3: Implement**

Add the component above `export function Skills()`:

```tsx
function SkillTargetsPopover({ row, targets, busy, t, onToggle, onResolve, onClose }: {
  row: SkillRow; targets: { id: string; label: string }[]; busy: boolean; t: (k: string) => string;
  onToggle: (targetId: string, next: boolean) => void; onResolve: (targetId: string) => void; onClose: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, maxWidth: 420, width: "100%", padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}><span className="mono">{row.name}</span></div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>{t("skills.targets.subtitle")}</div>
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden" }}>
          {targets.map((tg) => {
            const st = targetStatus(row, tg.id);
            const on = row.effective.enabled && row.effective.targets.includes(tg.id);
            return (
              <div key={tg.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                <button role="switch" aria-checked={on} aria-label={tg.label} disabled={busy || !row.effective.enabled}
                  onClick={() => onToggle(tg.id, !on)}
                  style={{ ...ic, border: 0, background: "transparent", padding: 0 }}>
                  {on ? <CheckCircle size={18} weight="fill" style={{ color: "var(--accent)" }} /> : <Circle size={18} style={{ color: "var(--border)" }} />}
                </button>
                <span style={{ flex: 1 }}>{tg.label}</span>
                {st === "conflict" ? (
                  <button onClick={() => onResolve(tg.id)} style={{ ...ic, color: "#f0b352", borderColor: "#f0b352" }}>{t("skills.resolve.action")}</button>
                ) : st === "broken" ? (
                  <span style={{ color: "#f0b352", fontSize: 12 }}>{t("skills.coverage.broken")}</span>
                ) : st === "copy" ? (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("skills.method.copy")}</span>
                ) : st === "linked" ? (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("skills.method.symlink")}</span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} style={{ ...ic, padding: "6px 12px" }}>{t("skills.resolve.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
```

Add i18n: `"skills.targets.subtitle": { en: "Distribute to which tools", zh: "分发到哪些工具" }`.

Render it in `Skills()` (near the other dialogs), and remove the `CellToggle` function (now unused):
```tsx
      {popover && (() => {
        const row = skills.find((s) => s.name === popover);
        if (!row) return null;
        return (
          <SkillTargetsPopover row={row} targets={targets} busy={busy} t={t}
            onToggle={(tid, next) => void onToggleTarget(row, tid, next)}
            onResolve={(tid) => { setPopover(null); setPending({ skill: row.name, target: tid }); }}
            onClose={() => setPopover(null)} />
        );
      })()}
```

If the Task 2 resolve test was skipped, re-enable it but drive it through the popover (open coverage cell → click Resolve in the dialog → confirm).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @roost/web test -- Skills.test` then `pnpm --filter @roost/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Skills.tsx packages/web/src/i18n/strings.ts packages/web/src/Skills.test.tsx
git commit -m "feat(web): per-tool popover preserves (skill x tool) control + resolve"
```

---

## Task 4: `⋯` row menu (move 移出 + method + enable) + drop standalone columns

**Files:**
- Modify: `packages/web/src/views/Skills.tsx` (actions `<td>`; remove the standalone enable column if folding into menu — keep enable checkbox OR move to menu; method now lives here)
- Modify: `packages/web/src/i18n/strings.ts`
- Test: `packages/web/src/Skills.test.tsx`

- [ ] **Step 1: Write the failing test (update remove flow to go through ⋯)**

Replace the existing remove-flow test body so it opens the `⋯` menu first:

```tsx
it("remove flow: ⋯ menu → Remove → confirm calls unadoptSkills", async () => {
  vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
  vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
  vi.mocked(api.unadoptSkills).mockResolvedValue({ ok: true, removed: ["foo"] });
  render(<Skills />);
  (await screen.findByRole("button", { name: "actions foo" })).click();
  (await screen.findByRole("menuitem", { name: /Remove|移出/ })).click();
  const dialog = await screen.findByRole("dialog");
  within(dialog).getByRole("button", { name: /^Remove$/i }).click();
  await waitFor(() => expect(api.unadoptSkills).toHaveBeenCalledWith(["foo"]));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @roost/web test -- Skills.test`
Expected: FAIL — no `actions foo` button / no `menuitem`.

- [ ] **Step 3: Implement**

Add a small `RowMenu` component (a button + a popover list). Add i18n: `"skills.menu.method": { en: "Switch to copy", zh: "改为拷贝" }` / `"skills.menu.methodSymlink": { en: "Switch to symlink", zh: "改为软链" }` / `"skills.menu.disable": { en: "Disable", zh: "停用" }` / `"skills.menu.enable": { en: "Enable", zh: "启用" }`.

```tsx
function RowMenu({ row, busy, t, onRemove, onMethod, onToggleEnabled }: {
  row: SkillRow; busy: boolean; t: (k: string) => string;
  onRemove: () => void; onMethod: (m: SkillMethod) => void; onToggleEnabled: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button aria-label={`actions ${row.name}`} disabled={busy} onClick={() => setOpen((o) => !o)} style={{ ...ic, border: 0, background: "transparent", padding: "4px 6px" }}>
        <DotsThree size={18} />
      </button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
          <div role="menu" style={{ position: "absolute", right: 0, top: "100%", zIndex: 91, ...card, minWidth: 160, padding: 4 }}>
            <button role="menuitem" onClick={() => { setOpen(false); onToggleEnabled(); }} style={{ ...ic, border: 0, width: "100%", justifyContent: "flex-start" }}>
              {row.effective.enabled ? t("skills.menu.disable") : t("skills.menu.enable")}
            </button>
            <button role="menuitem" onClick={() => { setOpen(false); onMethod(row.effective.method === "symlink" ? "copy" : "symlink"); }} style={{ ...ic, border: 0, width: "100%", justifyContent: "flex-start" }}>
              {row.effective.method === "symlink" ? t("skills.menu.method") : t("skills.menu.methodSymlink")}
            </button>
            <button role="menuitem" onClick={() => { setOpen(false); onRemove(); }} style={{ ...ic, border: 0, width: "100%", justifyContent: "flex-start", color: "var(--accent)" }}>
              {t("skills.adopt.remove")}
            </button>
          </div>
        </>
      )}
    </span>
  );
}
```

Replace the actions `<td>` (the temporary 移出 button from Task 2) with:
```tsx
                    <td style={cellPad}>
                      <RowMenu row={row} busy={busy} t={t}
                        onRemove={() => setRemoving(row.name)}
                        onMethod={(m) => void onChangeMethod(row.name, m)}
                        onToggleEnabled={() => void onToggleMaster(row)} />
                    </td>
```
Now the enable checkbox column is redundant (enable is in the menu + the row dims when off). Remove the `启用` `<th>` and its `<td>` (the checkbox). Keep the leading `Skill` + `Coverage` + actions columns only.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @roost/web test -- Skills.test` + `pnpm --filter @roost/web exec tsc --noEmit`
Expected: PASS. (Update the old "renders managed row with IDE matrix" test if it asserts target column headers — change it to assert the coverage column instead.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Skills.tsx packages/web/src/i18n/strings.ts packages/web/src/Skills.test.tsx
git commit -m "feat(web): row ⋯ menu (enable/method/remove); drop standalone columns"
```

---

## Task 5: managed-tab search

**Files:**
- Modify: `packages/web/src/views/Skills.tsx`
- Test: `packages/web/src/Skills.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("managed tab filters rows by the search box", async () => {
  vi.mocked(api.getSkills).mockResolvedValue({
    ...BASE_VIEW,
    skills: [
      { name: "alpha", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [{ skill: "alpha", target: "claude", path: "/p", kind: "symlink" }], conflicts: [] },
      { name: "zeta", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [{ skill: "zeta", target: "claude", path: "/p", kind: "symlink" }], conflicts: [] },
    ],
  });
  vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
  render(<Skills />);
  await screen.findByText("alpha");
  (await screen.findByPlaceholderText(/Filter|筛选/)).dispatchEvent(new Event("input"));
  const box = screen.getByPlaceholderText(/Filter|筛选/) as HTMLInputElement;
  // simulate typing "zet"
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(box, { target: { value: "zet" } });
  expect(screen.queryByText("alpha")).not.toBeInTheDocument();
  expect(screen.getByText("zeta")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @roost/web test -- Skills.test`
Expected: FAIL — no filter box.

- [ ] **Step 3: Implement**

Add state `const [managedFilter, setManagedFilter] = useState("");`. Add a search input in the managed tab header row (reuse the `ic` style + `MagnifyingGlass`). Filter rows:
```tsx
const q = managedFilter.trim().toLowerCase();
const visibleSkills = q ? skills.filter((s) => s.name.toLowerCase().includes(q)) : skills;
```
Render `visibleSkills.map(...)` instead of `skills.map(...)`. Place the input above the table:
```tsx
            <input value={managedFilter} onChange={(e) => setManagedFilter(e.target.value)} placeholder={t("skills.import.search")}
              style={{ ...ic, width: 220, padding: "5px 9px", marginBottom: 8 }} />
```
(`skills.import.search` already exists = "Filter skills…/筛选 skill…".)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @roost/web test -- Skills.test` + `pnpm --filter @roost/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Skills.tsx
git commit -m "feat(web): managed-tab search"
```

---

## Task 6: core `saveSkillsTargets`

**Files:**
- Modify: `packages/core/src/skills-catalog.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/skills-catalog.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/skills-catalog.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadSkillsTargets, saveSkillsTargets, DEFAULT_SKILLS_TARGETS } from "./skills-catalog.js";

let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cat-")); });
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

describe("saveSkillsTargets", () => {
  it("persists a custom target so loadSkillsTargets returns defaults + it", () => {
    const custom = { id: "myproj", path: "work/proj/.skills", label: "My Proj" };
    saveSkillsTargets(repo, [...DEFAULT_SKILLS_TARGETS, custom]);
    const loaded = loadSkillsTargets(repo);
    expect(loaded.find((t) => t.id === "myproj")).toEqual(custom);
    expect(loaded.filter((t) => t.id === "claude").length).toBe(1);
  });
  it("round-trips an override of a built-in target's path", () => {
    saveSkillsTargets(repo, DEFAULT_SKILLS_TARGETS.map((t) => t.id === "claude" ? { ...t, path: ".claude/x" } : t));
    expect(loadSkillsTargets(repo).find((t) => t.id === "claude")?.path).toBe(".claude/x");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/src/skills-catalog.test.ts`
Expected: FAIL — `saveSkillsTargets` not exported.

- [ ] **Step 3: Implement**

In `packages/core/src/skills-catalog.ts`, add (uses existing `overridePath`, `fs`, `path`, `yaml`):

```ts
export function saveSkillsTargets(repoDir: string, targets: SkillTarget[]): void {
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  fs.writeFileSync(overridePath(repoDir), yaml.dump({ targets }), "utf8");
}
```

In `packages/core/src/index.ts` line ~155, extend the export:
```ts
export { DEFAULT_SKILLS_TARGETS, loadSkillsTargets, saveSkillsTargets } from "./skills-catalog.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/src/skills-catalog.test.ts && pnpm --filter @roost/core build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills-catalog.ts packages/core/src/skills-catalog.test.ts packages/core/src/index.ts
git commit -m "feat(core): saveSkillsTargets (persist custom skill targets)"
```

---

## Task 7: server `POST /api/skills/catalog`

**Files:**
- Modify: `packages/cli/src/server.ts` (import + handler near `/api/skills/config` ~line 1027)
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server.test.ts`:

```ts
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
```
Ensure `loadSkillsTargets` is imported in the test (it is used elsewhere; add if missing).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/cli/src/server.test.ts -t "catalog"`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

In `server.ts`, add `saveSkillsTargets` to the `@roost/core` import block. Add after the `/api/skills/config` handler:

```ts
  // ── POST /api/skills/catalog (custom targets) ────────────────────────────────
  server.post<{ Body: { targets?: SkillTarget[] } }>("/api/skills/catalog", async (req, reply) => {
    const targets = req.body?.targets ?? [];
    saveSkillsTargets(repoDir, targets);
    cache.invalidateAll();
    return reply.send({ ok: true });
  });
```
(`SkillTarget` is already imported as a type at the top of server.ts.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/cli/src/server.test.ts`
Expected: PASS (all server tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(server): POST /api/skills/catalog (save custom targets)"
```

---

## Task 8: web api `saveSkillsTargets`

**Files:**
- Modify: `packages/web/src/api.ts`

- [ ] **Step 1: Implement**

After `getSkills` in `api.ts`:
```ts
export function saveSkillsTargets(targets: SkillTarget[]): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/skills/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targets }),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @roost/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api.ts
git commit -m "feat(web/api): saveSkillsTargets"
```

---

## Task 9: TargetManager dialog

**Files:**
- Create: `packages/web/src/views/TargetManager.tsx`
- Modify: `packages/web/src/views/Skills.tsx` (entry button in recipe bar; render dialog; refetch on save)
- Modify: `packages/web/src/i18n/strings.ts`
- Test: `packages/web/src/Skills.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("target manager: adding a custom target calls saveSkillsTargets", async () => {
  vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
  vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
  vi.mocked(api.saveSkillsTargets).mockResolvedValue({ ok: true });
  render(<Skills />);
  (await screen.findByRole("button", { name: /Manage targets|管理目标/ })).click();
  const dialog = await screen.findByRole("dialog");
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(within(dialog).getByPlaceholderText(/name|名称/i), { target: { value: "myproj" } });
  fireEvent.change(within(dialog).getByPlaceholderText(/directory|目录/i), { target: { value: "~/work/.skills" } });
  within(dialog).getByRole("button", { name: /Add|添加/ }).click();
  within(dialog).getByRole("button", { name: /Save|保存/ }).click();
  await waitFor(() => expect(api.saveSkillsTargets).toHaveBeenCalled());
  const saved = vi.mocked(api.saveSkillsTargets).mock.calls[0][0];
  expect(saved.some((t) => t.id === "myproj" && t.path === "~/work/.skills")).toBe(true);
});
```
Add `saveSkillsTargets: vi.fn().mockResolvedValue({ ok: true })` to the `vi.mock("./api", …)` factory.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @roost/web test -- Skills.test`
Expected: FAIL — no "Manage targets" button.

- [ ] **Step 3: Implement**

Add i18n:
```ts
  "skills.targets.manage": { en: "Manage targets", zh: "管理目标" },
  "skills.targets.builtin": { en: "built-in", zh: "内置" },
  "skills.targets.name": { en: "name", zh: "名称" },
  "skills.targets.dir": { en: "directory", zh: "目录" },
  "skills.targets.add": { en: "Add", zh: "添加" },
  "skills.targets.save": { en: "Save", zh: "保存" },
  "skills.targets.removeNote": { en: "Removes the target from Roost. Roost-managed links into it are cleaned up on the next apply; the directory itself is never deleted.", zh: "仅从 Roost 移除该目标。其下 Roost 自建的链接在下次应用时清理;目录本身不会被删除。" },
```

Create `packages/web/src/views/TargetManager.tsx`:

```tsx
import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import type { SkillTarget } from "../api";
import { saveSkillsTargets } from "../api";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12.5, padding: "5px 9px", borderRadius: 6, cursor: "pointer" };
const BUILTIN = new Set(["claude", "codex", "gemini", "opencode"]);
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function TargetManager({ initial, t, onClose, onSaved }: {
  initial: SkillTarget[]; t: (k: string) => string; onClose: () => void; onSaved: () => void;
}) {
  const [targets, setTargets] = useState<SkillTarget[]>(initial);
  const [name, setName] = useState(""); const [dir, setDir] = useState("");
  const [method, setMethod] = useState<"symlink" | "copy">("symlink");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const add = () => {
    const id = slug(name);
    if (!id || !dir.trim()) { setErr(t("skills.targets.name")); return; }
    if (targets.some((x) => x.id === id)) { setErr(`${id} exists`); return; }
    setTargets((ts) => [...ts, { id, path: dir.trim(), label: name.trim() }]);
    setName(""); setDir(""); setErr(null);
  };
  const save = async () => {
    setBusy(true);
    try { await saveSkillsTargets(targets); onSaved(); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div style={{ ...card, maxWidth: 520, width: "100%", padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t("skills.targets.manage")}</div>
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
          {targets.map((tg) => (
            <div key={tg.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5 }}>
              <span style={{ width: 110 }}>{tg.label}</span>
              <span className="mono" style={{ flex: 1, color: "var(--muted)" }}>{tg.path}</span>
              {BUILTIN.has(tg.id)
                ? <span style={{ color: "var(--muted)", fontSize: 11 }}>{t("skills.targets.builtin")}</span>
                : <button aria-label={`remove target ${tg.id}`} onClick={() => setTargets((ts) => ts.filter((x) => x.id !== tg.id))} style={{ ...ic, border: 0, color: "var(--accent)" }}><Trash size={14} /></button>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("skills.targets.name")} style={{ ...ic, width: 120 }} />
          <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder={t("skills.targets.dir")} style={{ ...ic, flex: 1 }} />
          <select value={method} onChange={(e) => setMethod(e.target.value as "symlink" | "copy")} style={{ ...ic }}>
            <option value="symlink">{t("skills.method.symlink")}</option>
            <option value="copy">{t("skills.method.copy")}</option>
          </select>
          <button onClick={add} style={{ ...ic }}>{t("skills.targets.add")}</button>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 12px" }}>{t("skills.targets.removeNote")}</p>
        {err && <div style={{ color: "var(--accent)", fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ ...ic, padding: "6px 12px" }}>{t("skills.resolve.cancel")}</button>
          <button onClick={() => void save()} disabled={busy} style={{ ...ic, padding: "6px 12px", color: "#fff", background: "var(--accent)", borderColor: "var(--accent)" }}>{t("skills.targets.save")}</button>
        </div>
      </div>
    </div>
  );
}
```
(`method` is captured for future per-target default; the current `SkillTarget` schema has no method field, so it's used only as the add-form default and not persisted — keep the select for UX parity; do NOT add a schema field.)

In `Skills.tsx`: add `import { TargetManager } from "./TargetManager";`, state `const [showTargets, setShowTargets] = useState(false);`, a button in the recipe bar (replace or sit beside the `{config.method} · {targets…}` text):
```tsx
        <button onClick={() => setShowTargets(true)} style={{ ...ic }}>{t("skills.targets.manage")}</button>
```
Render near the dialogs:
```tsx
      {showTargets && <TargetManager initial={targets} t={t} onClose={() => setShowTargets(false)} onSaved={() => void refetch()} />}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @roost/web test -- Skills.test` + `pnpm --filter @roost/web exec tsc --noEmit` + `pnpm --filter @roost/web build` + `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/TargetManager.tsx packages/web/src/views/Skills.tsx packages/web/src/i18n/strings.ts packages/web/src/Skills.test.tsx
git commit -m "feat(web): target manager — add/remove custom skill targets"
```

---

## Task 10: full verify + desktop rebuild

**Files:** none (verification only)

- [ ] **Step 1: Whole-repo build/lint/test**

Run:
```bash
pnpm -r build && pnpm lint && npx vitest run && pnpm --filter @roost/web test
```
Expected: all PASS.

- [ ] **Step 2: Rebuild + reinstall desktop**

```bash
pnpm build:desktop > /tmp/roost-redesign-build.log 2>&1
# wait for "Finished 2 bundles", then:
osascript -e 'quit app "Roost"' 2>/dev/null; pkill -f roost-server 2>/dev/null; sleep 1
rm -rf /Applications/Roost.app
ditto packages/web/src-tauri/target/release/bundle/macos/Roost.app /Applications/Roost.app
xattr -dr com.apple.quarantine /Applications/Roost.app
open /Applications/Roost.app; sleep 5
curl -s http://127.0.0.1:4317/api/health
```
Expected: health ok.

- [ ] **Step 3: Manual real-app check (read-only / non-destructive)**

In Skills → Managed: confirm the coverage list (no red wall), `n/m` neutral for healthy skills; open a coverage cell → per-tool popover toggles; `⋯` menu has enable/method/remove; search filters; "Manage targets" opens (do NOT add a target unless you want to mutate the real catalog). Report; do NOT push.

---

## Self-Review

**Spec coverage:** coverage cell (§3/§4) → Tasks 1–2 ✔ · per-tool popover (§4) → Task 3 ✔ · ⋯ menu move 移出/method (§4) → Task 4 ✔ · search (§1) → Task 5 ✔ · summary strip (§4) → Task 2 ✔ · color discipline (§6) → Tasks 2–3 ✔ · saveSkillsTargets (§5) → Task 6 ✔ · /api/skills/catalog (§5) → Task 7 ✔ · target manager + delete-safety note (§5) → Task 9 ✔ · no ADR (§7) → honored ✔ · tests (§8) → Tasks 1,2,3,4,5,6,7,9 ✔ · phased (§9) → task order ✔.

**Placeholder scan:** every code step has complete code; tests have real assertions. Tasks 4/9 note "update the old matrix-header test" — that's an explicit instruction with the new assertion shown.

**Type consistency:** `Coverage`/`computeCoverage`/`targetStatus` defined in Task 1 and consumed identically in Tasks 2–3. `saveSkillsTargets(repoDir, targets)` (core, Task 6) ↔ `/api/skills/catalog {targets}` (Task 7) ↔ `saveSkillsTargets(targets)` (web, Task 8) ↔ TargetManager `onSaved` (Task 9) all aligned on `SkillTarget[]`. `SkillTarget` schema unchanged (no method field added).
