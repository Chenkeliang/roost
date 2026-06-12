# ADR-0022: Asset layer phase 1 — aitools module, runtime-manager interop, changelog commits, repo-side restore

- Status: Accepted
- Date: 2026-06-12
- Spec: `docs/superpowers/specs/2026-06-12-roost-asset-layer-design.md`
- Research: `docs/research/2026-06-12-ai-direction-research.md`, `docs/research/2026-06-12-strategy-ccswitch-positioning.md`

## Context

Two research rounds (40+ OSS projects; cc-switch audit at 98.7k★) established
Roost's position: the encrypted, versioned asset layer *beneath* runtime
managers — not a competitor to them. Evidence: no tool unifies AI-config backup;
runtime managers store secrets in plaintext and keep only rotating snapshots;
"config silently overwritten" is a recurring, officially-unfixed incident class.
Delivering this touches governed surfaces: a new module, a new curated catalog
schema, the selection namespace, commit-message conventions, and restore
semantics.

## Decision

1. **New `aitools` SyncModule** (the sanctioned extension point — no core
   changes). Mechanics mirror dotfiles (chezmoi-backed, secret-scanner gated);
   selection namespace `aitools`. Driven by a **curated, overridable catalog**
   (`ai-tools-catalog.ts` + `roost/ai-tools-catalog.yaml` override), following
   the app-config-catalog precedent (I8: data files, zero hardcoded personal
   paths). v1 tools: Claude Code, Claude Desktop, Codex CLI, Gemini CLI,
   cc-switch (as encrypted opaque data).
2. **Credentials are never backed up.** OAuth/session files (`~/.claude.json`,
   `~/.codex/auth.json`, `~/.gemini/.env`) live in an exported `NEVER_BACKUP`
   list; the module blocks them even if hand-selected. Rationale: short-lived
   tokens make backups worthless and purely risk-adding (research, theme D).
3. **Runtime-manager interop = snapshot-layer contract.** (a) Managers' own
   stores are backed up as encrypted opaque assets; (b) their footprints are
   *recognized*, not fought — any non-Roost symlink mount gets an `external`
   label instead of a conflict, generically (a curated, overridable
   external-managers registry only supplies friendly names; cc-switch is the
   default entry, unknown managers are still recognized by rule); (c) single-writer per mount: ownership changes
   only via explicit user action (重新接管 / 让给对方), reusing existing
   resolve/toggle endpoints. Roost never auto-overwrites another manager's
   mount.
4. **Changelog commit convention.** Capture commits use
   `capture: <module>(<n>) …` subjects with full per-id bodies (rule-based,
   offline, no LLM); restore commits use `restore: <name> @ <sha7>`.
   `finalizeCapture` gains an optional message parameter; "roost: capture"
   remains the fallback for compatibility.
5. **Restore is repo-side only.** `file-restore` rewrites the *repo* version of
   a file (checkout + commit); the machine copy is untouched until the user
   applies through the existing load/Sync Review gates (I7). This extends the
   repo-hygiene invariant (ADR-0021): no feature mutates local files outside
   the apply path.

## Consequences

- The flagship "AI 工具配置统一备份" gap is filled as a module + data file —
  new tools are catalog additions, not code.
- Timeline becomes a readable changelog; per-file history/rollback directly
  answers the highest-pain incident class with git as the mechanism.
- cc-switch coexistence is explicit and documented; its users are an audience
  (encrypted disaster-recovery layer), not a battleground.
- Catalog churn risk (AI tools move their config paths quickly) is absorbed by
  the override file + ordinary data-file PRs.
