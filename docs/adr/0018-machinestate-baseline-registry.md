# ADR-0018: MachineState extension — baseline, lastSyncedCommit, registry semantics

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Extends: ADR-0001 (data files) · Spec: 2026-06-08-roost-sync-state-design.md

## Context

The sync-state model (ADR-0016) needs a per-machine baseline ("content at last
successful sync") and a way to detect that another machine pushed since this
machine last synced. A per-machine state file already exists:
`state/{host}.json` (`MachineState { host, schemaVersion, capturedAt, modules }`,
`.chezmoiignore`d), surfaced by `/api/machines`. Reuse it rather than inventing a
parallel `machines/` registry.

## Decision

Extend `MachineState` (`packages/core/src/state.ts`):

- `modules: Record<string, ModuleBaseline>` — reuse this bag to hold the
  **per-item baseline hashes** (+ short summary) used by the three-way compare.
- add `lastSyncedCommit: string` — repo commit at this machine's last successful
  load/capture; used ONLY by the push-safety gate, never for direction.
- add `lastSeen: string` — written by capture/load.
- optionally persist **remembered per-item resolution decisions** to avoid
  re-asking the same item every sync.

Machine identity stays `os.hostname()` (existing convention; `profiles.ts`
already matches on it). The "registry" is the set of `state/*.json` plus an
enriched `/api/machines` (host, lastSeen, lastSyncedCommit, recent module
summary). Bump `STATE_SCHEMA_VERSION` and read older files tolerantly.

## Touched invariants

ADR-0001 data files / schema (file-is-contract, schemaVersion bump). State files
remain `.chezmoiignore`d (never deployed as dotfiles). No secrets in state.

## Consequences

- Baseline lives in the repo (committed, ignored), so machines can see "who
  changed what". capture/load writing state adds commits; harmless because
  direction is content-based (ADR-0016).
- **Known limitation**: two machines with the same hostname collide on the state
  key. Documented; optional user-editable display name can disambiguate later.

## Alternatives

- A new `machines/<uuid>.yaml` registry + random machine id — rejected:
  duplicates the existing `state/{host}.json` and fights `profiles.ts` hostname
  matching.
- Baseline in `~/.config/roost` (local-only) — rejected: then other machines
  can't see this machine's last-synced point for multi-machine awareness.
