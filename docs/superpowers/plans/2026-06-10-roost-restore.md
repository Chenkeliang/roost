# Roost Restore Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restore track to the onboarding wizard: after cloning an existing config repo, guide env-check → (age key) → apply-the-repo-onto-this-machine, instead of the build flow's select→capture→push.

**Architecture:** Pure web orchestration on top of the existing onboarding. `Onboarding.tsx` branches by repo content (selection non-empty) after Step 1. Two new step components (`StepAgeKey`, `StepRestore`) reuse existing endpoints (`getKey`, `postLoad` dry-run+apply, `getSyncState`/Sync Review). One additive `api.ts` type extension. No server change, no core change, no ADR.

**Tech Stack:** React + Vite + TS strict, vitest (jsdom), Phosphor icons. Tests live in `packages/web/src/*.test.tsx`, run `pnpm --filter @roost/web test -- <pattern>`. Leaf components take `t` as `(k)=>k` in tests. Stage explicitly, one commit per task, no push.

**Spec:** `docs/superpowers/specs/2026-06-10-roost-restore-design.md`

---

## Shared contracts

- `mode: "build" | "restore"` in `Onboarding`. Detection: after Step 1, `getSelection()` → restore iff any module list is non-empty.
- Restore steps: `Repo(0) · Check(1) · Key(2) · Restore(3)`. Build steps unchanged: `Repo · Check · Select · Capture · Push`.
- `StepAgeKey({ t, onDone })` — self-determining; shows guidance only when `getKey()` reports `encryptedFiles>0 && !exists`.
- `StepRestore({ t, showHud?, onComplete, onOpenSync? })` — dry-run preview → "Apply all" → onComplete; blocked → Sync Review.
- `Onboarding` gains `onOpenSync?: () => void`; `Overview` passes its existing `onOpenSync`.
- `LoadResponse` extended: `{ results: ApplyResult[]; blocked?: boolean; blockers?: { name: string; detail?: string }[] }`.

## File structure

**New:** `packages/web/src/views/onboarding/StepAgeKey.tsx`, `.../StepRestore.tsx`; tests `packages/web/src/StepAgeKey.test.tsx`, `StepRestore.test.tsx`.
**Modified:** `packages/web/src/api.ts` (LoadResponse), `.../onboarding/Onboarding.tsx` (+ `Onboarding.test.tsx` restore cases), `.../views/Overview.tsx`, `.../i18n/strings.ts`.

---

### Task 1: i18n — `onboard.restore.*` + step labels

**Files:** Modify `packages/web/src/i18n/strings.ts` (append inside the `onboard.*` block, before the closing `};`)

- [ ] **Step 1: Add the strings**

```ts
  // ── Restore track ─────────────────────────────────────────────────────────
  "onboard.step.key": { en: "Key", zh: "密钥" },
  "onboard.step.restore": { en: "Restore", zh: "恢复" },
  "onboard.restore.key.heading": { en: "Restore your encryption key", zh: "恢复你的加密密钥" },
  "onboard.restore.key.body": { en: "This repo has encrypted content. Put your backed-up keys.txt at the path below, then re-check — it is never stored in the repo.", zh: "此仓库有加密内容。把你备份的 keys.txt 放到下面的路径,然后重新检查 —— 它绝不会存在仓库里。" },
  "onboard.restore.key.path": { en: "Key file:", zh: "密钥文件:" },
  "onboard.restore.key.recheck": { en: "Re-check", zh: "重新检查" },
  "onboard.restore.key.skip": { en: "I don't have it right now", zh: "我暂时没有" },
  "onboard.restore.key.ready": { en: "Your key is in place.", zh: "密钥已就位。" },
  "onboard.restore.key.none": { en: "No encrypted content — nothing to restore here.", zh: "无加密内容 —— 这步无需操作。" },
  "onboard.restore.heading": { en: "Restore onto this machine", zh: "恢复到本机" },
  "onboard.restore.help": { en: "Preview of what will be applied from the repo. Overwrites are backed up first.", zh: "以下是将从仓库应用的内容预览。覆盖前会先备份。" },
  "onboard.restore.applyAll": { en: "Apply all", zh: "全部应用" },
  "onboard.restore.done": { en: "Restored.", zh: "已恢复。" },
  "onboard.restore.blocked": { en: "Some items need attention before they can restore:", zh: "有些项需要先处理才能恢复:" },
  "onboard.restore.openSync": { en: "Open Sync Review for item-by-item control", zh: "打开 Sync Review 逐项控制" },
  "onboard.restore.empty": { en: "Nothing to restore.", zh: "没有可恢复的内容。" },
  "onboard.restore.loading": { en: "Previewing…", zh: "预览中…" },
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @roost/web build`. Expected: PASS.
- [ ] **Step 3: Commit** — `git add packages/web/src/i18n/strings.ts && git commit -m "feat(web): onboard.restore.* i18n strings (en + zh)"`

---

### Task 2: api.ts — extend `LoadResponse`

**Files:** Modify `packages/web/src/api.ts` (the `LoadResponse` interface, ~line 52)

- [ ] **Step 1: Replace the interface**

```ts
// Server POST /api/load returns { results: ApplyResult[] }, plus { blocked, blockers }
// when a real apply is refused by the preflight hard-gate (ADR-0016 §5).
export interface LoadResponse {
  results: ApplyResult[];
  blocked?: boolean;
  blockers?: { name: string; detail?: string }[];
}
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @roost/web build`. Expected: PASS (additive optional fields; existing callers unaffected).
- [ ] **Step 3: Commit** — `git add packages/web/src/api.ts && git commit -m "feat(web): LoadResponse carries blocked/blockers"`

---

### Task 3: `StepAgeKey`

**Files:** Create `packages/web/src/views/onboarding/StepAgeKey.tsx`; Test `packages/web/src/StepAgeKey.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StepAgeKey } from "./views/onboarding/StepAgeKey";
import * as api from "./api";

vi.mock("./api", () => ({ getKey: vi.fn() }));
const t = (k: string) => k;

describe("StepAgeKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows guidance when repo has encrypted content and no local key", async () => {
    vi.mocked(api.getKey).mockResolvedValue({ exists: false, recipient: null, keyPath: "/k/keys.txt", encryptedFiles: 3 });
    const onDone = vi.fn();
    render(<StepAgeKey t={t} onDone={onDone} />);
    expect(await screen.findByText("/k/keys.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "onboard.restore.key.recheck" })).toBeInTheDocument();
    // skip advances
    screen.getByRole("button", { name: "onboard.restore.key.skip" }).click();
    expect(onDone).toHaveBeenCalled();
  });

  it("shows ready + Next when a key already exists", async () => {
    vi.mocked(api.getKey).mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k/keys.txt", encryptedFiles: 3 });
    const onDone = vi.fn();
    render(<StepAgeKey t={t} onDone={onDone} />);
    const next = await screen.findByRole("button", { name: "onboard.next" });
    next.click();
    expect(onDone).toHaveBeenCalled();
  });

  it("re-check re-queries getKey", async () => {
    vi.mocked(api.getKey)
      .mockResolvedValueOnce({ exists: false, recipient: null, keyPath: "/k/keys.txt", encryptedFiles: 1 })
      .mockResolvedValueOnce({ exists: true, recipient: "age1", keyPath: "/k/keys.txt", encryptedFiles: 1 });
    render(<StepAgeKey t={t} onDone={() => {}} />);
    (await screen.findByRole("button", { name: "onboard.restore.key.recheck" })).click();
    await waitFor(() => expect(api.getKey).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- StepAgeKey` → FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
import { useCallback, useEffect, useState } from "react";
import { getKey } from "../../api";
import type { KeyStatus } from "../../api";

const primary: React.CSSProperties = { appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" };
const ghost: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 13, padding: "7px 12px", borderRadius: 8, cursor: "pointer" };

export function StepAgeKey({ t, onDone }: { t: (k: string) => string; onDone: () => void }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const recheck = useCallback(() => {
    setChecking(true);
    getKey().then(setStatus).catch(() => {}).finally(() => setChecking(false));
  }, []);
  useEffect(() => { recheck(); }, [recheck]);

  if (!status) return <div style={{ color: "var(--muted)", fontSize: 13 }}>…</div>;

  const ready = status.encryptedFiles === 0 || status.exists;
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("onboard.restore.key.heading")}</div>
      {ready ? (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
            {status.encryptedFiles === 0 ? t("onboard.restore.key.none") : t("onboard.restore.key.ready")}
          </p>
          <button onClick={onDone} style={primary}>{t("onboard.next")}</button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>{t("onboard.restore.key.body")}</p>
          <div style={{ fontSize: 12.5, marginBottom: 12 }}>
            <span style={{ color: "var(--muted)" }}>{t("onboard.restore.key.path")} </span>
            <span className="mono" style={{ color: "var(--text)", wordBreak: "break-all" }}>{status.keyPath}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={recheck} disabled={checking} style={primary}>{checking ? "…" : t("onboard.restore.key.recheck")}</button>
            <button onClick={onDone} style={ghost}>{t("onboard.restore.key.skip")}</button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- StepAgeKey` → PASS.
- [ ] **Step 5: Commit** — `git add packages/web/src/views/onboarding/StepAgeKey.tsx packages/web/src/StepAgeKey.test.tsx && git commit -m "feat(web): onboarding StepAgeKey (restore key guidance)"`

---

### Task 4: `StepRestore`

**Files:** Create `packages/web/src/views/onboarding/StepRestore.tsx`; Test `packages/web/src/StepRestore.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StepRestore } from "./views/onboarding/StepRestore";
import * as api from "./api";

vi.mock("./api", () => ({ postLoad: vi.fn() }));
const t = (k: string) => k;

describe("StepRestore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews on mount (dry-run) and applies on Apply all → onComplete", async () => {
    vi.mocked(api.postLoad)
      .mockResolvedValueOnce({ results: [{ module: "dotfiles", applied: [], backedUp: [], skipped: ["a", "b"] }] }) // dry-run
      .mockResolvedValueOnce({ results: [{ module: "dotfiles", applied: ["a", "b"], backedUp: ["a"], skipped: [] }] }); // apply
    const onComplete = vi.fn();
    render(<StepRestore t={t} onComplete={onComplete} />);
    const apply = await screen.findByRole("button", { name: "onboard.restore.applyAll" });
    await waitFor(() => expect(api.postLoad).toHaveBeenCalledWith(false));
    apply.click();
    await waitFor(() => expect(api.postLoad).toHaveBeenCalledWith(true));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it("on a blocked apply, shows blockers and routes to Sync Review", async () => {
    vi.mocked(api.postLoad)
      .mockResolvedValueOnce({ results: [{ module: "env", applied: [], backedUp: [], skipped: ["e1"] }] })
      .mockResolvedValueOnce({ results: [], blocked: true, blockers: [{ name: "env: age key", detail: "missing key" }] });
    const onComplete = vi.fn();
    const onOpenSync = vi.fn();
    render(<StepRestore t={t} onComplete={onComplete} onOpenSync={onOpenSync} />);
    (await screen.findByRole("button", { name: "onboard.restore.applyAll" })).click();
    expect(await screen.findByText(/env: age key/)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    screen.getAllByRole("button", { name: "onboard.restore.openSync" })[0]!.click();
    expect(onOpenSync).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- StepRestore` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from "react";
import { postLoad } from "../../api";
import type { ApplyResult } from "../../api";
import type { HudMessage } from "../../components/Hud";

const primary: React.CSSProperties = { appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" };
const linkBtn: React.CSSProperties = { appearance: "none", border: "none", background: "none", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12.5, padding: 0, cursor: "pointer" };

export function StepRestore({ t, showHud, onComplete, onOpenSync }: {
  t: (k: string) => string;
  showHud?: (m: HudMessage) => void;
  onComplete: () => void;
  onOpenSync?: () => void;
}) {
  const [preview, setPreview] = useState<ApplyResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<{ name: string; detail?: string }[] | null>(null);

  useEffect(() => {
    postLoad(false).then((r) => setPreview(r.results)).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const apply = async () => {
    setBusy(true); setErr(null); setBlockers(null);
    try {
      const r = await postLoad(true);
      if (r.blocked) { setBlockers(r.blockers ?? []); }
      else { showHud?.({ text: t("onboard.restore.done"), type: "success" }); onComplete(); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const plan = (preview ?? []).map((r) => ({ module: r.module, count: r.applied.length + r.skipped.length })).filter((p) => p.count > 0);

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("onboard.restore.heading")}</div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>{t("onboard.restore.help")}</p>

      {preview === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("onboard.restore.loading")}</div>
      ) : plan.length === 0 ? (
        <div style={{ color: "var(--amber)", fontSize: 13, marginBottom: 12 }}>{t("onboard.restore.empty")}</div>
      ) : (
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden", marginBottom: 12 }}>
          {plan.map((p) => (
            <div key={p.module} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13.5 }}>
              <span style={{ minWidth: 120, textTransform: "capitalize" }}>{p.module}</span>
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{p.count}</span>
            </div>
          ))}
        </div>
      )}

      {blockers && (
        <div style={{ background: "rgba(251,191,36,0.10)", border: "1px solid var(--amber)", borderRadius: "var(--rc)", padding: "9px 12px", marginBottom: 12, fontSize: 12.5, color: "#e8cd8a" }}>
          <div style={{ marginBottom: 6 }}>{t("onboard.restore.blocked")}</div>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            {blockers.map((b, i) => (<li key={i}>{b.name}{b.detail ? ` — ${b.detail}` : ""}</li>))}
          </ul>
          <button onClick={() => onOpenSync?.()} style={linkBtn}>{t("onboard.restore.openSync")}</button>
        </div>
      )}

      {err && <div style={{ color: "var(--accent)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => void apply()} disabled={busy || preview === null} style={primary}>{busy ? "…" : t("onboard.restore.applyAll")}</button>
        <button onClick={() => onOpenSync?.()} style={linkBtn}>{t("onboard.restore.openSync")}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- StepRestore` → PASS.
- [ ] **Step 5: Commit** — `git add packages/web/src/views/onboarding/StepRestore.tsx packages/web/src/StepRestore.test.tsx && git commit -m "feat(web): onboarding StepRestore (dry-run preview → apply-all + Sync Review)"`

---

### Task 5: `Onboarding` branching (build vs restore)

**Files:** Modify `packages/web/src/views/onboarding/Onboarding.tsx`; Test `packages/web/src/Onboarding.test.tsx` (add restore-branch case)

- [ ] **Step 1: Write the failing test** (append a new `it` to the existing `describe("Onboarding flow", ...)` — add `getSelection`/`getKey`/`postLoad` to the existing mock factory if not present; the existing factory already mocks `getSelection`/`getKey`, add `postLoad`)

Add `postLoad: vi.fn()` to the `vi.mock("./api", () => ({ ... }))` factory in `Onboarding.test.tsx`, then add:

```tsx
  it("branches to the restore track when the cloned repo already has a selection", async () => {
    // existing repo with content → restore
    vi.mocked(api.getSelection).mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["a"] } });
    vi.mocked(api.getKey).mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k", encryptedFiles: 0 });
    vi.mocked(api.postLoad).mockResolvedValue({ results: [{ module: "dotfiles", applied: [], backedUp: [], skipped: ["a"] }] });
    const onComplete = vi.fn();
    render(<Onboarding t={t} onComplete={onComplete} />);

    // Step 1: clone path
    screen.getByRole("button", { name: "onboard.repo.cloneTab" }).click();
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByPlaceholderText("onboard.repo.cloneUrl"), { target: { value: "git@x:y.git" } });
    screen.getByRole("button", { name: "onboard.repo.cloneBtn" }).click();
    await waitFor(() => expect(api.postClone).toHaveBeenCalled());

    // Step 2: check → Next
    const next = await screen.findByRole("button", { name: "onboard.next" });
    await waitFor(() => expect(next).not.toBeDisabled());
    next.click();

    // Step 3 (restore): age key auto-ready (encryptedFiles:0) → Next
    (await screen.findByRole("button", { name: "onboard.next" })).click();

    // Step 4 (restore): the Apply-all button proves we're on the restore track, NOT capture
    expect(await screen.findByRole("button", { name: "onboard.restore.applyAll" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "onboard.capture.btn" })).toBeNull();
  });
```

(Ensure the existing mock has `postClone: vi.fn().mockResolvedValue({ ok: true })`.)

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- Onboarding` → FAIL (no restore branch).

- [ ] **Step 3: Implement** — rewrite `Onboarding.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getGitStatus, gitPush, getSelection } from "../../api";
import type { HudMessage } from "../../components/Hud";
import { Setup } from "../Setup";
import { StepRepo } from "./StepRepo";
import { StepSelect } from "./StepSelect";
import { StepCapture } from "./StepCapture";
import { StepAgeKey } from "./StepAgeKey";
import { StepRestore } from "./StepRestore";

const BUILD_STEPS = ["onboard.step.repo", "onboard.step.check", "onboard.step.select", "onboard.step.capture", "onboard.step.push"];
const RESTORE_STEPS = ["onboard.step.repo", "onboard.step.check", "onboard.step.key", "onboard.step.restore"];

export function Onboarding({ t, showHud, onComplete, onOpenSync }: {
  t: (k: string) => string;
  showHud?: (m: HudMessage) => void;
  onComplete: () => void;
  onOpenSync?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"build" | "restore">("build");
  const [remote, setRemote] = useState<string | null>(null);
  const [envReady, setEnvReady] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);

  const refreshGit = () => { void getGitStatus().then((s) => setRemote(s.remote)).catch(() => {}); };
  useEffect(() => { refreshGit(); }, []);

  // After the repo step: an existing repo (non-empty selection) → restore; else build.
  const afterRepo = () => {
    refreshGit();
    void getSelection()
      .then((s) => setMode(Object.values(s.modules).some((ids) => ids.length > 0) ? "restore" : "build"))
      .catch(() => setMode("build"));
    setStep(1);
  };

  const push = async () => {
    setPushBusy(true); setPushErr(null);
    try {
      const r = await gitPush();
      if (r.ok) { showHud?.({ text: t("onboard.push.done"), type: "success" }); onComplete(); }
      else setPushErr(r.hint === "auth" ? t("onboard.push.auth") : r.output || t("onboard.push.failed"));
    } catch (e) { setPushErr(e instanceof Error ? e.message : String(e)); }
    finally { setPushBusy(false); }
  };

  const primary: React.CSSProperties = { appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" };

  const stepKeys = mode === "restore" ? RESTORE_STEPS : BUILD_STEPS;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ fontSize: 16, fontWeight: 600, margin: "8px 0 14px" }}>{t("onboard.title")}</div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {stepKeys.map((k, i) => (
          <span key={k} style={{ fontSize: 11.5, padding: "4px 11px", borderRadius: 20, background: i === step ? "var(--accent)" : i < step ? "var(--green)" : "var(--raise)", color: i === step ? "#fff" : i < step ? "#0b0b0d" : "var(--muted)" }}>
            {i + 1} · {t(k)}
          </span>
        ))}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", padding: 18 }}>
        {step === 0 && <StepRepo t={t} showHud={showHud} onDone={afterRepo} />}
        {step === 1 && (
          <div>
            <Setup embedded onReady={setEnvReady} />
            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setStep(2)} disabled={!envReady} style={{ ...primary, opacity: envReady ? 1 : 0.6, cursor: envReady ? "pointer" : "not-allowed" }}>{t("onboard.next")}</button>
            </div>
          </div>
        )}

        {/* Build track */}
        {step === 2 && mode === "build" && <StepSelect t={t} showHud={showHud} onDone={() => setStep(3)} />}
        {step === 3 && mode === "build" && <StepCapture t={t} showHud={showHud} onDone={() => setStep(4)} />}
        {step === 4 && mode === "build" && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("onboard.push.heading")}</div>
            {remote ? (
              <>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>{t("onboard.push.ready")} <span className="mono" style={{ color: "var(--text)" }}>{remote}</span></p>
                <button onClick={() => void push()} disabled={pushBusy} style={primary}>{pushBusy ? "…" : t("onboard.push.btn")}</button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--amber)", margin: "0 0 12px" }}>{t("onboard.push.localOnly")}</p>
                <button onClick={onComplete} style={primary}>{t("onboard.finish")}</button>
              </>
            )}
            {pushErr && <div style={{ color: "var(--accent)", fontSize: 12.5, marginTop: 10 }}>{pushErr}</div>}
          </div>
        )}

        {/* Restore track */}
        {step === 2 && mode === "restore" && <StepAgeKey t={t} onDone={() => setStep(3)} />}
        {step === 3 && mode === "restore" && <StepRestore t={t} showHud={showHud} onComplete={onComplete} onOpenSync={onOpenSync} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- Onboarding` → PASS (restore-branch case + existing build happy-path).
- [ ] **Step 5: Commit** — `git add packages/web/src/views/onboarding/Onboarding.tsx packages/web/src/Onboarding.test.tsx && git commit -m "feat(web): Onboarding branches to restore track on existing repo"`

---

### Task 6: Wire `onOpenSync` from Overview

**Files:** Modify `packages/web/src/views/Overview.tsx` (the no-repo gate return, ~line 208)

- [ ] **Step 1: Pass the prop** — change:

```tsx
    return <Onboarding t={t} showHud={showHud} onComplete={() => void fetchData()} />;
```
to:
```tsx
    return <Onboarding t={t} showHud={showHud} onComplete={() => void fetchData()} onOpenSync={onOpenSync} />;
```
(`onOpenSync` is already a destructured prop of `Overview`, line 92.)

- [ ] **Step 2: Verify** — `pnpm --filter @roost/web test -- OnboardingGate` and `pnpm --filter @roost/web build` → PASS.
- [ ] **Step 3: Commit** — `git add packages/web/src/views/Overview.tsx && git commit -m "feat(web): pass onOpenSync into Onboarding for restore→Sync Review"`

---

### Task 7: Full verification

- [ ] **Step 1:** `pnpm -r build` → PASS.
- [ ] **Step 2:** `pnpm lint` → clean.
- [ ] **Step 3:** `pnpm --filter @roost/web test` → all green (existing + new StepAgeKey/StepRestore/Onboarding-restore).
- [ ] **Step 4:** `pnpm test` (core/cli/shared) → green (unchanged).
- [ ] **Step 5:** `pnpm build:sidecar` → both-arch bundles build.

---

## Self-Review

**1. Spec coverage:** branching by selection → Task 5 ✓; restore steps Key/Restore → Tasks 3, 4 ✓; age-key detect+guide+skip → Task 3 ✓; dry-run preview → apply-all + Sync Review → Task 4 ✓; reuse endpoints, no server/core → ✓; i18n → Task 1 ✓; `onOpenSync` wiring → Task 6 ✓; tests → each task TDD + Task 7 ✓.

**Spec refinement:** the spec said "no `api.ts` changes"; in fact `LoadResponse` needs an **additive optional** `blocked?`/`blockers?` (Task 2) to read the gated-apply response — a faithful refinement, not a scope change.

**2. Placeholder scan:** none. All code complete.

**3. Type consistency:** `mode`/`stepKeys`/`afterRepo` consistent across Task 5. `StepAgeKey({t,onDone})`, `StepRestore({t,showHud?,onComplete,onOpenSync?})` props match their usage in Onboarding (Task 5) and tests (Tasks 3, 4). `LoadResponse.blocked/blockers` (Task 2) consumed in StepRestore (Task 4). `KeyStatus` fields (`exists`/`encryptedFiles`/`keyPath`) match api.ts. `onOpenSync` flows Overview (Task 6) → Onboarding (Task 5) → StepRestore (Task 4).
