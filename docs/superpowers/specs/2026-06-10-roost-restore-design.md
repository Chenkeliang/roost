# Roost Restore Wizard — Design Spec

**Date:** 2026-06-10
**Status:** Approved (brainstorming) — ready for implementation plan
**Branch:** stacked on `feat_onboarding` (based on `origin/main`)
**Builds on:** `2026-06-10-roost-onboarding-design.md` (the first-run build flow)

## Goal

A returning user already has a Roost config repo on GitHub (they backed up before) and wants to **resume on a new/clean machine**. Today the onboarding's "I already have one" path clones the repo but then continues the *build* steps (select → capture → push), which is wrong for restoring. This adds a **restore track**: after cloning an existing repo, the wizard guides env-check → (age key) → **apply the repo onto this machine** (load), instead of capturing.

In scope per the frozen `2026-06-08-roost-sync-state-design.md §5` ("restore wizard" for the repo-present / empty-local scenario).

## Architecture

**Pure web orchestration — no new backend, no `api.ts` changes, no ADR.** Everything is reused: `postClone`, `getSelection`, `getEnvironment`, `getKey`, `postLoad` (dry-run + apply), and `getSyncState`/`postResolve` (Sync Review). `POST /api/load` already enforces I7 (dry-run by default; preflight hard-gate on a real apply; backups on overwrite) and the macOS §10 rules (bootstrap/runtime split, `mas` only-purchased, default-app confirmation) inside the existing module `apply()` paths. No schema change.

The work is: branch the existing `Onboarding.tsx` by repo content after Step 1, add two restore-track step components, add `onboard.restore.*` i18n.

## Branching (build vs restore)

- Step 1 (Repo) is unchanged: `Create new` (`postInit`) or `I already have one` (`postClone`).
- After Step 1 succeeds, `Onboarding` calls `getSelection()`:
  - **`modules` non-empty** → the cloned repo already has managed items → **restore track**.
  - **empty** (Create new scaffolds an empty `selection.yaml`) → **build track** (existing: select → capture → push).
- `Onboarding` holds `mode: "build" | "restore"` and renders the matching steps + step-strip labels:
  - build: `Repo · Check · Select · Capture · Push`
  - restore: `Repo · Check · Key · Restore`

## Restore track steps

**Step 2 — Check (env):** shared with build; reuse `Setup` (`embedded` + `onReady`).

**Step 3 — Age key (conditional):** rendered only when `getKey()` reports `encryptedFiles > 0 && !exists` (repo has age-encrypted content but this machine has no key). New `StepAgeKey.tsx`:
- Explains the key is required to decrypt secrets and is **not** in the repo; shows the exact path `~/.config/sops/age/keys.txt`.
- "Re-check" button re-queries `getKey()`; once `exists` → advance.
- The app never reads/handles the private key contents (I6) — the user places the file themselves.
- Escape hatch "I don't have my key right now": advance anyway; the apply step's preflight will block the secret-bearing module and route the user to Sync Review for the remaining items (see Step 4).
- When `encryptedFiles === 0` or a key already exists, this step is skipped entirely.

**Step 4 — Restore (apply):** new `StepRestore.tsx`:
- On mount, `postLoad(false)` (dry-run) → show a per-module summary of what *would* change (counts).
- Explicit **"Apply all"** → `postLoad(true)`:
  - success → success Hud → `onComplete()` (lands on the dashboard).
  - `{ blocked: true, blockers }` (preflight gate, e.g. missing age key) → show the blockers clearly and **route to Sync Review** to restore the unblocked items one-by-one.
- A prominent **"Open Sync Review"** link is present throughout this step (preview area + after apply) for item-by-item control and ongoing management. `Onboarding` gains an `onOpenSync` prop; `Overview` (which renders `Onboarding`) passes its existing `onOpenSync` (→ switches to the `sync` tab).

## Error handling

- clone failure (non-empty dir / bad URL) → stay on Step 1 (existing).
- env: missing required tool keeps "Next" disabled (existing `Setup`/`onReady`).
- age key absent + encrypted content → Step 3 guides; if skipped, surfaces at Step 4 as preflight blockers.
- `postLoad(true)` returns `blocked` → list blockers + Sync Review link; user can place the key and retry "Apply all".
- partial apply (some modules applied, some skipped) → summary shows applied/skipped per module; Sync Review link for the rest.

## i18n

New `onboard.restore.*` namespace (en + zh): step labels (`Key`, `Restore`), age-key guidance + path + re-check + skip, dry-run preview heading, "Apply all", blocked/blockers messaging, "Open Sync Review", restore-done. Flat `{ en, zh }` keys in `i18n/strings.ts`.

## Testing

- **Branching:** after Step 1, `getSelection()` non-empty → restore steps render (Key/Restore), not Select/Capture; empty → build steps.
- **StepAgeKey:** renders only when `encryptedFiles>0 && !exists`; "Re-check" re-queries `getKey` and advances when `exists` flips true; skip advances.
- **StepRestore:** dry-run preview on mount (`postLoad(false)`); "Apply all" calls `postLoad(true)`; on `{blocked:true}` shows blockers + a Sync Review affordance; on success calls `onComplete`.
- **Onboarding shell:** restore step-strip labels; `onOpenSync` wired through.
- Existing onboarding tests stay green; full `pnpm -r build` / `pnpm lint` / suites.

## File-touch map

**New:**
- `packages/web/src/views/onboarding/StepAgeKey.tsx` — conditional key-restore guidance.
- `packages/web/src/views/onboarding/StepRestore.tsx` — dry-run preview → apply-all + Sync Review.
- Tests: `StepAgeKey.test.tsx`, `StepRestore.test.tsx`, restore-branch cases in `Onboarding.test.tsx`.

**Modified:**
- `packages/web/src/views/onboarding/Onboarding.tsx` — `mode` branch after Step 1, restore step rendering, step-strip labels, `onOpenSync` prop.
- `packages/web/src/views/Overview.tsx` — pass `onOpenSync` into `<Onboarding/>`.
- `packages/web/src/i18n/strings.ts` — `onboard.restore.*` (en + zh).

**Unchanged:** core, server, `api.ts` (all reused).

## Deferred (OUT of v1)

- Partial/selective load *inside the wizard* (skip-secrets-and-apply-the-rest as a single action) — routed to Sync Review instead, to avoid a core `load` change.
- Arbitrary local-path repoDir repointing; web `roost init --github` (carried over from the onboarding spec).
