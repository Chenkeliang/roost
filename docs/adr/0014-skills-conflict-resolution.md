# ADR-0014: skills conflict resolution (back up & take over)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Extends: ADR-0012 (skills module)

## Context

The skills module's apply SKIPS a target when the IDE's skills dir already holds
a user's own real directory (a "conflict"), to never destroy user data. Users
need a way to resolve such conflicts from the UI.

## Decision

Add an explicit, user-confirmed "back up & take over" action (core
`resolveSkillConflict` + `POST /api/skills/resolve` + a Resolve control in the
matrix). It MOVES the user's real directory to `~/.roost-backups/skills/<ts>/...`
(via rename; copy+rm fallback across devices), then links/copies the canonical
source into place and records the link.

- MOVE, never delete — fully recoverable (I7).
- Per-cell (skill × target); requires UI confirmation.
- Guarded: acts only on a genuine conflict (a real dir Roost does not own);
  refuses symlinks / absent targets / Roost-owned links.
- No architecture, module-contract, or selection-schema change. macOS-only (I9).

## Consequences

- Roost may relocate a user dir into backups on explicit confirm.
- One new core function + one endpoint + one UI control; no new module.
