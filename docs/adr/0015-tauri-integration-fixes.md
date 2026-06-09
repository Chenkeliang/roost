# ADR-0015: Tauri integration fixes (opener, blockedDetail, maxCaptureMB)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Extends: ADR-0013 (Tauri shell), ADR-0010 (capture/encrypt)

## Context

The Tauri webview differs from a browser: external links don't open, and the
100MB capture cap is hardcoded. Capture-blocked items lacked a reason, and
in-app git push fails silently when it can't reach git credentials.

## Decision

- Add `tauri-plugin-opener`; web opens external links via the opener in Tauri,
  `window.open` in a browser.
- `ChangeSet` gains an OPTIONAL `blockedDetail?: { id, reason }[]` (reason:
  secret | too-large | managed | error); `blocked: string[]` kept for back-compat.
- New `roost/settings.yaml` with `maxCaptureMB` (default 100), threaded into
  `scanPathForSecrets`'s maxBytes.
- Push failures surface the full git error + a terminal-fallback hint; the
  in-app push mechanism is unchanged (GUI credential limits are not bypassed).

## Consequences

- One Tauri plugin + one optional ChangeSet field + one settings file + UI.
- No architecture/contract break; macOS-only (I9).
