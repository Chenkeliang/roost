# ADR-0016: sync-state model (three-way baseline) + automation-first policy

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Spec: docs/superpowers/specs/2026-06-08-roost-sync-state-design.md

## Context

A second Mac cannot be brought up cleanly today, and conflict handling is
asymmetric (only the skills module resolves conflicts). Modeling machines with a
persistent "primary / secondary" role is brittle: roles flip over a machine's
life (a backup machine becomes the daily driver). The config repo is already the
single source of truth (I2), so machines are just clients at some position
relative to it.

## Decision

Drop machine "roles". Each machine is, at any moment, in a git-like sync-state
**derived from a three-way comparison** (local vs repo vs a per-item baseline =
the content at last successful sync): Synced / Ahead / Behind / Diverged.

- **Direction is computed from content hashes, never from commit equality.**
  `lastSyncedCommit` is used ONLY for the push-safety gate (§6.4), never to judge
  Behind — otherwise registry/unrelated commits cause false "Behind" on every
  machine.
- **Automation-first**: confident items (Behind, fresh machine, repo-new) auto-
  resolve with backup; only true exceptions surface, in three classes —
  `diverged` (both changed), `blocked` (needs age key / tool / decrypt), and
  `destructive` (repo deleted an item). A context-detected **policy** ("基调",
  e.g. take-repo on a new machine) pre-fills the default; the user can override.
- **Two hard rules**: destructive deletes never auto-apply (explicit confirm,
  even though reversible); missing prerequisites surface as "needs setup", never
  silently skipped.
- All "take repo" overwrites back up first (I7). macOS-only (I9).

## Touched invariants

I2 (single source of truth — reinforced), I4 (sync-state lives in the
orchestration layer as module-agnostic pure logic, not as core branching), I7
(reversible apply — every overwrite backs up).

## Consequences

- New `packages/core/src/sync-state.ts` (pure three-way + exception
  classification + push-safety check).
- The `Drift` view evolves into the unified sync-state review surface.
- Enables ADR-0017 (contract carries the three-way data) and ADR-0018
  (baseline + registry persistence).

## Alternatives

- Persistent machine roles — rejected: brittle under role-flip, fights future P2.
- Commit-level Behind — rejected: false positives from registry/unrelated commits.
- Full bidirectional auto-merge engine — rejected (OUT of scope); three-way is
  used only to judge direction and to present, not to auto-merge arbitrary files.
