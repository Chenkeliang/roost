# ADR-0019: adopt local skills + capture dereference

- **Status**: ACCEPTED · 2026-06-09
- **Date**: 2026-06-09
- Extends: ADR-0012 (skills module)

## Context

On a real machine, 10 skills under `~/.agents/skills` are symlinks to another
tool's directory (`~/.cc-switch/skills/X`) and were already "captured" — but the
repo stored the **symlink**, not the content (`git ls-files` shows one symlink
entry). They restore as empty/broken on another Mac. Root cause: `capture()`
runs `fs.cpSync(symlinkDir, dest, { recursive: true })` with the default
`dereference: false`, which copies `dest` as a symlink. Verified by probe:
`realpathSync` the top-level first, then `cpSync` (still `dereference: false`),
yields a real directory with inner symlinks preserved.

Users also want to adopt local skills (bare dirs, or dirs owned by another tool)
through the existing Discover → capture flow, with explicit consent, without
Roost touching the other tool's data.

## Decision

Extend the skills module (no core/orchestration change):

1. **capture dereferences** a top-level symlink source before copy — real
   content enters the repo; inner symlinks preserved. Fixes the latent
   data-loss bug and lets the 10 broken captures be repaired by re-capture.
2. **discover classifies by the resolved real directory** (`Candidate.origin`:
   `location`, `linked`, `needsRepair`, `conflictLocations`) — grouping is by
   directory, NOT by tool name (I8: no `cc-switch` string, no hardcoded tool
   path). It also surfaces repo entries stored as symlinks as `needsRepair`,
   only counts dirs containing `SKILL.md`, and skips dotfile junk.
3. **`Candidate.origin`** is an additive optional field on the shared schema.
4. **Adopt = capture + optional `materializeSource`** (default on): replaces the
   source symlink at `<sourceDir>/X` with the repo's real content, decoupling
   the skill from the other tool now (the UI exposes this as a "take effect now"
   toggle). `rmSync` removes only the source-side symlink — the other tool's
   content is never touched (verified by probe).
5. **Unadopt = forget, don't delete**: removes `repo/skills/X`, the `skills.yaml`
   entry, and the `skills-links.json` records — leaving `<sourceDir>/X` and all
   on-disk links intact. Fully reversible.

A symlink-origin group shows a generic, directory-worded hint that the other
tool should have its auto-management disabled to avoid mutual overwrites; Roost
never disables it for the user.

## Consequences

- Repo gains real, restorable content for symlink-sourced skills; the 10 broken
  ones become repairable.
- Skills module gains `materializeSource` + `unadopt`; capture/discover behavior
  changes; one shared schema field added; two endpoints (adopt extends capture,
  new unadopt). No new module, no selection-schema change. macOS-only (I9).
- After decouple, the source becomes a real dir; existing IDE symlinks pointing
  at it keep working. Full re-distribution remains the existing apply/link
  action.
