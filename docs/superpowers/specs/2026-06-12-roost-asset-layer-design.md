# Roost Asset Layer (Phase 1) — Design Spec

**Date:** 2026-06-12
**Status:** Approved (brainstorming across 2 research rounds + interop walkthrough) — ready for implementation plan
**ADR:** `docs/adr/0022-asset-layer.md`
**Research:** `docs/research/2026-06-12-ai-direction-research.md`, `docs/research/2026-06-12-strategy-ccswitch-positioning.md`

## Goal

Phase 1 of the "AI-era asset layer" positioning (Roost = the encrypted, versioned
layer beneath runtime managers like cc-switch). Three bounded deliverables:

- **C. Changelog commits** — capture commits describe what changed instead of a
  uniform "roost: capture".
- **A. AI tools config module** (`aitools`) — first-class capture/restore of AI
  tool configs (CLAUDE.md, MCP, settings, skills-adjacent files) for Claude
  Code, Claude Desktop, Codex CLI, Gemini CLI; plus the documented interop
  contract with runtime managers (cc-switch), including skills ownership
  badges and a two-button conflict flow.
- **B. History & rollback UX** — per-file history and repo-side restore
  (`history <path>` / `restore <path>@<rev>`), the productized answer to
  "my config was silently overwritten dozens of times".

User-set boundaries: no AI interpretation feature (only a Settings-configurable
LLM later, phase 2); rule-based changelog (no LLM); never fight runtime
managers for write ownership; **no action ever modifies or deletes a user's
local file** (restore is repo-side; applying to the machine goes through the
existing load/Sync Review gates).

## C. Changelog commits

- New pure helper in core: `summarizeCapture(changes: ChangeSet[]): { subject: string; body: string }`.
  - Subject ≤ 72 chars: `capture: dotfiles(2) packages(1) skills(1)` — modules
    with activity only, count = written+encrypted; falls back to
    `capture: no changes` (callers skip committing in that case already via the
    porcelain no-op guard).
  - Body: one line per module listing every written/encrypted id (encrypted ids
    suffixed ` (encrypted)`), so `git show` is a complete changelog. Blocked
    items listed under a `blocked:` line with reasons.
- `finalizeCapture(exec, repoDir, home, message?)` gains an optional message
  (default stays "roost: capture" for compatibility); the three capture callers
  (CLI `runCapture`, `POST /api/capture`, auto-backup scheduler) pass the
  summarized message. Restore commits (B) use `restore: <path> @ <short-sha>`.
- Timeline immediately becomes readable (it shows `%s`).

## A. `aitools` module

### Catalog (I8: curated, overridable data — mirrors `app-config-catalog.ts`)

```ts
// packages/core/src/ai-tools-catalog.ts
export interface AiToolPath {
  path: string;                                   // home-relative
  kind: "memory" | "settings" | "mcp" | "data";   // display grouping
  encrypt?: boolean;                              // capture with --encrypt
}
export interface AiTool { id: string; label: string; paths: AiToolPath[] }
export const DEFAULT_AI_TOOLS_CATALOG: AiTool[] = [
  { id: "claude-code", label: "Claude Code", paths: [
    { path: ".claude/CLAUDE.md", kind: "memory" },
    { path: ".claude/settings.json", kind: "settings" },
    { path: ".claude/settings.local.json", kind: "settings", encrypt: true },
    { path: ".claude/keybindings.json", kind: "settings" },
    { path: ".claude/agents", kind: "settings" },
    { path: ".claude/commands", kind: "settings" },
  ]},
  { id: "claude-desktop", label: "Claude Desktop", paths: [
    { path: "Library/Application Support/Claude/claude_desktop_config.json", kind: "mcp", encrypt: true },
  ]},
  { id: "codex", label: "Codex CLI", paths: [
    { path: ".codex/config.toml", kind: "settings" },
    { path: ".codex/AGENTS.md", kind: "memory" },
  ]},
  { id: "gemini", label: "Gemini CLI", paths: [
    { path: ".gemini/GEMINI.md", kind: "memory" },
    { path: ".gemini/settings.json", kind: "settings" },
  ]},
  { id: "cc-switch", label: "cc-switch", paths: [
    { path: ".cc-switch/cc-switch.db", kind: "data", encrypt: true },
    { path: ".cc-switch/settings.json", kind: "data", encrypt: true },
  ]},
];
```

Override file: `roost/ai-tools-catalog.yaml` (same merge semantics as the
appconfig catalog: override replaces by tool id). **Credentials are NOT in the
catalog at all** — `~/.claude.json`, `~/.codex/auth.json`, `~/.gemini/.env` are
listed in a `NEVER_BACKUP` const (exported for docs/tests) and the module
refuses them defensively even if hand-added to selection (blocked reason
`"managed"`, detail "credential/session file — never backed up").

### Module behavior

- `discover()`: for each catalog tool, emit a Candidate per existing path
  (id = absolute path, note = `${label} · ${kind}`); skip paths already present
  in the **dotfiles** selection (no double-管理 — surfaced in the note instead:
  "已在 dotfiles 管理"). Skills dirs are NOT in the catalog (the skills module
  owns them).
- `capture()`: chezmoi add per selected id with the catalog's `encrypt` flag
  (catalog `encrypt:true` ⇒ `--encrypt`, plus the secret scanner still gates
  plaintext entries exactly like dotfiles); `NEVER_BACKUP` ids → blocked.
  Selection namespace: `aitools` (ids are absolute paths, like dotfiles).
- `status()/apply()/diff()/unmanage()/doctor()`: same mechanics as the dotfiles
  module (chezmoi-backed); registered in `defaultRegistry` after `dotfiles` —
  generic endpoints (`/api/discover`, `/api/status`, capture/load) light up
  automatically.

### UI

New sidebar page **AI 工具** (between Skills and Aliases & Env): the standard
discover/selected two-tab layout (reuse the `common.*` patterns from
Dotfiles), grouped by tool with the `kind` shown as a chip and 🔐 marker for
encrypt entries. Copy includes the asset-layer one-liner: "运行时管理交给
cc-switch 这类工具;Roost 负责把这一切加密备进你的仓库。"

### Interop contract (the answer to "怎么衔接 cc-switch")

1. **资产备份**: cc-switch's store is a catalog entry (`data`, encrypted).
   Restore puts its files back; cc-switch keeps working. (On machines where
   `~/.cc-switch` is already under dotfiles selection, discover dedupe applies.)
2. **产物识别 (skills) — generic, not cc-switch-specific**: any mount that is a
   symlink whose resolved target lies OUTSIDE Roost's skills source dir gets a
   neutral 「外部管理」 badge (never a conflict, never fought). A curated,
   overridable **external-managers registry** (`DEFAULT_EXTERNAL_MANAGERS` in
   core + `roost/external-managers.yaml` override — same I8 mechanism as the
   catalogs; default entry: cc-switch at `.cc-switch`) maps known roots to
   friendly names; unknown managers still get recognized generically and are
   labeled by their target root (e.g. `外部管理 · ~/.foo-manager`). Real
   directories (no attribution possible) keep the existing conflict flow. New
   field on the skills response: `external?: { id: string; label: string }`.
3. **写权主权 (two-button conflict)**: when a Roost-managed mount was taken
   over (existing conflict detection), the row offers 「重新接管」 (existing
   `resolveSkillConflict`: back up + relink) and 「让给 cc-switch」 (existing
   per-target `toggleSkill` off — Roost stops linking that target; content
   remains backed up via path 1). No automatic fighting; user decides.

## B. History & rollback

- `GET /api/file-history?path=<target-abs-path>` → maps the target path to its
  repo source path (chezmoi `source-path`, fallback `git log --follow` over the
  mapped name) and returns `{ entries: { sha, subject, date }[] }` (≤30).
- `POST /api/file-restore { path, sha }` → `git checkout <sha> -- <sourcePath>`
  inside the repo + commit `restore: <basename> @ <sha7>` (changelog format).
  **Repo-side only** — the machine file is untouched; the response includes
  `{ ok, syncHint: true }` and the UI shows "已恢复到仓库 — 在同步复核中应用到本机"
  (Sync Review then shows repo-newer; the existing apply gates take over: I7).
- CLI: `roost history <path>`, `roost restore <path> <sha>` (same endpoints'
  logic via shared helpers).
- UI: Timeline page gains a file picker (search across managed ids from
  `/api/index`); selecting a file switches the list to that file's history with
  a per-row 「恢复此版本到仓库」 button + the Sync Review hint after success.

## Error handling

- summarize: empty changes → callers already no-op (porcelain guard).
- catalog override malformed → defaults (same defensive loader as appconfig).
- discover: nonexistent paths skipped silently; `NEVER_BACKUP` never emitted.
- history: unmanaged/unknown path → `{ entries: [] }` + UI "此文件不在备份中".
- restore: bad sha/path → 400/500 with message; repo dirty state is fine (the
  restore commit includes only the checked-out path).

## Testing

- core: `summarizeCapture` table tests (subject truncation, encrypted suffix,
  blocked lines); ai catalog loader (defaults/override/never-list); `aitools`
  module discover (existence, dedupe vs dotfiles, never-exclusion) and capture
  (encrypt flag per catalog, never→blocked) with fake exec.
- cli/server: finalizeCapture message plumbing (capture route, auto-backup,
  CLI — commit -m assertion via call capture); file-history mapping; file-restore
  (checkout + commit message, repo-side only — machine file untouched assertion);
  skills `external` field.
- web: AI 工具 page (discover grouping, kind chips, select→capture path);
  Timeline history flow (pick file → list → restore → hint); skills badge +
  two-button. i18n en+zh for every new string.
- Final (assistant): full suites + `pnpm -r typecheck` + sidecar + real-machine
  pass (capture commit message readable; restore round-trip on a test file).

## Out of scope (phase 2 or never)

- LLM anything (provider settings + 解读 button = phase 2 D).
- Windsurf/Continue/aider/ollama catalog entries (data-file additions later).
- Automatic re-linking of cc-switch-managed mounts on restore (documented
  one-click in cc-switch).
- Any local-file mutation outside the existing load/apply gates.
