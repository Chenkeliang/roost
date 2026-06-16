# AI Tools v1.2 — Field Extraction + MCP Auto-Detection Design Spec

**Date:** 2026-06-16
**Status:** Approved (brainstormed across several turns; "放一起做") — ready for implementation plan
**ADR:** `docs/adr/0024-aitools-field-extraction.md`
**Builds on:** ADR-0022 (aitools module), ADR-0023 (policy model), spec `2026-06-15-roost-aitools-v11-design.md`

## Goal

Back up the AI-tool config that lives **inside a file mixed with secrets** — the case v1.1 deferred — starting with **Claude Code's user-level MCP** (`mcpServers` inside `~/.claude.json`, tangled with an OAuth session token + 40 KB of machine-local state). Three coupled deliverables:

- **A. Field-extraction primitive** — a generic, catalog-driven `extract` rule: back up only chosen JSON fields of a file (drop the rest), and on restore **merge those fields back** into the live file without touching anything else.
- **B. The one rule that needs it** — Claude Code: extract `mcpServers` from `~/.claude.json`.
- **C. MCP auto-detection** — scan config files for an `mcpServers`-shaped block that co-occurs with a scanner-detected secret, and **suggest** (never auto-apply) an extraction rule, so new Claude-style tools are found without hand-authoring.

**Restore semantics (decided): A — auto field-merge** back into the live file, through the existing Sync Review / apply gate, backing up the live file first. (This is the only semantics that delivers "user-level MCP follows you to a new Mac"; B "read-only display" was considered and rejected as not achieving the goal.)

**Why only Claude Code now:** research (`2026-06-15-ai-tools-catalog-candidates.md`) shows other mixed-file tools (Zed, aider, Continue) embed *long-lived API keys*, which v1.1 whole-file-encrypt already handles acceptably. Claude Code is unique: a *session token* (worthless to back up + churn) tangled with MCP → extraction is the only clean answer. The mechanism is generic; only this one rule ships.

## A. The extraction primitive

### Catalog schema (extends `AiToolPath`)

```ts
export interface AiExtract { fields: string[]; format?: "json" } // format default "json"; only json in v1.2
export interface AiToolPath {
  path: string;
  kind: "memory" | "settings" | "mcp" | "data";
  policy?: "plain" | "encrypt" | "skip";
  extract?: AiExtract;   // present ⇒ field-extraction handling, NOT whole-file chezmoi
}
```

Default rule (Claude Code): the existing `.claude.json` skip entry is **replaced** by an extract entry:
```ts
{ path: ".claude.json", kind: "mcp", policy: "encrypt", extract: { fields: ["mcpServers"] } },
```
(`policy:"encrypt"` because `mcpServers[].env` can hold API keys.) Override yaml accepts `extract` too (parseOverride extended).

### Storage — Roost-native artifact, NOT chezmoi (ADR-0024)

chezmoi maps whole files to target paths; "a field of a file" has no target, so routing it through chezmoi would misuse the tool (violates I1 thin-orchestrator). Instead:

- The extracted JSON is written to a Roost-owned artifact under `repo/aitools-extract/<toolId>__<basename>.json` (or `.age` when `policy:"encrypt"`), age-encrypted by reusing `encryptEnvSecret` (env-crypto: `age -r <recipient> -o <dest>`). It is git-committed by the normal capture commit (`commitRepo` stages `-A`). Restore decrypts with `decryptEnvSecret` (`age -d -i <key>`).
- This is a parallel storage path inside the `aitools` module; chezmoi is untouched for extract entries.

### Module behavior (branch on `extract`)

The `aitools` module's `capture`/`status`/`apply`/`discover` gain an extract branch (whole-file path unchanged):

- **discover():** an extract entry is a candidate iff its source file exists AND parses AND contains at least one of `extract.fields` (so we don't offer to extract a field that isn't there). Note shows `${label} · MCP (提取)`.
- **capture():** read live file → `JSON.parse` → pick `extract.fields` into `{ field: value }` (the OAuth token / everything else is never read into the artifact) → run the **secret scanner on the extracted subset** (I6 backstop; blocks if a plaintext secret survives and `policy!=="encrypt"`) → for `policy:"encrypt"` age-encrypt via `encryptEnvSecret` → write the artifact → done (git picks it up at finalize). ChangeSet records it under `encrypted`/`written`.
- **status():** extract entry is `drift` iff the live file's extracted fields differ (deep-equal) from the artifact's decrypted content; `synced` if equal; reported like any item so Sync Review shows it.
- **apply() = restore (the sensitive part):** decrypt the artifact → read the **current** live file fresh → set only `extract.fields` on the parsed live object (everything else, incl. the token, preserved byte-for-byte via structural merge) → **back up the live file to `~/.roost-backups/` first (I7)** → write back (pretty-printed, preserving key order where practical). Honors `ctx.dryRun` (dry-run reports the merge without writing). This runs only through Sync Review / `roost load` — never silently.

### Invariants
- **Token never stored:** extraction is an allowlist (only `extract.fields`); the token and other fields never enter the repo.
- **Restore is field-merge, not overwrite:** preserves the token + all other state; backup-before-write (I7); only via the apply gate (consistent with ADR-0022 "no modification outside the apply path" — this is a new *kind* of apply: merge).
- **Secrets:** `mcpServers.env` secrets → scanner + age-encrypt the artifact.
- **Race caveat:** Claude Code rewrites `~/.claude.json` live; the read-modify-write reads fresh immediately before writing to minimize clobber; UI copy advises applying when the app is idle / on a fresh machine.

## B. UI integration (minimal)

Extract entries appear in the AI Tools 配置备份 page like other rows, with state from the module:
- `add` (coral) to start backing up the MCP field; `已备份`/`待捕获`; a small `提取` tag after the filename so the user knows it's a field, not the whole file; encrypted lock.
- Restore is the existing Sync Review flow (the entry shows as repo-newer / drift there). The Sync Review row for an extract entry carries a clear note: 「合并 mcpServers 回 ~/.claude.json,保留登录态与其余内容」.

## C. MCP auto-detection (suggest-only)

A scan that finds Claude-style tools without a hand-authored rule:

- **Where:** the aitools `discover()` additionally scans a small set of candidate config files — the catalog's own paths plus a short curated list of common locations (`.config/*/config.json`, `.config/*/*.json`, `~/.*rc.json` — bounded, no deep FS walk) — and any not already covered by an extract rule.
- **Trigger:** a file parses as JSON AND has a top-level `mcpServers` object (the recognizable MCP shape) AND the **whole file would be secret-blocked** (the scanner flags a secret elsewhere — i.e. it's mixed). → emit a **suggestion** candidate: `{ id, path, kind:"mcp", suggestExtract: ["mcpServers"] }`.
- **Surface:** the UI shows suggestions in a distinct "检测到可提取的 MCP" group with a 「按提取方式纳管」 button. Clicking writes an `extract` rule into `roost/ai-tools-catalog.yaml` (reusing the v1.1 `POST /api/aitools/custom`, extended to accept an `extract` field) and selects it. **Never auto-applies.**
- **Scope guard:** auto-detection is limited to the well-shaped `mcpServers`-in-JSON pattern only — never tries to guess "portable vs secret fields" for arbitrary files (unsafe). TOML/YAML MCP variants stay catalog-authored.

## Error handling
- Source file missing / unparseable JSON → extract entry hidden (discover) or skipped (capture) with a benign note; never crash.
- None of `extract.fields` present → not a candidate.
- Decrypt fails (no age key) → restore blocked with "需 age 私钥" (like other encrypt entries).
- Live file changed between read and write → last-read-wins on the merge; backup exists for recovery.
- Auto-detect false positive → harmless (it only suggests; user ignores).

## Testing
- core: extract capture (only fields picked, token absent from artifact, age-encrypt invoked, scanner gate); status deep-equal drift; apply field-merge (token + other keys preserved, backup written, dryRun no-write); auto-detect (mcpServers+secret → suggested; mcpServers-only-no-secret → not; no-mcpServers → not).
- server/web: catalog/custom accept `extract`; suggestion surfaced; AiBackup 提取 tag + suggestion group.
- Final (assistant): full suites + typecheck + sidecar + **real-machine** — capture Claude Code mcpServers (artifact has no token), then a restore round-trip into a *throwaway copy* of `.claude.json` proving only mcpServers changed and the token survived (NEVER against the real `~/.claude.json` token destructively — use a temp file). Auto-detect surfaces Claude Code on this machine.

## Scope / out
- Only JSON `format`; only the Claude Code `mcpServers` default rule; auto-detect only JSON top-level `mcpServers`.
- No TOML/YAML extraction, no migration of Zed/aider/Continue (stay whole-file-encrypt).
- No new sidebar/IA; lands in the existing AI Tools page.

## Bindings preserved
I1 (thin orchestrator — age+git reused, chezmoi not misused), I6 (secrets: scanner + age, token never stored), I7 (backup before the merge write), I8 (extract rules are overridable data), "modify local files only through the apply gate" (the merge is an apply), v1 macOS-only.
