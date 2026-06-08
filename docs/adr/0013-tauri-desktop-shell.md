# ADR-0013: Tauri native desktop shell (SEA engine as sidecar)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Supersedes: ADR-0011 approach B (SEA + system browser)

## Context

ADR-0011 packaged Roost as a Node SEA binary that opened the dashboard in the
user's browser (LSUIElement, no window). In practice this reads as a "web app",
not a desktop app (double-click shows no window). The repo was already scaffolded
for Tauri (packages/web/src-tauri). Users want a real native window.

## Decision

Ship a Tauri v2 native window that loads the existing React UI (packages/web/dist).
The engine is the SAME self-contained SEA binary from ADR-0011, repurposed as a
Tauri sidecar (`binaries/roost-server-<triple>`) running `serve --port 4317`.

- Tauri is a UI shell only: core/cli logic and the React UI are unchanged
  (I1/I3). No new domain logic. macOS-only (I9).
- Release spawns the sidecar via tauri-plugin-shell and terminates it on app
  exit (no orphan). Dev falls back to system `node … serve`.
- `tauri build` produces Roost.app + Roost.dmg, arm64 + x64, unsigned (ad-hoc);
  signing/notarization may be added later without structural change.
- The SEA+browser entry points (`roost gui`, build-app.mjs, smoke-app.mjs,
  /api/quit, appMode) are retired.

## Consequences

- New UI shell layer (Rust/Tauri) to maintain; Rust toolchain required to build.
- The SEA binary is reused (not wasted) as the sidecar engine.
- No change to invariants I1–I9, module contracts, or selection schema.
