# ADR-0011: Desktop .app packaging & distribution

> Superseded by ADR-0013 — the SEA binary is now the Tauri sidecar engine, not a browser launcher.

- **Status**: Superseded by ADR-0013 · 2026-06-08 (was ACCEPTED)
- **Date**: 2026-06-05

## Context

Roost ships as a Node CLI + web dashboard. Non-technical users want a
double-clickable macOS app and cannot be assumed to have Node installed.

## Decision

Package the existing cli+web into a self-contained Node SEA `.app`, distributed
unsigned (ad-hoc) as a GitHub Release asset for arm64 and x64.

- This is PACKAGING ONLY. It does NOT introduce a native UI shell (Tauri/Electron),
  does NOT change the layered architecture (I1/I3), module contracts, or the
  selection.yaml schema, and remains macOS-only (I9).
- The only new code is a `roost gui` launch mode and a `/api/quit` endpoint, both
  in the UI layer (cli/web).
- Distribution is unsigned initially; users right-click→Open or run
  `xattr -dr com.apple.quarantine`. Apple signing/notarization may be added later
  without changing the bundle structure.

## Consequences

- New build artifact + GitHub Release distribution channel to maintain.
- No change to invariants I1–I9 or any module.
- Bundle size ~120MB/arch (embedded Node).
