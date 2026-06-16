# Secret-Protection Guidance UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop reporting "no age key" as the only way to protect a secret — present the user's real options per surface (env: age | 1Password | rbw; files: generate key | skip), with honest copy and consistent consent.

**Architecture:** Mostly-web (React/TS strict) changes on the Env page (`AliasesEnv.tsx`), the Overview capture-blocked card (`Overview.tsx`), and onboarding (`StepCapture.tsx`), plus one additive core change (two non-required `op`/`rbw` doctor checks in `environment.ts`). Driven by signals already on the wire (`HealthResponse.ageKey`, `ChangeSet.blockedDetail`, `EnvSecretSource`, `EnvCheck[]`) and the existing `KeyBackupConfirm` consent modal.

**Tech Stack:** React 18, TS strict, vitest + @testing-library/react (jsdom), Phosphor icons, flat i18n table (`i18n/strings.ts`, no interpolation — concatenate in JSX), coral reserved for exceptions.

**Spec:** `docs/superpowers/specs/2026-06-16-roost-secret-guidance-ux-design.md`. **No ADR** (presentation/interaction only; I6 + ADR-0004 mechanisms untouched).

**Conventions for every task:** TS strict; web component tests live at `packages/web/src/<Name>.test.tsx` and mock `./api` via `vi.mock`; run web tests with `pnpm --filter @roost/web test`; core tests with `npx vitest run <path>` from the repo root; lint `pnpm lint`; typecheck `pnpm -r typecheck` (web build is vite-only, so typecheck is a SEPARATE mandatory gate). Default render locale is `en`, so component tests assert English strings. Stage files explicitly (`git add <paths>`); one commit per task; do not push.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `packages/web/src/i18n/strings.ts` | all new bilingual keys | 1 |
| `packages/web/src/views/AliasesEnv.tsx` | env-page key awareness, no-key/stored notes, save-400 guard, backend-missing note | 2, 3, 7 |
| `packages/web/src/App.tsx` | pass `onOpenSettings` to `AliasesEnv` | 2 |
| `packages/web/src/AliasesEnv.test.tsx` (new) | env-page tests | 2, 3, 7 |
| `packages/web/src/views/Overview.tsx` | de-mislabel title/HUD, module tracking, no-key row + remedy cluster + `KeyBackupConfirm` reuse | 4, 5 |
| `packages/web/src/Overview.test.tsx` (new) | Overview blocked-card tests | 4, 5 |
| `packages/core/src/environment.ts` | add `op`/`rbw` non-required checks | 6 |
| `packages/core/src/environment.test.ts` | op/rbw check test | 6 |
| `packages/web/src/views/onboarding/StepCapture.tsx` | ref-hint line | 8 |
| `packages/web/src/StepCapture.test.tsx` (new) | onboarding hint test | 8 |

---

## Task 1: Add all i18n strings

**Files:**
- Modify: `packages/web/src/i18n/strings.ts`

- [ ] **Step 1: Add the new keys**

Insert these entries into the `STRINGS` object (anywhere inside the object literal; group them together). Every key MUST have both `en` and `zh`:

```ts
  // ── Secret-protection guidance (age vs ref) — env page ───────────────────
  "env.key.missingNotePrefix": { en: "No age key on this Mac — ", zh: "本机没有 age 私钥 —— " },
  "env.key.missingNoteSettings": { en: "generate or import one in Settings", zh: "去设置生成或导入" },
  "env.key.missingNoteSuffix": { en: ", or switch the source to a 1Password / rbw reference (no key needed).", zh: ",或把来源改为 1Password / rbw 引用(无需私钥)。" },
  "env.key.storedNoKeyPrefix": { en: "Encrypted, but this Mac has no key — it can't be decrypted on apply. ", zh: "已加密保存,但本机无私钥,apply 时无法解密。" },
  "env.key.storedNoKeySettings": { en: "Import the key in Settings", zh: "去设置导入私钥" },
  "env.ref.backendMissing": { en: " is not installed — this reference can't be resolved on apply.", zh: " 未安装 —— apply 时无法解析此引用。" },
  // ── Overview capture-blocked card ────────────────────────────────────────
  "overview.blockedTitleNeutral": { en: "items need attention", zh: "项待处理" },
  "overview.blocked.noKey": { en: "age key required", zh: "缺 age 私钥" },
  "overview.blocked.noKeyHint": { en: "Sensitive files can only be backed up age-encrypted.", zh: "敏感文件只能用 age 加密备份。" },
  "overview.blocked.generateRetry": { en: "Generate key & retry", zh: "生成密钥并重试" },
  "overview.blocked.importInSettings": { en: "Import in Settings", zh: "去设置导入" },
  "overview.blocked.skipForNow": { en: "Skip for now", zh: "暂不备份" },
  "overview.key.needAgeBinary": { en: "Install age first (Setup), then generate a key.", zh: "请先安装 age(设置检查),再生成密钥。" },
  // ── Onboarding capture ───────────────────────────────────────────────────
  "onboard.capture.refHint": { en: "Secrets will be age-encrypted; you can switch any to a 1Password / rbw reference later on the Env page.", zh: "密钥项将用 age 加密;之后可在 env 页把任意一项改为 1Password / rbw 引用。" },
```

- [ ] **Step 2: Run the i18n + web suite to verify nothing broke**

Run: `pnpm --filter @roost/web test`
Expected: PASS (existing `i18n/i18n.test.tsx` and all suites green; if that test asserts en/zh parity it now covers the new keys).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/i18n/strings.ts
git commit -m "feat(web): i18n strings for secret-protection guidance"
```

---

## Task 2: Env page — age-key awareness + no-key / stored-no-key notes

**Files:**
- Modify: `packages/web/src/views/AliasesEnv.tsx` (props, health fetch, `EnvEditor` hint block, call site)
- Modify: `packages/web/src/App.tsx:282`
- Create: `packages/web/src/AliasesEnv.test.tsx`

**Scene:** `EnvEditor` (AliasesEnv.tsx:240-352) renders a secret editor with a source picker (`age`/`ref:op`/`ref:rbw`) and a bottom hint (lines 345-349). The root `AliasesEnv` (line 618) fetches `getEnv()` in `fetchData` (633-645). When `source=age` and there's no age key, saving fails — but the page currently gives no proactive hint. This task adds key awareness and the dual-option note.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/AliasesEnv.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { AliasesEnv } from "./views/AliasesEnv";

const ageSecretEnv = {
  schemaVersion: 1, aliases: [], path: [], functions: [],
  env: [{ kind: "env", name: "TOKEN", value: "", secret: true, source: { kind: "age" }, enabled: true }],
};

vi.mock("./api", () => ({
  getEnv: vi.fn(),
  putEnv: vi.fn(),
  getDiscover: vi.fn().mockResolvedValue({ candidates: { env: [] } }),
  applyEnv: vi.fn(),
  getHealth: vi.fn(),
  getEnvironment: vi.fn().mockResolvedValue({ checks: [] }),
}));
import { getEnv, getHealth } from "./api";

async function renderEnv() {
  await act(async () => { render(<AliasesEnv onOpenSettings={() => {}} />); });
  // open the TOKEN row so its editor (and hint) mounts
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "edit env TOKEN" })); });
}

describe("AliasesEnv — no age key guidance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the dual-option note for an age secret when no key exists", async () => {
    (getEnv as ReturnType<typeof vi.fn>).mockResolvedValue(ageSecretEnv);
    (getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, name: "r", ageKey: false });
    await renderEnv();
    await waitFor(() => expect(screen.getByText(/No age key on this Mac/)).toBeInTheDocument());
    expect(screen.getByText(/switch the source to a 1Password \/ rbw reference/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "generate or import one in Settings" })).toBeInTheDocument();
  });

  it("hides the note when an age key exists", async () => {
    (getEnv as ReturnType<typeof vi.fn>).mockResolvedValue(ageSecretEnv);
    (getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, name: "r", ageKey: true });
    await renderEnv();
    await waitFor(() => expect(screen.getByLabelText("env name TOKEN")).toBeInTheDocument());
    expect(screen.queryByText(/No age key on this Mac/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @roost/web test -- AliasesEnv`
Expected: FAIL (AliasesEnv has no `onOpenSettings` prop / no note / no `getHealth` call yet).

- [ ] **Step 3: Add the link-button style + extend `EnvEditor`**

In `AliasesEnv.tsx`, add this style constant next to `hintStyle` (after line 469):

```ts
const linkBtnStyle: React.CSSProperties = {
  appearance: "none", background: "none", border: "none", padding: 0,
  color: "var(--accent)", cursor: "pointer", font: "inherit", textDecoration: "underline",
};
```

Change the `EnvEditor` signature (line 240) to accept key awareness:

```tsx
function EnvEditor({
  item,
  onChange,
  t,
  ageKey,
  onOpenSettings,
}: {
  item: EnvVarItem;
  onChange: (next: Partial<EnvVarItem>) => void;
  t: (key: string) => string;
  ageKey: boolean;
  onOpenSettings?: () => void;
}) {
```

Replace the bottom hint block (current lines 345-349) with:

```tsx
      {item.secret && (
        <div style={hintStyle}>
          {isRef ? (
            t("env.secret.hint.ref")
          ) : !ageKey ? (
            isStoredSecret ? (
              <>
                {t("env.key.storedNoKeyPrefix")}{" "}
                {onOpenSettings && (
                  <button type="button" onClick={onOpenSettings} style={linkBtnStyle}>
                    {t("env.key.storedNoKeySettings")}
                  </button>
                )}
              </>
            ) : (
              <>
                {t("env.key.missingNotePrefix")}
                {onOpenSettings && (
                  <button type="button" onClick={onOpenSettings} style={linkBtnStyle}>
                    {t("env.key.missingNoteSettings")}
                  </button>
                )}
                {t("env.key.missingNoteSuffix")}
              </>
            )
          ) : (
            t("env.secret.hint.age")
          )}
        </div>
      )}
```

- [ ] **Step 4: Wire the root component (props + health fetch + call site)**

In `AliasesEnv.tsx`:

Extend the props interface (line 29):
```tsx
interface AliasesEnvProps {
  showHud?: (msg: HudMessage) => void;
  onOpenSettings?: () => void;
}
```

Add `getHealth` to the api import (line 27):
```tsx
import { getEnv, putEnv, getDiscover, applyEnv, getHealth } from "../api";
```

Change the component signature (line 618) and add `ageKey` state:
```tsx
export function AliasesEnv({ showHud, onOpenSettings }: AliasesEnvProps) {
  const { t } = useT();
  const [data, setData] = useState<EnvData | null>(null);
  const [serverData, setServerData] = useState<EnvData | null>(null);
  const [ageKey, setAgeKey] = useState(false);
```

Update `fetchData` (lines 633-645) to fetch health alongside env:
```tsx
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [env, h] = await Promise.all([getEnv(), getHealth().catch(() => null)]);
      setData(env);
      setServerData(env);
      setAgeKey(h?.ageKey ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
```

Pass the props at the `EnvEditor` call site (current lines 1320-1325):
```tsx
                    {ref.kind === "env" && (
                      <EnvEditor
                        item={item as EnvVarItem}
                        onChange={(next) => patchEnv(ref.idx, next)}
                        t={t}
                        ageKey={ageKey}
                        onOpenSettings={onOpenSettings}
                      />
                    )}
```

In `App.tsx` line 282:
```tsx
          {activeTab === "env" && <AliasesEnv showHud={showHud} onOpenSettings={() => setActiveTab("settings")} />}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @roost/web test -- AliasesEnv`
Expected: PASS (both tests).

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/views/AliasesEnv.tsx packages/web/src/App.tsx packages/web/src/AliasesEnv.test.tsx
git commit -m "feat(web): env page surfaces age-key-missing with age|ref options"
```

---

## Task 3: Env page — graceful save-400 ("no age key")

**Files:**
- Modify: `packages/web/src/views/AliasesEnv.tsx` (the `save` callback, lines 656-669)
- Modify: `packages/web/src/AliasesEnv.test.tsx`

**Scene:** `PUT /api/env` returns `400 { error: "cannot encrypt secret \"X\": no age key available" }` when an age secret with a value is saved without a key (`server.ts:1002`). `apiFetch` throws `Error(body.error)` (`api.ts:62-70`). The `save` catch (line 664-666) currently shows that raw string. This task shows the localized dual-option message instead.

- [ ] **Step 1: Write the failing test**

Append to `packages/web/src/AliasesEnv.test.tsx`:

```tsx
import { putEnv } from "./api";

describe("AliasesEnv — save with no age key", () => {
  beforeEach(() => vi.clearAllMocks());

  it("translates a 'no age key' 400 into the dual-option HUD message", async () => {
    const dirtyEnv = {
      schemaVersion: 1, aliases: [], path: [], functions: [],
      env: [{ kind: "env", name: "TOKEN", value: "", secret: true, source: { kind: "age" }, enabled: true }],
    };
    (getEnv as ReturnType<typeof vi.fn>).mockResolvedValue(dirtyEnv);
    (getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, name: "r", ageKey: false });
    (putEnv as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cannot encrypt secret "TOKEN": no age key available'),
    );
    const showHud = vi.fn();
    await act(async () => { render(<AliasesEnv showHud={showHud} onOpenSettings={() => {}} />); });
    // type a value so the page is dirty + the secret carries plaintext
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "edit env TOKEN" })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("env value TOKEN"), { target: { value: "sk-123" } });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save/ })); });
    await waitFor(() =>
      expect(showHud).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", text: expect.stringContaining("No age key on this Mac") }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @roost/web test -- AliasesEnv`
Expected: FAIL (HUD shows the raw `cannot encrypt…` string, not "No age key on this Mac").

- [ ] **Step 3: Add the guard in `save`**

Replace the `catch` in the `save` callback (lines 664-666) with:

```tsx
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const text = /no age key/i.test(msg)
        ? t("env.key.missingNotePrefix") + t("env.key.missingNoteSettings") + t("env.key.missingNoteSuffix")
        : (msg || t("env.hud.saveFailed"));
      showHud?.({ text, type: "error" });
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @roost/web test -- AliasesEnv`
Expected: PASS (all AliasesEnv tests).

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `pnpm -r typecheck && pnpm lint`
Expected: PASS.

```bash
git add packages/web/src/views/AliasesEnv.tsx packages/web/src/AliasesEnv.test.tsx
git commit -m "feat(web): env save shows age|ref options when the key is missing"
```

---

## Task 4: Overview — module tracking + de-mislabel title/HUD

**Files:**
- Modify: `packages/web/src/views/Overview.tsx` (state type, `handleCapture`, `handleEncryptRetry`, section title)
- Create: `packages/web/src/Overview.test.tsx`

**Scene:** `Overview` (line 111) holds `blockedDetail: BlockedItem[]` and renders a card titled `overview.blockedTitle` ("潜在密钥/potential secrets", line 450). `handleCapture` (170-190) flattens `c.blockedDetail` losing the module, and its HUD always says "potential secrets" (line 180). This task (a) preserves the originating module per blocked item (needed by Task 5's skip action) and (b) makes the title + HUD reason-aware.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/Overview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { Overview } from "./views/Overview";

const okHealth = { ok: true, name: "roost", ageKey: false };
const empty = { reports: [] };

vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "roost", ageKey: false }),
  getMachines: vi.fn().mockResolvedValue({ hosts: [] }),
  getStatus: vi.fn().mockResolvedValue({ reports: [] }),
  postCapture: vi.fn(),
  getEnvironment: vi.fn().mockResolvedValue({ checks: [] }),
  getGitStatus: vi.fn().mockResolvedValue({ ahead: 0, behind: 0, dirty: false }),
  getBackupStatus: vi.fn().mockResolvedValue({ backups: [] }),
  getSettings: vi.fn().mockResolvedValue({ checkUpdates: false }),
  addSelection: vi.fn().mockResolvedValue({}),
  removeSelection: vi.fn().mockResolvedValue({}),
  excludeDotfile: vi.fn().mockResolvedValue({}),
  generateKey: vi.fn(),
}));
import { postCapture } from "./api";

function captureResult(blockedDetail: { id: string; reason: string; detail?: string }[]) {
  return { changes: [{ module: "dotfiles", written: [], encrypted: [], blocked: blockedDetail.map((b) => b.id), blockedDetail }] };
}

async function captureWith(detail: { id: string; reason: string; detail?: string }[]) {
  (postCapture as ReturnType<typeof vi.fn>).mockResolvedValue(captureResult(detail));
  const showHud = vi.fn();
  await act(async () => { render(<Overview showHud={showHud} onOpenSetup={() => {}} />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Capture|备份|Back up/i })); });
  return showHud;
}

describe("Overview — blocked card labelling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the neutral title + non-secret HUD when no item is a secret", async () => {
    const showHud = await captureWith([{ id: "/h/.aws/credentials", reason: "error", detail: "no age key" }]);
    await waitFor(() => expect(screen.getByText("items need attention")).toBeInTheDocument());
    expect(showHud).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("need attention") }),
    );
    expect(screen.queryByText("items blocked — potential secrets")).toBeNull();
  });

  it("keeps the potential-secrets title when a secret item is present", async () => {
    await captureWith([{ id: "/h/.npmrc", reason: "secret", detail: "1 file(s)" }]);
    await waitFor(() => expect(screen.getByText("items blocked — potential secrets")).toBeInTheDocument());
  });
});
```

> Note: the capture button's accessible name is whatever the existing UI uses; the implementer should match it (search Overview.tsx for the capture button label key, e.g. `overview.capture`). Adjust the `name` regex in `captureWith` to that English string.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @roost/web test -- Overview`
Expected: FAIL ("items need attention" not rendered; title always "potential secrets").

- [ ] **Step 3: Track module on blocked state + reason-aware HUD**

In `Overview.tsx`, change the state declaration (line 122):
```tsx
  const [blockedDetail, setBlockedDetail] = useState<(BlockedItem & { module: string })[]>([]);
```

In `handleCapture` (lines 173-184) replace the body up to the `showHud` call with:
```tsx
      const result = await postCapture();
      const blockedPaths = result.changes.flatMap((c) => c.blocked ?? []);
      const details = result.changes.flatMap((c) =>
        (c.blockedDetail ?? []).map((b) => ({ ...b, module: c.module })),
      );
      setBlocked(blockedPaths);
      setBlockedDetail(details);
      const written = result.changes.reduce((n, c) => n + c.written.length + c.encrypted.length, 0);
      const hasSecret = details.some((b) => b.reason === "secret");
      showHud({
        text: blockedPaths.length > 0
          ? (hasSecret
              ? `Captured ${written} · ${blockedPaths.length} blocked (potential secrets)`
              : `Captured ${written} · ${blockedPaths.length} need attention`)
          : `Captured ${written} item${written === 1 ? "" : "s"}`,
        type: blockedPaths.length > 0 ? "error" : "success",
      });
      void fetchData();
```

In `handleEncryptRetry` (line 201) replace the `setBlockedDetail` line with the module-preserving form:
```tsx
      setBlockedDetail(result.changes.flatMap((c) =>
        (c.blockedDetail ?? []).map((b) => ({ ...b, module: c.module })),
      ));
```

- [ ] **Step 4: Make the section title reason-aware**

In the blocked `<section>` header (lines 449-451), replace:
```tsx
            <span style={{ fontSize: 14, fontWeight: 540, color: "var(--text)" }}>
              {blockedDetail.length} {t("overview.blockedTitle")}
            </span>
```
with:
```tsx
            <span style={{ fontSize: 14, fontWeight: 540, color: "var(--text)" }}>
              {blockedDetail.length}{" "}
              {blockedDetail.some((b) => b.reason === "secret")
                ? t("overview.blockedTitle")
                : t("overview.blockedTitleNeutral")}
            </span>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @roost/web test -- Overview`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `pnpm -r typecheck && pnpm lint`
Expected: PASS.

```bash
git add packages/web/src/views/Overview.tsx packages/web/src/Overview.test.tsx
git commit -m "feat(web): overview blocked card — track module, de-mislabel non-secret blocks"
```

---

## Task 5: Overview — no-key row label/hint + remedy cluster (generate via KeyBackupConfirm, import, skip)

**Files:**
- Modify: `packages/web/src/views/Overview.tsx` (imports, state, handlers, reason label, detail line, remedy cluster, modal)
- Modify: `packages/web/src/Overview.test.tsx`

**Scene:** Blocked rows render a reason label (Overview.tsx:464-469), a muted detail line (474-477), and per-reason action buttons (479-521). A `no age key` item currently shows raw `error · no age key` with no action. This task adds a localized label + honest hint, and a disciplined remedy cluster: primary **Generate key & retry** (reuses `KeyBackupConfirm`), plus **Import in Settings** and **Skip for now** links. Files are age-only — no ref option is offered (spec §10).

- [ ] **Step 1: Write the failing test**

Append to `packages/web/src/Overview.test.tsx`:

```tsx
import { generateKey } from "./api";

describe("Overview — no-key remedy cluster", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the no-key label, hint, and Generate key & retry button", async () => {
    await captureWith([{ id: "/h/.aws/credentials", reason: "error", detail: "no age key" }]);
    await waitFor(() => expect(screen.getByText("age key required")).toBeInTheDocument());
    expect(screen.getByText("Sensitive files can only be backed up age-encrypted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate key & retry" })).toBeInTheDocument();
    // raw "no age key" string must NOT be shown
    expect(screen.queryByText(/· no age key/)).toBeNull();
  });

  it("Generate key & retry calls generateKey then shows the backup-confirm modal", async () => {
    (generateKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: true, source: "generated", recipient: "age1xyz", keyPath: "/h/.config/sops/age/keys.txt",
    });
    await captureWith([{ id: "/h/.aws/credentials", reason: "error", detail: "no age key" }]);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Generate key & retry" }));
    });
    await waitFor(() => expect(generateKey).toHaveBeenCalledOnce());
    // KeyBackupConfirm shows the key path + a disabled Continue until ack
    expect(screen.getByText("/h/.config/sops/age/keys.txt")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @roost/web test -- Overview`
Expected: FAIL (no "age key required" label / no Generate button).

- [ ] **Step 3: Imports, state, predicate, handlers**

In `Overview.tsx`, add to the api import block (lines 10-28): `generateKey,`. Add the component import near the top:
```tsx
import { KeyBackupConfirm } from "../components/KeyBackupConfirm";
```

Add state next to the others (after line 126):
```tsx
  const [keygen, setKeygen] = useState<{ recipient: string | null; keyPath: string } | null>(null);
```

Add a predicate and two handlers (after `handleRemoveBlocked`, ~line 228):
```tsx
  const isNoKey = (b: { reason: string; detail?: string }) =>
    b.reason === "error" && b.detail === "no age key";

  // Generate the age key, then require an explicit backup acknowledgement
  // (KeyBackupConfirm) before re-capturing. age-binary presence is checked at
  // the call site so this only runs when generation can succeed.
  const handleGenerateKey = async () => {
    setRetrying(true);
    try {
      const gen = await generateKey();
      setKeygen({ recipient: gen.recipient, keyPath: gen.keyPath });
    } catch (e) {
      showHud({ text: e instanceof Error ? e.message : "Generate key failed", type: "error" });
    } finally {
      setRetrying(false);
    }
  };

  // "Skip for now": stop tracking this item in its module so capture won't
  // attempt it. Respects the user's choice not to back it up.
  const handleSkipBlocked = async (b: { id: string; module: string }) => {
    try {
      await removeSelection(b.module, b.id);
      setBlockedDetail((prev) => prev.filter((x) => x.id !== b.id));
      setBlocked((prev) => prev.filter((p) => p !== b.id));
      await fetchData();
    } catch (e) {
      showHud({ text: e instanceof Error ? e.message : "Skip failed", type: "error" });
    }
  };
```

- [ ] **Step 4: Add a small text-link button style**

Near the top of `Overview.tsx` (module scope, after the imports), add:
```tsx
const blockedActionBtn: React.CSSProperties = {
  appearance: "none", border: "1px solid var(--border)", background: "var(--raise)",
  color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 9px",
  borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
};
const blockedLinkBtn: React.CSSProperties = {
  appearance: "none", border: "none", background: "none", padding: 0,
  color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12.5, cursor: "pointer",
  textDecoration: "underline",
};
```

- [ ] **Step 5: Label + hint for the no-key row**

In the `reasonLabel` chain (lines 464-469), add the no-key branch before the final fallback:
```tsx
            const reasonLabel =
              item.reason === "secret" ? t("overview.blocked.secret")
              : item.reason === "too-large" ? t("overview.blocked.tooLarge")
              : item.reason === "managed" ? t("overview.blocked.managed")
              : item.reason === "large" ? t("overview.blocked.large")
              : isNoKey(item) ? t("overview.blocked.noKey")
              : t("overview.blocked.error");
```

Replace the muted detail line (lines 474-477) so the raw "no age key" is suppressed and the honest hint is appended:
```tsx
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {reasonLabel}{item.detail && !isNoKey(item) ? ` · ${item.detail}` : ""}
                    {item.reason === "too-large" ? ` · ${t("overview.blocked.raiseLimit")}` : ""}
                    {isNoKey(item) ? ` · ${t("overview.blocked.noKeyHint")}` : ""}
                  </div>
```

- [ ] **Step 6: Remedy cluster**

After the `large` action block (after current line 521, still inside the row, before the closing `</div>` of the row), add:
```tsx
                {isNoKey(item) && (
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    {missingDeps.includes("age") ? (
                      <button onClick={() => onOpenSetup?.()} style={blockedLinkBtn}>
                        {t("overview.key.needAgeBinary")}
                      </button>
                    ) : (
                      <button onClick={() => void handleGenerateKey()} disabled={retrying} style={blockedActionBtn}>
                        <Lock size={11} />{t("overview.blocked.generateRetry")}
                      </button>
                    )}
                    <button onClick={() => onOpenSetup?.()} style={blockedLinkBtn}>
                      {t("overview.blocked.importInSettings")}
                    </button>
                    <button onClick={() => void handleSkipBlocked(item)} style={blockedLinkBtn}>
                      {t("overview.blocked.skipForNow")}
                    </button>
                  </span>
                )}
```

- [ ] **Step 7: Render the consent modal**

Immediately after the closing `</section>` of the `blockedDetail.length > 0` branch (after current line 525), add the modal (it renders over everything when `keygen` is set):
```tsx
      {keygen && (
        <KeyBackupConfirm
          recipient={keygen.recipient}
          keyPath={keygen.keyPath}
          t={t}
          onConfirm={() => { setKeygen(null); void handleCapture(); }}
        />
      )}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @roost/web test -- Overview`
Expected: PASS (all Overview tests).

- [ ] **Step 9: Typecheck + lint, then commit**

Run: `pnpm -r typecheck && pnpm lint`
Expected: PASS.

```bash
git add packages/web/src/views/Overview.tsx packages/web/src/Overview.test.tsx
git commit -m "feat(web): overview no-key blocks get generate/import/skip remedies"
```

---

## Task 6: Core — `op` / `rbw` availability checks

**Files:**
- Modify: `packages/core/src/environment.ts`
- Modify: `packages/core/src/environment.test.ts`

**Scene:** `checkEnvironment` (environment.ts:27-44) returns checks for brew/git/chezmoi/age/mise/age-key/repo. The env module already probes `op`/`rbw` separately (env.ts:838) but that never reaches the web. Add them here so they flow through the existing `/api/environment` → `EnvCheck[]`.

- [ ] **Step 1: Write the failing test**

Append a case to the `describe("checkEnvironment", …)` block in `packages/core/src/environment.test.ts`:

```ts
  it("includes op and rbw as non-required, non-brew checks", async () => {
    const exec = execWith(new Set(["brew", "git", "chezmoi", "age", "rbw"])); // op missing, rbw present
    const checks = await checkEnvironment(exec, { home: tmp, repoDir: tmp });
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by["op"]!.ok).toBe(false);
    expect(by["op"]!.required).toBe(false);
    expect(by["op"]!.brewFormula).toBeUndefined();
    expect(by["rbw"]!.ok).toBe(true);
    expect(by["rbw"]!.required).toBe(false);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run packages/core/src/environment.test.ts`
Expected: FAIL (`by["op"]` is undefined).

- [ ] **Step 3: Add the checks**

In `environment.ts`, update the `id` doc comment (line 8) to include `op | rbw`, and insert the probes after the `TOOLS` loop and before the `age-key` push (after line 34):

```ts
  // Password-manager CLIs for `ref` secrets (ADR-0004). Non-required, not
  // brew-installable (op is a cask, rbw is cargo) — surfaced so the Env page
  // can warn when a chosen ref backend is unavailable.
  for (const cli of ["op", "rbw"] as const) {
    checks.push({ id: cli, ok: await hasTool(exec, cli), required: false });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/src/environment.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `pnpm -r typecheck && pnpm lint`
Expected: PASS.

```bash
git add packages/core/src/environment.ts packages/core/src/environment.test.ts
git commit -m "feat(core): surface op/rbw availability as non-required env checks"
```

---

## Task 7: Env page — backend-missing note for ref secrets

**Files:**
- Modify: `packages/web/src/views/AliasesEnv.tsx` (fetch env checks, pass availability, `EnvEditor` ref branch)
- Modify: `packages/web/src/AliasesEnv.test.tsx`

**Scene:** With Task 6 exposing `op`/`rbw` checks, the Env page can warn when a `ref` secret points at an uninstalled backend. `EnvEditor`'s `isRef` branch (AliasesEnv.tsx:292-315) renders the reference input; add a note beneath it.

- [ ] **Step 1: Write the failing test**

Append to `packages/web/src/AliasesEnv.test.tsx`:

```tsx
import { getEnvironment } from "./api";

describe("AliasesEnv — ref backend availability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("warns when an rbw-referenced secret has rbw uninstalled", async () => {
    const rbwEnv = {
      schemaVersion: 1, aliases: [], path: [], functions: [],
      env: [{ kind: "env", name: "TOKEN", value: "", secret: true, source: { kind: "ref", backend: "rbw", ref: "my-entry" }, enabled: true }],
    };
    (getEnv as ReturnType<typeof vi.fn>).mockResolvedValue(rbwEnv);
    (getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, name: "r", ageKey: true });
    (getEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({
      checks: [{ id: "rbw", ok: false, required: false }, { id: "op", ok: true, required: false }],
    });
    await act(async () => { render(<AliasesEnv onOpenSettings={() => {}} />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "edit env TOKEN" })); });
    await waitFor(() =>
      expect(screen.getByText(/is not installed — this reference can't be resolved on apply/)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @roost/web test -- AliasesEnv`
Expected: FAIL (no backend-missing note).

- [ ] **Step 3: Fetch env checks + derive availability**

In `AliasesEnv.tsx`, add `getEnvironment` to the api import:
```tsx
import { getEnv, putEnv, getDiscover, applyEnv, getHealth, getEnvironment } from "../api";
```

Add state (after the `ageKey` state from Task 2). Default `true` so the note never flashes before data loads:
```tsx
  const [opAvailable, setOpAvailable] = useState(true);
  const [rbwAvailable, setRbwAvailable] = useState(true);
```

In `fetchData`, fetch environment alongside env + health:
```tsx
      const [env, h, envck] = await Promise.all([
        getEnv(),
        getHealth().catch(() => null),
        getEnvironment().catch(() => null),
      ]);
      setData(env);
      setServerData(env);
      setAgeKey(h?.ageKey ?? false);
      const checks = envck?.checks ?? [];
      setOpAvailable(checks.find((c) => c.id === "op")?.ok ?? true);
      setRbwAvailable(checks.find((c) => c.id === "rbw")?.ok ?? true);
```

- [ ] **Step 4: Extend `EnvEditor` props + ref-branch note**

Extend the `EnvEditor` signature (Task 2's version) with two more props:
```tsx
function EnvEditor({
  item,
  onChange,
  t,
  ageKey,
  onOpenSettings,
  opAvailable,
  rbwAvailable,
}: {
  item: EnvVarItem;
  onChange: (next: Partial<EnvVarItem>) => void;
  t: (key: string) => string;
  ageKey: boolean;
  onOpenSettings?: () => void;
  opAvailable: boolean;
  rbwAvailable: boolean;
}) {
```

Inside the `isRef` branch, after the reference `<input>`/`</div>` (around line 314, still inside the `<Field>`), add the conditional note:
```tsx
              {((sel === "ref:op" && !opAvailable) || (sel === "ref:rbw" && !rbwAvailable)) && (
                <p style={{ ...hintStyle, color: "var(--amber)" }}>
                  {sel === "ref:op" ? "1Password CLI (op)" : "rbw"}{t("env.ref.backendMissing")}
                </p>
              )}
```

Pass the props at the call site (Task 2's `<EnvEditor>`):
```tsx
                      <EnvEditor
                        item={item as EnvVarItem}
                        onChange={(next) => patchEnv(ref.idx, next)}
                        t={t}
                        ageKey={ageKey}
                        onOpenSettings={onOpenSettings}
                        opAvailable={opAvailable}
                        rbwAvailable={rbwAvailable}
                      />
```

- [ ] **Step 5: Run the test, typecheck, lint**

Run: `pnpm --filter @roost/web test -- AliasesEnv && pnpm -r typecheck && pnpm lint`
Expected: PASS (all AliasesEnv tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/views/AliasesEnv.tsx packages/web/src/AliasesEnv.test.tsx
git commit -m "feat(web): env page warns when a ref secret's backend (op/rbw) is missing"
```

---

## Task 8: Onboarding — ref-hint line

**Files:**
- Modify: `packages/web/src/views/onboarding/StepCapture.tsx`
- Create: `packages/web/src/StepCapture.test.tsx`

**Scene:** `StepCapture` (StepCapture.tsx:8) captures during onboarding and, when a secret module is selected, generates a key then shows `KeyBackupConfirm`. It never tells the user the ref alternative exists. Add one explanatory line (no behavior change).

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/StepCapture.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { StepCapture } from "./views/onboarding/StepCapture";

vi.mock("./api", () => ({
  getSelection: vi.fn(),
  getKey: vi.fn().mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k", encryptedFiles: 0 }),
  generateKey: vi.fn(),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
}));
import { getSelection } from "./api";

const t = (k: string) => k; // identity: assert keys directly

it("shows the ref-hint when a secret module (env) is selected", async () => {
  (getSelection as ReturnType<typeof vi.fn>).mockResolvedValue({ modules: { env: ["TOKEN"] } });
  await act(async () => { render(<StepCapture t={t} onDone={() => {}} />); });
  await waitFor(() => expect(screen.getByText("onboard.capture.refHint")).toBeInTheDocument());
});

it("omits the ref-hint when no secret module is selected", async () => {
  (getSelection as ReturnType<typeof vi.fn>).mockResolvedValue({ modules: { dotfiles: ["~/.zshrc"] } });
  await act(async () => { render(<StepCapture t={t} onDone={() => {}} />); });
  await waitFor(() => expect(screen.queryByText("onboard.capture.refHint")).toBeNull());
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @roost/web test -- StepCapture`
Expected: FAIL (hint not rendered).

- [ ] **Step 3: Add the hint**

In `StepCapture.tsx`, compute the flag in render scope (after `const summary = …`, line 46):
```tsx
  const hasSecretModule = modules
    ? Object.entries(modules).some(([m, ids]) => SECRET_MODULES.has(m) && ids.length > 0)
    : false;
```

Render the hint right before the capture `<button>` (line 66):
```tsx
      {hasSecretModule && (
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
          {t("onboard.capture.refHint")}
        </p>
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @roost/web test -- StepCapture`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `pnpm -r typecheck && pnpm lint`
Expected: PASS.

```bash
git add packages/web/src/views/onboarding/StepCapture.tsx packages/web/src/StepCapture.test.tsx
git commit -m "feat(web): onboarding notes the password-manager ref alternative"
```

---

## Task 9: Full verification + desktop rebuild

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `pnpm -r build`
Expected: all packages build, no errors.

- [ ] **Step 2: Full test suite**

Run: `pnpm -r test`
Expected: core/cli/shared + web all green (new env/overview/environment/onboarding tests included).

- [ ] **Step 3: Lint + typecheck (mandatory — web build skips tsc)**

Run: `pnpm lint && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 4: Desktop rebuild + manual smoke**

Rebuild the Tauri desktop app and verify by hand:
- Env page: add a secret env var with source `age` on a machine with no age key → the dual-option note appears; the "generate or import one in Settings" link switches to the Settings tab. Switch source to `rbw` with rbw uninstalled → backend-missing note appears.
- Overview: capture with a sensitive file and no age key → card title is "items need attention" (not "potential secrets"), the row shows "age key required · Sensitive files can only be backed up age-encrypted", and "Generate key & retry" opens the backup-confirm modal; after acking, it re-captures.
- Onboarding: with an env secret selected, the ref-hint line shows above Capture.

- [ ] **Step 5: Final commit (only if the rebuild changed tracked artifacts; otherwise skip)**

```bash
git status   # if desktop build produced tracked changes, stage them explicitly
```

---

## Self-Review

**1. Spec coverage:**
- §6 (env page key awareness, no-key note, stored-no-key note) → Tasks 2, 7 (D6 stored note in Task 2's hint block).
- §6.4 (save-400 graceful) → Task 3.
- §7.2 (de-mislabel) → Task 4. §7.3 (no-key row label/hint/cluster) → Task 5. §7.4 (reuse KeyBackupConfirm) → Task 5 Step 7. §7.5 (age-binary guard, failure HUD) → Task 5 Steps 3+6.
- §8 / Phase 3 (op/rbw checks + backend-missing note) → Tasks 6, 7.
- §9 (i18n) → Task 1. §10 (honesty: no ref for files) → Task 5 (cluster offers only generate/import/skip).
- Phase 4 (onboarding ref-hint) → Task 8.
- §15 (verification gates) → Task 9.

**2. Placeholder scan:** every code step has concrete code/commands. The one judgement call — the capture button's accessible name in Task 4 — is flagged inline for the implementer to match against `Overview.tsx`.

**3. Type consistency:** `EnvEditor` props grow monotonically (Task 2 adds `ageKey`/`onOpenSettings`; Task 7 adds `opAvailable`/`rbwAvailable`) — both call-site edits shown. `blockedDetail` state type `(BlockedItem & { module: string })[]` set consistently in `handleCapture`, `handleEncryptRetry`, and consumed by `handleSkipBlocked`. `generateKey()` return shape `{created, source, recipient, keyPath}` matches `KeyGenerateResult` (api.ts:318) and `KeyBackupConfirm` props (`recipient`, `keyPath`).
