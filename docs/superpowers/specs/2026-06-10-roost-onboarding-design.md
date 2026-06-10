# Roost First-Run Onboarding — Design Spec

**Date:** 2026-06-10
**Status:** Approved (brainstorming) — ready for implementation plan
**Branch:** `feat_onboarding` (based on `origin/main`)

## Goal

Give a brand-new user a guided first-run experience. Today, opening the desktop app
with no config repo drops the user on a fully-rendered but broken-feeling Overview
(empty machine cards, Capture/Review buttons that error, zero guidance). This feature
detects "no usable config repo" and replaces the Overview with an **inline guided
setup** that walks: create/connect a repo → environment check → choose what to manage
→ capture (with preview) → push. It also adds two safety guardrails: a blocking
**age-key backup confirmation** and a persistent **remote-not-configured warning**.

This is in-scope per the already-frozen `2026-06-08-roost-sync-state-design.md §5`,
which specifies first-run scenarios including a "build wizard."

## Architecture

**This is overwhelmingly a web-layer feature.** The entire engine happy-path already
exists and is reused as-is: `runInit`, `ensureGitRepo`, `cloneRepo`, `addSelection`,
`/api/discover`, `/api/capture` (secret-scanner gated), `/api/git/push`,
`ensureAgeKey` (`/api/key/generate`), `checkEnvironment`/`brewInstall`, `preflight`.
**No new core domain logic** is added (respects invariant I4 — no `if-else` accreted
into core). Three thin server endpoints are added as plumbing over existing core
helpers, in the same category as the existing ~40 endpoints; the UI never shells out
directly (respects I3).

**Shape:** inline guided setup that owns the **Overview surface** when no repo is
detected (decision A). **Soft gate** (decision): other tabs remain reachable;
repo-requiring actions are disabled with a "set up a repo first" state rather than
erroring.

### Layering

```
App.tsx / Overview.tsx  (detect no-repo → render OnboardingFlow; soft-gate actions)
  └─ OnboardingFlow      (5-step stepper, local step state)
  └─ KeyBackupConfirm    (blocking modal, reused by Settings)
  └─ RemoteWarningBanner (Overview, persists post-onboarding)
        │ web api.ts (typed fetch wrappers → port 4317)
        ▼
  cli/src/server.ts  (NEW: POST /api/init, /api/clone, /api/git/remote)
        │  (delegates to ↓ — never shells out from web)
        ▼
  core/cli helpers: runInit, ensureGitRepo, cloneRepo (via the single exec adapter)
```

## First-run detection & gating

- **The honest signal is `GET /api/git/status`** (`server.ts:573-601`) →
  `{ isRepo, remote, branch, ahead, behind, clean }`. `GET /api/health.repoDir`
  is unreliable — it is *always* the resolved default path (`~/.local/share/chezmoi`)
  even when nothing exists there, so it cannot indicate repo presence.
- At boot, the Overview data load (`Overview.tsx:124-126`) additionally calls
  `getGitStatus()`. Decision logic:
  - `isRepo === false` → render `<OnboardingFlow/>` in place of the dashboard.
  - `isRepo === true && remote === null` → render the dashboard **plus**
    `<RemoteWarningBanner/>`.
  - otherwise → dashboard as today.
- **Soft gate:** while `!isRepo`, the Capture / Review / Apply controls (Overview
  buttons, CommandPalette commands) render disabled with a "set up a repo first"
  hint. This mirrors the existing pattern of disabling push/pull when `!remote`
  (`Settings.tsx:269-278`). No other tab is blocked.
- While `git/status` is in flight, show the existing `Skeleton` rather than flashing
  either surface.

## The 5 steps

The stepper keeps local step state (`useState` step index). Each step maps to existing
endpoints; after a mutating action it re-fetches the relevant status before advancing.

### Step 1 — Set up your config repo
Two branches:
- **Create a new repo:** `POST /api/init` (scaffold + `git init` + first commit) with an
  optional remote-URL field. If a URL is given, `POST /api/git/remote` adds `origin`.
  `roost init --github` is **CLI-only** in v1 — shown as a copy-paste hint. No PAT ever
  enters the web app (decision).
- **I already have one:** paste a clone URL → `POST /api/clone` → `cloneRepo(url, repoDir)`
  into the default location. This is the second-machine path.

After success, re-fetch `git/status`; advance.

### Step 2 — Environment check
Reuses `Setup.tsx` env-check logic embedded as a step (passed `onComplete`/`embedded`
props; **not forked**). Sources: `GET /api/environment` (`{checks:[{id,ok,required,
brewFormula}]}`) + `preflight()` blockers (`GET /api/preflight`). One-click brew install
via `POST /api/environment/install`. "Next" is disabled until all *required* tools are
green and there are no blocking preflight failures.

### Step 3 — Choose what to manage
Smart pre-select via `GET /api/discover` (per-module candidates). Pre-checked modules are
user-confirmable; nothing is forced. Confirming writes via `POST /api/selection/add`.
Secret-bearing module (`env`/secrets) is **off by default**; selecting it is what triggers
lazy age-keygen at the capture boundary (see guardrail 1).

### Step 4 — Capture (preview, then commit)
`POST /api/capture` returns a **dry-run preview** of `ChangeSet[]` first (respects I7).
The **secret scanner hard-gates** before anything is written
(`cli/src/commands/capture.ts:23-32`). The user reviews, then clicks an explicit
"Capture & commit". If a secret-bearing module was selected and no age key exists,
key generation happens here and triggers the blocking backup modal before the write.

### Step 5 — Push to your remote
Explicit `POST /api/git/push` (no silent network writes). On success → "You're set up" →
`onComplete` re-fetches and Overview renders the real dashboard. If the remote was
skipped in step 1, this step becomes "You're local-only — add a remote to sync to other
machines," and **Finish still works** (the user lands on the dashboard with the
remote-not-configured banner showing).

## New server endpoints (thin plumbing)

All three delegate to existing helpers via the single `exec` adapter and invalidate the
25s TTL cache (`cache.invalidateAll()`, `server.ts:152`) on success.

| Endpoint | Body | Delegates to | Returns |
|---|---|---|---|
| `POST /api/init` | `{ remoteUrl?: string }` | `runInit({repoDir})` + `ensureGitRepo(exec, repoDir)`; if `remoteUrl`, `git remote add origin` | `{ created: string[], isRepo: true, remote: string \| null }` |
| `POST /api/clone` | `{ url: string }` | `cloneRepo(exec, url, repoDir)` | `{ ok: boolean, error?: string }` |
| `POST /api/git/remote` | `{ url: string }` | `git remote add origin <url>` or `set-url` if exists (via exec) | `{ ok: boolean, remote: string }` |

Notes:
- `repoDir` stays the boot-resolved default (`~/.local/share/chezmoi`); the web never
  repoints it (see Deferred scope). Both `init` and `clone` therefore write to that
  fixed location.
- `POST /api/git/remote` is also the CTA target of the remote-not-configured banner, so
  it is reused outside onboarding.

## Guardrails

### 1. Age-key backup — blocking confirmation
- **Lazy keygen** (decision): a key is generated only when a secret-bearing module is
  actually selected (i.e. at the step-4 capture boundary), not eagerly.
- New reusable **`<KeyBackupConfirm/>`** modal (built on the existing dialog pattern —
  `role="dialog"`, fixed `rgba` overlay, `zIndex 100`, centered card; cf.
  `Skills.tsx:579-654`, `TargetManager.tsx`). Shows `recipient` + `keyPath` from
  `POST /api/key/generate`'s response (`{created,source,recipient,keyPath}`); private key
  is never returned/shown. A required checkbox — "I have backed up `keys.txt` offline" —
  gates the Continue button.
- **Reused in Settings:** the same modal fires after `POST /api/key/generate` and
  `POST /api/key/rotate` (`Settings.tsx`), replacing the current non-blocking
  `window.confirm` + persistent-banner pattern with a consistent blocking confirm. Wires
  the `remindOfflineBackup` semantics (today CLI-only, `cli/src/commands/keyBackup.ts`)
  into the web.

### 2. Remote-not-configured warning
- New **`<RemoteWarningBanner/>`** on Overview, shown when `isRepo && remote === null`.
  Copy: "Local-only — your backups won't reach another Mac until you set a remote." CTA:
  "Set remote" → opens an inline field that calls `POST /api/git/remote`. Persists after
  onboarding is finished/dismissed (it is not part of the stepper).

## Error handling (per step)

- **init:** target dir is a non-empty/foreign directory → surfaced inline. `runInit` /
  `ensureGitRepo` are idempotent (safe re-run).
- **clone:** destination not empty → `cloneRepo` returns `{ok:false,error}` → inline
  message, stay on step 1.
- **remote:** `git remote add` does not validate reachability; optionally call
  `testRemote(exec, url)` (`projects.ts:46-54`) to show a non-blocking "couldn't reach
  remote" hint. A bad URL surfaces concretely at the push step.
- **env:** a missing *required* tool keeps "Next" disabled; brew-install failures show the
  command output.
- **capture:** secret-scanner block → response lists what tripped; stay on step 4, nothing
  written.
- **push:** `classifyGitError` (`server.ts:102-118`) distinguishes auth vs non-fast-forward
  (pull-first) vs other → actionable hint inline.

All errors also surface via the existing `Hud` toast.

## i18n

New `onboard.*` namespace added to `i18n/strings.ts` (flat dotted keys with `{en, zh}`),
plus key-backup-confirm and remote-banner strings. Default locale is `en`; existing tests
stay green. Covers all step labels, the two branches, button labels, error messages, and
both guardrails.

## ADR decision — none required

Per `architecture.md §11–13`, an ADR is required only for changes to invariants (§1–§11),
scope (§11), or data schema (§6). This feature triggers none:
- **No schema change** — `selection.yaml` / `state/{host}.json` shapes are untouched; the
  wizard only *populates* selection via existing `addSelection`.
- **No scope expansion** — first-run "build wizard" is already specified in the frozen
  `2026-06-08-roost-sync-state-design.md §5`.
- **No new invariant / no new secret surface** — the chosen design (local `init` + paste
  remote URL) means **no PAT ever crosses the web boundary**; `init --github` stays CLI-only
  with its established `GIT_ASKPASS` token discipline. The two guardrails *strengthen*
  existing invariants I6 (secrets) and I7 (reversible/backup) rather than change them.

(If web `roost init --github` is ever pursued, that introduces a PAT-over-HTTP surface
touching §9 and would get its own focused ADR. Out of scope here.)

## Testing

- **Core:** no new logic; existing coverage of `runInit`, `ensureGitRepo`, `cloneRepo`,
  `ensureAgeKey` stands.
- **Server (vitest, injected fake `exec`):**
  - `POST /api/init` — scaffolds expected files; idempotent on re-run; sets remote when
    `remoteUrl` given.
  - `POST /api/clone` — success via fake exec; failure when destination non-empty.
  - `POST /api/git/remote` — adds origin; `set-url` when origin already exists.
- **Web (`.test.tsx`, jsdom, `pnpm --filter @roost/web test`):**
  - `OnboardingFlow` — renders iff `!isRepo`; step gating (Next disabled until env green);
    soft-gate disables Capture/Review.
  - `KeyBackupConfirm` — Continue disabled until the checkbox is ticked.
  - `RemoteWarningBanner` — shows iff `isRepo && !remote`; hidden otherwise.
- **i18n:** new keys present for both locales; existing suites green.

## File-touch map

**New:**
- `packages/web/src/views/Onboarding.tsx` — the 5-step inline stepper.
- `packages/web/src/components/KeyBackupConfirm.tsx` — blocking backup modal (reused).
- `packages/web/src/components/RemoteWarningBanner.tsx` — Overview banner.
- Tests: `Onboarding.test.tsx`, `KeyBackupConfirm.test.tsx`, `RemoteWarningBanner.test.tsx`,
  server endpoint tests.

**Modified:**
- `packages/cli/src/server.ts` — add `POST /api/init`, `/api/clone`, `/api/git/remote`.
- `packages/web/src/api.ts` — `postInit`, `postClone`, `setGitRemote` wrappers (+ types).
- `packages/web/src/views/Overview.tsx` — fetch `git/status`; render Onboarding / banner;
  soft-gate actions.
- `packages/web/src/App.tsx` — pass-through for the gate if needed (state-driven routing).
- `packages/web/src/views/Settings.tsx` — use `KeyBackupConfirm` after keygen/rotate.
- `packages/web/src/views/Setup.tsx` — accept `embedded`/`onComplete` props for reuse as
  the env-check step (no fork).
- `packages/web/src/i18n/strings.ts` — `onboard.*` + guardrail strings (en + zh).

## Deferred scope (explicitly OUT of v1)

- **Pointing at an arbitrary existing local path** from the UI — implies runtime `repoDir`
  repointing in `buildCtx()` (`index.ts:37`), a separate change to the resolution model.
  `ROOST_REPO` is documented for power users who pre-set it before launch.
- **Web `roost init --github`** — would add a PAT-over-HTTP surface; revisit post-v1 with a
  dedicated ADR.
