# ADR-0024: AI tools — field extraction + merge-restore + MCP auto-detection

- Status: Accepted
- Date: 2026-06-16
- Builds on: ADR-0022 (aitools module + "never modify local files outside the apply path"), ADR-0023 (policy model)
- Spec: `docs/superpowers/specs/2026-06-16-roost-aitools-v12-field-extraction-design.md`

## Context

Some AI tools mix portable config and secrets in one file. The acute case is Claude Code: user-level MCP (`mcpServers`) lives inside `~/.claude.json` alongside an OAuth **session token** and ~40 KB of machine-local state, and the file churns constantly. Whole-file backup (even encrypted) is wrong here: it stores a worthless ephemeral token, drags machine-local junk, and churns the repo. To let user-level MCP survive a new Mac you must back up *only* `mcpServers` and merge it back into the new machine's `~/.claude.json` without disturbing its token. Claude Code reads user-level MCP only from `~/.claude.json` (no alternate file), so a merge-restore is unavoidable.

## Decision

1. **Add a generic field-extraction primitive** to the catalog: `extract: { fields: string[] }` on a path. When present, Roost backs up only those JSON fields, not the whole file. Generic and overridable (I8); ships configured for exactly one rule — Claude Code `mcpServers`.
2. **Extracted artifacts are stored Roost-native, not via chezmoi.** A "field of a file" has no chezmoi target; routing it through chezmoi would misuse the tool (I1). Roost writes the extracted JSON to `repo/aitools-extract/…`, age-encrypted by reusing env-crypto (`encryptEnvSecret`/`decryptEnvSecret`), committed by the normal capture commit. chezmoi stays untouched for extract entries.
3. **Restore is a field-merge into the live file, through the apply gate.** `apply()` decrypts the artifact, reads the current live file fresh, sets only the extracted fields (everything else — including the token — preserved), backs up the live file first (I7), and writes back. This is a *new kind of apply* (merge, not overwrite) and the **first time Roost writes into a user file that it does not wholly own** — but it remains within ADR-0022's rule because it happens only through the Sync Review / `roost load` apply path, never silently, with a backup. The token is never read into the repo (extraction is an allowlist).
4. **MCP auto-detection is suggest-only and pattern-scoped.** `discover()` flags files that contain a top-level `mcpServers` block AND co-occur with a scanner-detected secret, suggesting an extraction rule the user confirms (which writes catalog data). It never auto-applies and never tries to infer "portable vs secret" for arbitrary files — only the well-shaped JSON `mcpServers` pattern.

## Consequences

- Claude Code's user-level MCP becomes portable across machines without ever backing up the OAuth token; the field-merge keeps the new machine's login intact.
- A second storage path (Roost-native artifacts) now exists alongside chezmoi inside the aitools module — a deliberate complexity cost, justified because chezmoi cannot model sub-file fields.
- ADR-0022's "no modification outside the apply path" is preserved and refined: apply may now *merge* fields, not only overwrite whole files; backup-before-write and the gate are retained.
- The mechanism generalizes (any tool/field via override; auto-detect finds new JSON-`mcpServers` tools), but scope is deliberately one rule + one auto-pattern in v1.2.
- Risk: writing into a live, app-managed file (`~/.claude.json`) can race a running Claude Code; mitigated by fresh-read-before-write, backup, and UI guidance to apply when idle/on a fresh machine. Accepted.
