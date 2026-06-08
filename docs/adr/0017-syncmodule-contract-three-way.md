# ADR-0017: SyncModule contract extension (status carries three-way + exception)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Extends: ADR-0001 (SyncModule contract) · Spec: 2026-06-08-roost-sync-state-design.md

## Context

`SyncModule.status()` returns `DriftReport` whose items are two-state
(`synced | drift | conflict | untracked`) with no direction. The sync-state
model (ADR-0016) needs each item to express which side changed and, when it
cannot be auto-resolved, which exception class it belongs to.

## Decision

Extend `DriftItem` (in `packages/shared/src/types.ts`) with **optional, additive**
fields:

- `localHash? / repoHash? / baselineHash?` — the three-way inputs;
- `direction?: "ahead" | "behind" | "diverged"` — derived position;
- `exception?: "diverged" | "blocked" | "destructive"` — surfaced exception class.

The orchestration layer (`syncStateAll`) derives direction/exception; modules
populate the hashes (or, for dotfiles, a coarse signal — see below). The change
is purely additive: existing callers that read only `state` keep working.

## Touched invariants

ADR-0001 SyncModule contract (the binding interface) — additive fields, but the
**semantics** of `status` now include direction/exception, hence this ADR.

## Consequences

- Every module's `status()` is updated to emit three-way data.
- **dotfiles** is a known coarse-grained exception: chezmoi owns the comparison,
  so dotfiles uses `chezmoi diff` non-empty + `lastSyncedCommit` for direction
  rather than per-file three-way hashes (documented in spec §7.3).
- No selection-schema change; no change to capture/apply skeleton.

## Alternatives

- A separate parallel "sync" method on the contract — rejected: duplicates
  status, two sources of truth.
- Returning a brand-new report type — rejected: breaks existing `DriftReport`
  consumers; additive fields are backward compatible.
