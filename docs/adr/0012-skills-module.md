# ADR-0012: skills module (cross-IDE backup + symlink distribution)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08

## Context

Users keep agent "skills" in per-IDE directories that differ across tools
(~/.claude/skills, ~/.codex/skills, …) plus a canonical source (~/.agents/skills).
They want one backup + cc-switch-style activation that links a canonical source
into each IDE, with per-skill and per-IDE enable/disable.

## Decision

Add a `skills` SyncModule via the §7 extension contract.

- Backup is plain files under `<repo>/skills/<name>/`. A shareable recipe
  `roost/skills.yaml` holds sourceDir/method/targets + per-skill
  {enabled,targets,method}. Per-machine link state lives in
  `state/skills-links.json` (already .chezmoiignore'd).
- `apply` materializes repo→sourceDir then RECONCILES links: build symlink
  (default) or copy for each enabled skill × selected IDE; remove Roost-owned
  links that no longer apply. Default dry-run; back up before overwrite; never
  touch non-Roost directories.
- Targets catalog default lives in code (`DEFAULT_SKILLS_TARGETS`), overridable
  via `roost/skills-catalog.yaml` (I8). No core branching, no selection-schema
  change, macOS-only (I9). Secret Scanner gates capture (I6).

## Consequences

- New module + two repo data files (skills.yaml recipe, skills-catalog.yaml).
- New per-machine state file under state/.
- No change to invariants I1–I9 or other modules.
