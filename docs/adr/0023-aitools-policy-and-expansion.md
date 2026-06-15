# ADR-0023: AI tools — per-entry handling policy + catalog expansion

- Status: Accepted
- Date: 2026-06-15
- Amends: ADR-0022 §2 ("Credentials are never backed up" — the `NEVER_BACKUP` blacklist)
- Spec: `docs/superpowers/specs/2026-06-15-roost-aitools-v11-design.md`
- Research: `docs/research/2026-06-15-ai-tools-catalog-candidates.md`

## Context

ADR-0022 shipped the `aitools` module with a hardcoded `NEVER_BACKUP` blacklist and a boolean `encrypt` per catalog path. Two problems surfaced in use:

1. **The blacklist is coarse and un-extensible.** It hardcodes three credential paths in code. New tools (and new credential files like Gemini's `oauth_creds.json` / `google_accounts.json`) require code edits, and the AI-tool landscape moves fast.
2. **The user challenged "credentials are never backed up."** For a private, age-encrypted repo, long-lived secrets are legitimately worth backing up (Roost already does this for dotfiles/env). The real distinctions are: *session/ephemeral tokens* (worthless to back up + churn) vs *long-lived secrets* (worth keeping, encrypted), and *plaintext must never enter the repo* (the actual safety line).

## Decision

1. **Replace the `NEVER_BACKUP` blacklist with a per-entry `policy` field** on each catalog path: `policy: "plain" | "encrypt" | "skip"` (default `plain`). The boolean `encrypt` is migrated (`encrypt:true` ⇒ `policy:"encrypt"`; override yaml stays back-compatible).
2. **Credential/session files become data, not code** — catalog entries with `policy: "skip"`, listed under their owning tool. They display greyed ("永不备份") and the module refuses to capture them (and refuses hand-added ones). This generalizes "what to back up and how" entirely into the overridable catalog (I8); adding/removing a never-backup path is a data change, not a code change.
3. **The plaintext-secret scanner stays as the always-on backstop (I6 unchanged).** `policy` expresses *intent*; the scanner still blocks any plaintext secret in a `plain` entry. Secrets never enter the repo unencrypted. `skip` is stricter than the old blacklist (it's explicit per file), not looser.
4. **Session tokens default to `skip`** (ephemeral, worthless restored, churny) — a value judgment encoded as data, separate from "is it secret".
5. **Catalog expansion is pure data**: add Cursor, Windsurf, Zed, GitHub Copilot to the defaults. Field-level extraction for mixed config+secret files (e.g. Claude Code `~/.claude.json` MCP) is **deferred to v1.2** — whole-file-encrypt already covers mixed files coarsely.

## Consequences

- The catalog is the single, overridable source of "what + how"; no hardcoded credential list. Community/users extend it via `roost/ai-tools-catalog.yaml` and a new self-serve add-path UI, zero code.
- I6 is preserved and arguably strengthened (explicit per-file skip + unchanged scanner). The "never back up secrets" line is refined to the accurate one: "never let *plaintext* secrets into the repo; back up long-lived secrets *encrypted*; skip ephemeral tokens."
- ADR-0022 §2's spirit (don't store useless/risky session tokens) is kept; only its rigid blacklist mechanism is replaced.
- One schema migration (`encrypt` → `policy`), back-compatible in the override loader.
