# AI Tools Module v1.1 — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming + 3-round design exploration with the user) — ready for implementation plan
**ADR:** `docs/adr/0023-aitools-policy-and-expansion.md` (amends ADR-0022 §2)
**Research:** `docs/research/2026-06-15-ai-tools-catalog-candidates.md`, `docs/research/2026-06-12-ai-direction-research.md`

## Goal

Make the `aitools` module **extensible and honest about secrets**, so it keeps up with a fast-moving AI-tool landscape without code changes, and stops the coarse "whole credential file" exclusion. Three deliverables:

- **A. Catalog expansion** — add the genuinely-mainstream tools (Cursor, Windsurf, Zed, GitHub Copilot) to the curated catalog; pure data.
- **B. Per-entry handling policy** — replace the rigid `NEVER_BACKUP` blacklist with a `policy` field on each catalog path (`plain | encrypt | skip`), so credentials/session files are expressed as data (`skip`), and the plaintext-secret scanner stays as the always-on guard. (Amends ADR-0022 §2.)
- **C. Page redesign (direction ①)** — the 配置备份 tab becomes a calm, collapsible, detected-first single-column list that scales to dozens of tools; self-serve "add tool / path".

**Out of scope (deferred):**
- **Field-level extraction / redaction** (back up only part of a mixed config+secret file, e.g. Claude Code's `mcpServers` inside `~/.claude.json`) → **v1.2**. Research confirmed whole-file-encrypt already covers mixed files coarsely, so this is an elegance upgrade, not blocking.
- **Switching the icon library to Lucide** → not now. The app stays on Phosphor (CLAUDE.md standard); a Lucide migration, if ever, is a separate app-wide task. v1.1 uses Phosphor with clean glyphs.

## A. Catalog expansion (data only)

Add to `DEFAULT_AI_TOOLS_CATALOG` (paths home-relative; verified in the research report). Tools the user actually has plus the two clear leaders:

```ts
{ id: "cursor", label: "Cursor", paths: [
  { path: ".cursor/mcp.json", kind: "mcp", policy: "encrypt" },
  { path: "Library/Application Support/Cursor/User/settings.json", kind: "settings", policy: "plain" },
  { path: "Library/Application Support/Cursor/User/keybindings.json", kind: "settings", policy: "plain" },
]},
{ id: "windsurf", label: "Windsurf", paths: [
  { path: ".codeium/windsurf/mcp_config.json", kind: "mcp", policy: "encrypt" },
  { path: ".codeium/windsurf/memories/global_rules.md", kind: "memory", policy: "plain" },
]},
{ id: "zed", label: "Zed", paths: [
  { path: ".config/zed/settings.json", kind: "settings", policy: "encrypt" }, // contains context_servers (MCP) + may hold keys
  { path: ".config/zed/keymap.json", kind: "settings", policy: "plain" },
]},
{ id: "copilot", label: "GitHub Copilot", paths: [
  { path: "Library/Application Support/Code/User/prompts", kind: "memory", policy: "plain" }, // user .instructions.md
]},
```

Notes: Cursor `state.vscdb` (binary SQLite, global rules) is **not** included (not single-file, large) — a known gap, fine for v1.1. Windsurf `user_settings.pb` (protobuf) excluded. These are documented, not silent.

## B. Per-entry handling policy (amends ADR-0022 §2)

**Schema change** (`ai-tools-catalog.ts`):

```ts
export type AiPolicy = "plain" | "encrypt" | "skip";
export interface AiToolPath {
  path: string;                                  // home-relative
  kind: "memory" | "settings" | "mcp" | "data";
  policy?: AiPolicy;                             // default "plain"
}
```

- `policy` **replaces** the boolean `encrypt`. `encrypt: true` → `policy: "encrypt"`; absent → `"plain"`. (Migrate the 5 existing tools' entries: Claude Code `settings.local.json`, Claude Desktop config, cc-switch db/settings → `policy: "encrypt"`.)
- **`NEVER_BACKUP` is removed as a separate blacklist.** Credential/session files become **catalog entries with `policy: "skip"`** — they show in the UI greyed with "永不备份" and the module refuses to capture them. This is the generalization the user asked for: "what to back up and how" is entirely data, no hardcoded list. The credential files move into their owning tool's `paths`:

```ts
// inside claude-code paths:
{ path: ".claude.json", kind: "data", policy: "skip" },          // OAuth session
// inside codex paths:
{ path: ".codex/auth.json", kind: "data", policy: "skip" },
// inside gemini paths:
{ path: ".gemini/.env", kind: "data", policy: "skip" },
{ path: ".gemini/oauth_creds.json", kind: "data", policy: "skip" },     // safety 補漏
{ path: ".gemini/google_accounts.json", kind: "data", policy: "skip" }, // safety 補漏
// inside a new ollama entry (models are GB-scale):
{ path: ".ollama/models", kind: "data", policy: "skip" },
```

**Capture semantics** (`modules/aitools.ts`):
- `policy: "skip"` → never captured; if hand-added to selection, blocked (reason `"managed"`, detail "凭据 / 会话文件 — 永不备份").
- `policy: "encrypt"` → `chezmoi add --encrypt` (age), as today.
- `policy: "plain"` → `chezmoi add`, **but still runs through the secret scanner** (defense in depth); a plaintext secret blocks with reason `"secret"`, exactly like dotfiles.
- **Invariant kept (I6):** secrets never enter the repo unencrypted; the scanner gate is not removed — `policy` only decides intended handling, the scanner is the backstop.

**Migration:** `loadAiToolsCatalog` accepts both the old `encrypt: true` and new `policy` in the override yaml (back-compat: `encrypt: true` ⇒ `policy: "encrypt"`).

## C. Page redesign — direction ① (single-column, detected-first)

The 配置备份 tab (Skills tab unchanged). Replaces the flat all-expanded list.

**Layout:**
- **Header row:** tagline (left); a segmented control `本机检测到 N | 全部支持 M` (default: detected); a neutral ghost `+ 添加工具 / 路径` button (coral reserved for primary add actions only).
- **Tool list (single column, no second rail):** each tool is a collapsible section:
  - **Collapsed header:** `caret · 工具名 ……… 覆盖圆点(●满/○空) + n/m`. Nothing else (no buttons, no chips). Fully-covered count is green.
  - **Tools managed elsewhere** (e.g. a path already in dotfiles selection, or cc-switch under dotfiles) → row greyed, right side "已在 dotfiles 管理", not expandable for capture.
  - **Expanded file rows** (indented under the tool with a 1px left guide line — the "tab" hierarchy):
    `kind-icon(muted) · filename(mono, normal weight) [· lock if encrypt] ……… single state`
    - **kind** is a **leading muted Phosphor icon** (memory=`FileText`/note, settings=`GearSix`, mcp=`Plugs`, data/credential=`Prohibit`) — NOT a text label (avoids "two whites" beside the filename).
    - **state** (right, exactly one per row): `已备份`(green, with check) / `待捕获`(amber) / `添加`(coral) / `永不备份`(muted, for `skip`).
    - encrypt entries show a small muted `Lock` after the filename.
  - **Bulk add:** for an unbacked tool, a single `全部添加` action lives inside the expanded card (not in the header).
- **Detected vs all:** "本机检测到" shows tools with at least one existing path; "全部支持" reveals the rest of the catalog (so the list isn't cluttered by uninstalled tools, answering "为什么只有这几个 / 为什么这么多没用的").

**Endpoint:** `GET /api/aitools/catalog` already returns per-path state; extend its state union to include `skip` paths (currently `never`) and keep `selected | pending | available | dotfiles | missing`. The `pending` (selected-but-not-captured) state stays (shipped in v0.3.0).

**Self-serve add:** `+ 添加工具/路径` opens a small form (tool label + path, or just a path) writing to `roost/ai-tools-catalog.yaml` via a new `POST /api/aitools/custom` (mirrors the skills TargetManager pattern). Minimal: add a single path under a custom tool id. (Reuses the existing override-file mechanism; UI is the new part.)

**Design language:** Phosphor icons (no emoji), coral only for add/primary, calm default + loud exception, Geist/mono, restrained motion. Pixel details (weights, spacing, exact glyphs) tuned live during implementation.

## Error handling
- Malformed override yaml → defaults (existing defensive loader).
- `skip` path hand-added → blocked, never captured, local file untouched.
- `plain` path with a plaintext secret → blocked (`secret`), prompt to mark encrypt.
- Missing paths → hidden (state `missing`).
- Custom-add with a path already covered → dedupe note, no double-manage.

## Testing
- core: catalog loader (policy default, `encrypt:true`→`encrypt` back-compat, override merge, skip entries present); module capture (encrypt/plain/skip behavior, skip-blocked + local-file-untouched assertion, scanner gate on plain).
- cli/server: `/api/aitools/catalog` states incl. skip; `POST /api/aitools/custom` writes override + dedupe; existing capture/discover still green.
- web: AiBackup redesign (collapsed/expanded, detected vs all toggle, kind icons, single-state rows, coral discipline), add-tool form. i18n en+zh.
- Final (assistant): full suites + `pnpm -r typecheck` + sidecar + real-machine (the 4 new tools' real candidates appear; a `skip` credential shows 永不备份; capture of a `plain`/`encrypt` entry round-trips).

## Bindings preserved
- I6 (secrets): scanner gate + age encryption unchanged; `skip` is stricter, not looser.
- I8 (curated data): everything is the overridable catalog; zero personal hardcoding.
- "never touch local files": skip/forget are repo/selection-side only.
- v1 macOS-only; no core domain logic added (module + data + UI).
