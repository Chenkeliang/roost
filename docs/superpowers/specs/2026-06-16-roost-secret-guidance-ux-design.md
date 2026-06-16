# Secret-Protection Guidance UX — Design Spec

> Status: Draft for review · Date: 2026-06-16 · Area: web (UI/UX + i18n), optional small core/server probe
> Builds on: ADR-0004 (secret env resolution: age vs op/rbw ref), ADR-0010 (encrypt-&-retry), ADR-0022/0023/0024 (aitools policy/extract). No new ADR required — see §13.

**Goal:** When Roost can't protect a secret because there's no age key, stop telling the user "make an age key" as if it were the only path. Present the user's *real* options for that surface — and be honest where age genuinely is the only mechanism.

**Architecture:** Mostly-web messaging + interaction changes across env page, Overview capture-blocked card, and onboarding, driven by signals the web already receives (`HealthResponse.ageKey`, `blockedDetail[].reason/detail`, `EnvSecretSource`) and the existing `KeyBackupConfirm` consent modal. One additive Phase 3 surfaces password-manager CLI availability via two non-required `/api/environment` checks.

**Tech stack:** React + TS strict; i18n via `t()`/`strings.ts`; Phosphor icons; coral reserved for exceptions; vitest + jsdom for `.test.tsx`.

---

## 1. Problem & motivation

Roost protects secrets two ways (see §4). But every place that reports "no age key" treats **age as the only remedy**, which is wrong in two different directions:

1. **For env variables it is too narrow.** A secret env var can be protected *without any age key* by referencing 1Password (`op`) or Bitwarden-style `rbw`. The picker for this already exists ([AliasesEnv.tsx:286-288](../../../packages/web/src/views/AliasesEnv.tsx:286)), yet the page has **zero age-key awareness**: choose `age` with no key, type a value, hit save, and `PUT /api/env` rejects with a raw `400 "cannot encrypt secret … no age key available"` ([server.ts:1002-1006](../../../packages/cli/src/server.ts:1002)). The user is never told the `ref` alternative would have worked with no key at all.

2. **For the capture-blocked card it is unhelpful and mislabeled.** File-level blocks (dotfiles / aitools) emit `{reason:"error", detail:"no age key"}` ([dotfiles.ts:368](../../../packages/core/src/modules/dotfiles.ts:368), [aitools.ts:204](../../../packages/core/src/modules/aitools.ts:204)). The Overview card renders the raw English `错误 · no age key` with **no fix action** ([Overview.tsx:463-521](../../../packages/web/src/views/Overview.tsx:463)), and the whole section is titled **"疑似密钥 / potential secrets"** ([strings.ts:127](../../../packages/web/src/i18n/strings.ts:127)) + the HUD says `N blocked (potential secrets)` ([Overview.tsx:180](../../../packages/web/src/views/Overview.tsx:180)) — a missing-key problem is reported as a suspected-secret problem.

**Why now:** the cc-switch analysis re-surfaced our secrets story; a user asked to confirm the no-key behavior and correctly pointed out that "只说 age" ignores Bitwarden and disrespects the user's choice of secret backend.

## 2. Non-goals

- No change to the secret *mechanisms* (age encryption, op/rbw resolution) or to I6 (the no-plaintext-fallback gate stays exactly as is).
- No whole-file password-manager support (impossible — see §4/§10).
- No redesign of the Settings key lifecycle. Onboarding gets only a one-line ref-hint (Phase 4) — its generate→backup-ack flow is unchanged.
- No new secret backend.

## 3. Principles

- **P1 — Present real options, not a single prescribed tool.** Wherever we report "can't protect this secret," the remedy text must list the options that actually apply *to that surface*.
- **P2 — Honesty per surface.** Never offer a remedy that can't work here. For files, age is the only mechanism; say so plainly and do not dangle a password-manager option that physically cannot store a file. P1 and P2 together mean: env shows {age | op | rbw}; files show {age | don't back this up}.
- **P3 — Consent for consequential actions.** The age private key is the recovery material for *all* encrypted data ([server.ts:1027-1029](../../../packages/cli/src/server.ts:1027)). A one-click "generate" must explain the back-up-your-key responsibility before creating it — never silently generate.
- **P4 — Calm default, loud exception, accurate label.** Reuse the existing design language (coral only for true exceptions). A blocked-reason section must not assert a reason (e.g. "potential secrets") that isn't true of its contents.
- **P5 — Fail forward, never surprise.** If a save *will* fail for lack of a key, warn before the click; if it does fail, the error must carry the same option list, never a raw backend string.

## 4. The secret-protection model (canonical — both surfaces reference this)

| Mechanism | What is stored in the repo | Needs age key? | Needs a CLI at apply time? | Can protect |
|---|---|---|---|---|
| **age** (encrypt-into-repo) | ciphertext `.age` committed to the repo | **Yes** (on the capturing machine) | no | **whole files** (dotfiles/aitools via chezmoi) **and** env values (`roost/env-secrets/<NAME>.age`) |
| **ref** (`op` / `rbw`) | only a locator (`op://Vault/Item/field` or rbw entry name); **no ciphertext** | **No** | yes — `op`/`rbw` must be installed + unlocked when `apply` resolves it ([env.ts:404-414](../../../packages/core/src/modules/env.ts:404)) | **env values only** — `EnvSecretSource` lives on `EnvVarItem` ([types.ts:84-88](../../../packages/shared/src/types.ts:84)); there is no file-level ref |

**Consequence that drives the whole design:** "no age key" means *different things* on the two surfaces. On the env page it is one of three equivalent choices and is fully avoidable. On the capture card it is the only encryption path that exists for a file.

## 5. Surface inventory (where the bite happens)

| Surface | Trigger moment | Current behavior | In scope |
|---|---|---|---|
| **A. Env page** (`AliasesEnv.tsx`) | Save a `secret` + `source=age` value with no key → `PUT /api/env` returns 400 | raw 400 surfaced via HUD; no proactive hint; ref alternative invisible | **Yes (Phase 1)** |
| **B. Overview capture-blocked card** | After "capture from this Mac", file-level items blocked `error · no age key` | raw English, no CTA, section mislabeled "potential secrets" | **Yes (Phase 2)** |
| **C. Backend availability** (op/rbw installed?) | User picks `ref:rbw` but `rbw` not installed → silent placeholder at apply ([env.ts:838-845](../../../packages/core/src/modules/env.ts:838)) | not surfaced to web at all | **Optional (Phase 3)** |
| **F. Onboarding capture** (`StepCapture.tsx`) | first-run capture when env has secrets → generates a key | already generates **then** forces backup-ack via `KeyBackupConfirm` ([StepCapture.tsx:35,68-75](../../../packages/web/src/views/onboarding/StepCapture.tsx:35)); gap: never mentions the ref alternative | **Yes (Phase 4, light)** |
| D. Restore/apply side | applying an age secret on a key-less machine | already guided: `sync.detail.needs-age-key` ([strings.ts:100](../../../packages/web/src/i18n/strings.ts:100)) | No (already handled) |
| E. Settings key section | generate / import / rotate | already complete ([Settings.tsx:81,416](../../../packages/web/src/views/Settings.tsx:81)) | No (link target only) |

**Reusable consent component:** `KeyBackupConfirm` ([KeyBackupConfirm.tsx](../../../packages/web/src/components/KeyBackupConfirm.tsx)) is the canonical "you just generated a key — here's its path, back it up, [I've backed it up] → continue" modal (strings `onboard.key.*`). Surface B reuses it verbatim rather than inventing a new consent dialog (DRY, P3).

**Navigation is available:** `App.tsx` switches views via `setActiveTab` and already passes `onOpenSetup={() => setActiveTab("settings")}` to Overview and `onOpenSettings` to SyncState ([App.tsx:273,283,301](../../../packages/web/src/App.tsx:273)). We thread the same prop to `AliasesEnv` and to the Overview blocked card.

---

## 6. Phase 1 — Env page (`AliasesEnv.tsx`)

### 6.1 Inputs the page gains
- `health.ageKey: boolean` from `getHealth()` ([api.ts:23,75](../../../packages/web/src/api.ts:23)) — fetched once on mount, stored in state. (Already-existing endpoint; no server change.)
- An `onOpenSettings: () => void` prop, wired from `App.tsx` exactly like Overview's `onOpenSetup`.

### 6.2 Per-item state matrix (the secret editor row)
`source ∈ {age, ref:op, ref:rbw}` × `ageKey ∈ {present, absent}` × lifecycle `{new value typed, stored (value blanked, ciphertext exists), no value yet}`.

| source | ageKey | value state | UI |
|---|---|---|---|
| age | present | any | unchanged (today's behavior) |
| age | **absent** | **new value typed OR empty** | **show the no-key note (§6.3) under the source picker**; do not block editing |
| age | absent | stored (value="" badge) | show a quieter variant: "此密钥已加密保存,但本机无私钥,`apply` 时无法解密" — this is a restore concern; link to Settings. (Reuses D's wording.) |
| ref:op / ref:rbw | n/a | locator typed | unchanged; age key irrelevant (Phase 3 may add backend-availability note) |

Rationale for "don't block editing": the user may be mid-way to *switching to a ref* or about to generate a key. We warn, we don't trap.

### 6.3 The no-key note (source=age, ageKey absent)
A single calm line (not coral; use `--muted` text with a small `Info`/`Key` Phosphor icon) directly under the source `<select>`:

> **zh:** 本机没有 age 私钥。可在「设置」生成或导入,**或**把来源改为 1Password / rbw 引用(无需私钥)。
> **en:** No age key on this Mac. Generate or import one in Settings, **or** switch the source to a 1Password / rbw reference (no key needed).

- "设置 / Settings" is a button/link calling `onOpenSettings()`.
- The "或改用引用" half is satisfied by the adjacent picker — no separate control; the sentence just points at it. (P1: the options are co-located.)

### 6.4 Save-time 400 handling (P5)
When `PUT /api/env` returns `400` whose error contains `no age key`, the page must **not** show the raw string. Catch it in `saveEnv`'s error path and show the §6.3 message in the HUD instead (`type:"error"`), so the failed save still teaches the two options. (The proactive note in §6.3 should make this rare, but the guard is mandatory because the value could be typed before health loads.)

### 6.5 Layout discipline
One line, muted, appears only in the absent-key + age case. No new buttons beyond the inline "设置" link. Honors the earlier feedback against button-cluttered rows.

---

## 7. Phase 2 — Overview capture-blocked card (`Overview.tsx`)

### 7.1 Reason taxonomy (today vs. needed)
Reasons arriving in `blockedDetail[].reason`: `secret | too-large | large | managed | error`. `error` + `detail:"no age key"` is the no-key file case. We add **first-class handling for the no-key case** rather than letting it fall through to the generic "error" label.

Introduce a derived predicate in the component (no type change needed):
```ts
const isNoKey = (b: BlockedItem) => b.reason === "error" && b.detail === "no age key";
```

### 7.2 De-mislabel rule (P4)
The section title and the post-capture HUD must reflect what's actually in the batch:

- If **any** item has `reason === "secret"` → keep today's "疑似密钥 / potential secrets" framing for the secret items.
- If the batch has **no** secret items (only no-key / too-large / large / managed) → the section title becomes neutral **"项待处理 / items need attention"** and the HUD drops "(potential secrets)".
- Mixed batches: title is the neutral one; each row still carries its own specific reason label (already per-row at [Overview.tsx:464-469](../../../packages/web/src/views/Overview.tsx:464)).

Implementation: title key chosen by `blockedDetail.some(b => b.reason === "secret") ? "overview.blockedTitle" : "overview.blockedTitleNeutral"`; HUD text chosen the same way.

### 7.3 No-key row: label + remedy cluster
- **Label** (replaces raw `· no age key`): localized `缺 age 私钥 / age key required`, with a one-line hint **"敏感文件只能用 age 加密备份 / sensitive files can only be backed up age-encrypted"** (P2 honesty — no ref offered for files).
- **Remedy cluster** (disciplined: one primary button + two text links, P4/P5):
  1. **Primary button — "生成密钥并重试 / Generate key & retry"** → opens the consent step (§7.4), then on confirm: `generateKey()` → re-run capture (reuse the existing capture path that already feeds `blockedDetail`). Mirrors the secret `encrypt-&-retry` pattern at [Overview.tsx:452-460](../../../packages/web/src/views/Overview.tsx:452).
  2. **Text link — "去设置导入 / Import in Settings"** → `onOpenSetup()` (for users who already have a key to import rather than generate).
  3. **Text link — "暂不备份 / Skip for now"** → reuse the existing exclude path (`excludeDotfile` for dotfiles, [Overview.tsx:511](../../../packages/web/src/views/Overview.tsx:511); for aitools, remove from selection). Respects the choice to *not* back this up (P1).

### 7.4 Generate-key consent — reuse `KeyBackupConfirm` (P3, DRY)
"生成密钥并重试" reuses the **existing** onboarding pattern, not a new dialog:
1. Guard first (§7.5): if `age` binary is absent, show the install-age guidance and stop — do not generate.
2. `generateKey()` → on success, render `<KeyBackupConfirm recipient keyPath t onConfirm/>` (the same modal onboarding uses at [StepCapture.tsx:68-75](../../../packages/web/src/views/onboarding/StepCapture.tsx:68)).
3. The user must tick "I've backed it up" before `onConfirm` fires; `onConfirm` → refresh `health.ageKey` → re-run capture.

Rationale for generate-then-confirm (not pre-confirm): you cannot back up a key before it exists, and the modal blocks any further action until the backup is acknowledged — this is the established, reversible (rotatable) pattern already shipped in onboarding. Reusing it keeps one consent surface and zero new strings. On `generateKey()` failure → §7.5.

### 7.5 Dependency & failure interactions
- **age binary missing.** `generateKey()`/`age-keygen` presupposes `age` is installed (a `required:true` env check, [environment.ts:18](../../../packages/core/src/environment.ts:18)). If `health`/environment shows `age` absent, the consent step is replaced by guidance "先安装 age / install age first" with the existing brew-install affordance from the Setup checks — do **not** offer generate when it cannot succeed (P5). The component already can read environment checks via `getEnvironment()`.
- **generateKey() throws.** Show the error in the HUD; leave the blocked rows intact so the user can retry or pick another remedy.
- **Re-capture still blocks the same rows** (e.g. key made but a row was also a real secret): the card simply re-renders with the new `blockedDetail`; no special casing.

---

## 8. Phase 3 — backend availability (op/rbw)

So a user who picks `ref:rbw`/`ref:op` isn't silently betrayed at apply time (P5), surface CLI availability.

- **Core (additive):** in `checkEnvironment()` ([environment.ts:14-35](../../../packages/core/src/environment.ts:14)) add two `required:false` checks `op` and `rbw` (probe `--version`, mirroring the env module's existing probe at [env.ts:838-845](../../../packages/core/src/modules/env.ts:838)). No `brewFormula` (op is a cask, rbw is cargo — avoid offering a wrong `brew install`). They flow through the existing `/api/environment` → `EnvCheck[]` ([api.ts:119-129](../../../packages/web/src/api.ts:119)); **no schema change, no new endpoint.**
- **Web:** when `source=ref:op`/`ref:rbw` and that check is `ok:false`, show a muted note under the reference input: "rbw 未安装 — `apply` 时无法解析此引用 / rbw not installed — this reference can't be resolved on apply."

Phase 3 is independently shippable (decided in, D5) but does not block Phases 1-2; it completes P1 — "respect the choice" implies telling the user when their chosen backend won't work.

## 9. i18n keys (bilingual; add to `strings.ts`)

| key | en | zh |
|---|---|---|
| `env.key.missingNote` | No age key on this Mac. {settingsLink}, or switch the source to a 1Password / rbw reference (no key needed). | 本机没有 age 私钥。可在{settingsLink},或把来源改为 1Password / rbw 引用(无需私钥)。 |
| `env.key.missingNote.settingsLink` | generate or import one in Settings | 「设置」生成或导入 |
| `env.key.storedNoKey` | Encrypted, but this Mac has no key — it can't be decrypted on apply. {settingsLink} | 已加密保存,但本机无私钥,apply 时无法解密。{settingsLink} |
| `env.ref.backendMissing` | {cli} not installed — this reference can't be resolved on apply. | {cli} 未安装 — apply 时无法解析此引用。 |
| `overview.blockedTitleNeutral` | items need attention | 项待处理 |
| `overview.blocked.noKey` | age key required | 缺 age 私钥 |
| `overview.blocked.noKeyHint` | Sensitive files can only be backed up age-encrypted. | 敏感文件只能用 age 加密备份。 |
| `overview.blocked.generateRetry` | Generate key & retry | 生成密钥并重试 |
| `overview.blocked.importInSettings` | Import in Settings | 去设置导入 |
| `overview.blocked.skipForNow` | Skip for now | 暂不备份 |
| `overview.key.needAgeBinary` | Install `age` first (Setup), then generate a key. | 请先安装 age(设置检查),再生成密钥。 |
| `onboard.capture.refHint` | Secrets will be age-encrypted; you can switch any to a 1Password / rbw reference later on the Env page. | 密钥项将用 age 加密;之后可在 env 页把任意一项改为 1Password / rbw 引用。 |

The generate→backup-ack modal reuses the **existing** `onboard.key.*` strings (title/body/recipient/path/ack/continue) — no new consent strings.

(Interpolation `{settingsLink}`/`{cli}` follows whatever pattern `strings.ts` already uses; if it has no interpolation helper, split into a prefix string + a clickable `<button>` + a suffix string, matching the existing `setup.openSettingsForKey` style.)

## 10. Honesty boundary (explicit, normative)

- The env page (Phase 1) and only the env page offers `{age | 1Password | rbw}`.
- The capture-blocked card (Phase 2) offers `{generate age key | import key | skip}` — **never** a password-manager option, because a `ref` cannot store a file or a JSON sub-field. The hint string `overview.blocked.noKeyHint` states this so the absence of a ref option reads as intentional, not as an oversight.

## 11. Decisions & open questions

**Decided (with rationale):**
- D1: Generate-key consent **reuses `KeyBackupConfirm`** (§7.4) — generate then forced backup-ack; one consent surface, zero new strings, the key is reversible/rotatable.
- D2: "Skip for now" reuses existing exclude/remove — no new persistence.
- D3: env page warns but never blocks editing — supports the switch-to-ref path.
- D4: Phase 3 reuses `/api/environment` (additive checks), not a new endpoint.
- **D5 (Q1 → yes):** Phase 3 (op/rbw availability) is in scope — small, and completes P1 (don't let the user pick a backend that isn't installed).
- **D6 (Q2 → yes):** the "stored age secret on a key-less machine" note (§6.2 row 3) is in scope as a one-liner (`env.key.storedNoKey`) linking to Settings.
- **D7 (Q3 → yes, corrected):** onboarding does **not** silently generate — it generates then forces `KeyBackupConfirm` ([StepCapture.tsx:35,68](../../../packages/web/src/views/onboarding/StepCapture.tsx:35)). The only gap is it never mentions the ref alternative. Phase 4 adds a single explanatory line (`onboard.capture.refHint`) and keeps the protective default (still generates + backup-ack). Onboarding deliberately does **not** offer a "skip protection" path — the full age/ref/skip choice lives on the Env page (Surface A), the correct home for it.

## 12. Out of scope / future
- A "skip secret protection" path inside onboarding (kept protective; choice lives on the Env page).
- Whole-file secret-manager backing (not possible with op/rbw value resolution).
- Restore-side messaging (already handled, surface D).

## 13. Change control — ADR assessment
No ADR required. This changes **presentation and interaction only**; it adds no invariant, no layering exception, no data-schema field, no new module, and no new capability. Phase 3 adds two `required:false` doctor checks that surface an *already-existing* probe — additive and non-breaking. The secret mechanisms, I6 gate, and ADR-0004 model are untouched. (Per architecture.md §11, recorded here as the explicit no-ADR justification.)

## 14. Testing strategy
- **Env page (`.test.tsx`, jsdom):** (a) source=age + `ageKey:false` renders the no-key note and the Settings link calls `onOpenSettings`; (b) source=ref hides the note; (c) `ageKey:true` hides the note; (d) a mocked `PUT` 400 with "no age key" renders the §6.3 HUD message, not the raw error.
- **Overview (`.test.tsx`):** (a) a batch with only `error/no age key` items renders the neutral title + no-key label + hint, and the HUD text omits "potential secrets"; (b) the "生成密钥并重试" button calls `generateKey` then renders `KeyBackupConfirm`, and re-capture fires only after the ack/continue; (c) `age` binary absent → install guidance shown, `generateKey` NOT called; (d) mixed secret + no-key batch keeps per-row labels and uses the neutral title; (e) "暂不备份" calls the existing exclude path.
- **Phase 3:** an `op`/`rbw` `ok:false` env check renders the backend-missing note for the matching source.
- **Phase 4 (onboarding):** when a secret module is selected, `StepCapture` renders the `onboard.capture.refHint` line; the existing generate→`KeyBackupConfirm`→capture flow still works (regression).
- No core logic test changes for Phases 1, 2, 4 (no core change). Phase 3 adds an `environment.test.ts` case asserting `op`/`rbw` appear as non-required checks.

## 15. Verification gates
`pnpm --filter @roost/web test` (jsdom picks up `.test.tsx`) · `pnpm lint` · **`pnpm -r typecheck`** (web build is vite-only and does NOT run tsc, so typecheck is a separate mandatory gate) · Phase 3 also `npx vitest run packages/core/src/environment.test.ts`. Desktop rebuild + manual smoke at the end. Existing suites stay green.

## 16. Phasing (for the implementation plan)
- **Phase 1 (pure web):** env-page age-key awareness + no-key note + stored-no-key note (D6) + 400 handling + `onOpenSettings` prop + i18n + tests.
- **Phase 2 (pure web):** Overview no-key row (label/hint/cluster) + reuse `KeyBackupConfirm` for generate→retry + de-mislabel title/HUD + age-binary guard + i18n + tests.
- **Phase 3 (core+web):** op/rbw checks in `checkEnvironment` + env-page backend-missing note + tests.
- **Phase 4 (pure web, light):** onboarding `StepCapture` ref-hint line + regression test.
- Phases are independent and independently shippable; recommended order 1 → 2 → 3 → 4.
