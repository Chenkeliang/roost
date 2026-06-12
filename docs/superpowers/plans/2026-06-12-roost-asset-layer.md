# Roost Asset Layer (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changelog capture commits, the `aitools` module (catalog-driven AI tool config backup + cc-switch interop incl. skills ownership UX), and per-file history/restore — per `docs/superpowers/specs/2026-06-12-roost-asset-layer-design.md` and ADR-0022.

**Architecture:** Pure module/data/UI extension — zero core domain changes. `aitools` mirrors the dotfiles mechanics (chezmoi adapter, secret scanner) driven by a curated catalog file; history/restore are two thin git endpoints (repo-side only); changelog is a pure summarizer threaded through `finalizeCapture`'s three callers.

**Tech Stack:** TS strict · Fastify · React+Vite · vitest. Branch `feat_asset_layer` (already cut). **Verification gates for every task: the task's tests + `pnpm lint` + `pnpm -r typecheck`** (web build is vite-only; CI runs typecheck). Stage explicitly, one commit per task, no push. No emoji in code; never modify/delete a user's local file.

---

## Shared contracts

```ts
// C — core/src/capture-summary.ts
export function summarizeCapture(changes: ChangeSet[]): { subject: string; body: string };
// subject: "capture: dotfiles(2) packages(1)" (active modules only, count=written+encrypted, ≤72 chars — overflow → "capture: 5 modules, 23 items")
// body: per module one "module: id1, id2 (encrypted), …" line; blocked items as "blocked: id (reason)" lines. Empty changes → { subject: "roost: capture", body: "" }.

// C — cli/src/captureFlow.ts
export async function finalizeCapture(exec: Exec, repoDir: string, home: string, message?: { subject: string; body: string }): Promise<void>;
// commit message = subject + "\n\n" + body when provided; default stays "roost: capture".

// A — core/src/ai-tools-catalog.ts  (schema exactly as in the spec §A)
export interface AiToolPath { path: string; kind: "memory" | "settings" | "mcp" | "data"; encrypt?: boolean }
export interface AiTool { id: string; label: string; paths: AiToolPath[] }
export const DEFAULT_AI_TOOLS_CATALOG: AiTool[];
export const NEVER_BACKUP: string[]; // home-relative: [".claude.json", ".codex/auth.json", ".gemini/.env"]
export function loadAiToolsCatalog(repoDir: string): AiTool[]; // override roost/ai-tools-catalog.yaml replaces-by-id (mirror app-config-catalog loader)

// A — core/src/modules/aitools.ts: export const aitoolsModule: SyncModule (name "aitools", selection namespace "aitools", ids = absolute target paths)
// A — skills: GET /api/skills rows gain `external?: { id: string; label: string }` — GENERIC detection
//   (symlink target outside Roost's skills source dir ⇒ external), friendly names via a curated
//   overridable registry: core/src/external-managers.ts
export interface ExternalManager { id: string; label: string; roots: string[] } // home-relative roots
export const DEFAULT_EXTERNAL_MANAGERS: ExternalManager[]; // [{ id: "cc-switch", label: "cc-switch", roots: [".cc-switch"] }]
export function loadExternalManagers(repoDir: string): ExternalManager[]; // override roost/external-managers.yaml, replace-by-id
// Unknown manager ⇒ { id: "unknown", label: "~/.foo-manager" } (target root shown). Web button text adapts: 让给 <label>.

// B — server
// GET  /api/file-history?path=<abs>  → { entries: { sha: string; subject: string; date: string }[] }   (≤30; unknown → { entries: [] })
// POST /api/file-restore { path, sha } → { ok: true, syncHint: true } | 400/500 {error}
// web/src/api.ts: getFileHistory(path), restoreFileVersion(path, sha) wrappers; FileHistoryEntry type.
```

UI naming: sidebar tab `aitools`(AI 工具), nav key `nav.aitools`. i18n namespaces: `ai.*`, `history.*`, plus `skills.external.*`. All new zh strings follow the file's half-width punctuation convention.

## File map

**New:** `packages/core/src/capture-summary.ts` + `.test.ts` · `packages/core/src/ai-tools-catalog.ts` + `.test.ts` · `packages/core/src/modules/aitools.ts` + `.test.ts` · `packages/web/src/views/AiTools.tsx` + `packages/web/src/AiTools.test.tsx` · `packages/web/src/FileHistory.test.tsx`.
**Modified:** `packages/cli/src/captureFlow.ts`, `packages/cli/src/commands/capture.ts`, `packages/cli/src/server.ts` (+ `server.test.ts`), `packages/cli/src/index.ts` (CLI history/restore), `packages/core/src/orchestrate.ts` (registry), `packages/core/src/index.ts` (exports), `packages/web/src/api.ts`, `packages/web/src/App.tsx` (nav+route), `packages/web/src/views/Timeline.tsx`, `packages/web/src/views/Skills.tsx` (+ `Skills.test.tsx`), `packages/web/src/i18n/strings.ts`.

---

### Task 1: C — `summarizeCapture` + `finalizeCapture(message)` + 三个调用方

**Files:** Create `packages/core/src/capture-summary.ts` + `packages/core/src/capture-summary.test.ts`; Modify `packages/cli/src/captureFlow.ts`, `packages/cli/src/commands/capture.ts`, `packages/cli/src/server.ts` (capture route + autoBackup `runCapture`), `packages/core/src/index.ts`; Test additions in `packages/cli/src/server.test.ts`.

- [ ] **Step 1: Failing tests** (`capture-summary.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { summarizeCapture } from "./capture-summary.js";
import type { ChangeSet } from "@roost/shared";

const cs = (module: string, written: string[] = [], encrypted: string[] = [], blocked?: { id: string; reason: string }[]): ChangeSet =>
  ({ module, written, encrypted, blocked: blocked?.map((b) => b.id), blockedDetail: blocked as ChangeSet["blockedDetail"] });

describe("summarizeCapture", () => {
  it("subject lists active modules with counts; body lists every id", () => {
    const r = summarizeCapture([cs("dotfiles", ["/u/.zshrc"], ["/u/.npmrc"]), cs("packages", ["Brewfile"]), cs("skills")]);
    expect(r.subject).toBe("capture: dotfiles(2) packages(1)");
    expect(r.body).toContain("dotfiles: /u/.zshrc, /u/.npmrc (encrypted)");
    expect(r.body).toContain("packages: Brewfile");
    expect(r.body).not.toContain("skills");
  });
  it("blocked items appear as blocked lines", () => {
    const r = summarizeCapture([cs("dotfiles", [], [], [{ id: "/u/huge.bin", reason: "large" }])]);
    expect(r.body).toContain("blocked: /u/huge.bin (large)");
  });
  it("empty → compatibility fallback", () => {
    expect(summarizeCapture([])).toEqual({ subject: "roost: capture", body: "" });
    expect(summarizeCapture([cs("dotfiles")])).toEqual({ subject: "roost: capture", body: "" });
  });
  it("subject overflow collapses to totals", () => {
    const many = Array.from({ length: 9 }, (_, i) => cs(`verylongmodulename${i}`, [`/a${i}`]));
    const r = summarizeCapture(many);
    expect(r.subject.length).toBeLessThanOrEqual(72);
    expect(r.subject).toMatch(/^capture: \d+ modules, \d+ items$/);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/core/src/capture-summary.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`capture-summary.ts`)

```ts
// Rule-based capture changelog (ADR-0022 §4). Pure; offline; no LLM.
import type { ChangeSet } from "@roost/shared";

export function summarizeCapture(changes: ChangeSet[]): { subject: string; body: string } {
  const active = changes.filter(
    (c) => c.written.length + c.encrypted.length + (c.blocked?.length ?? 0) > 0,
  );
  if (active.length === 0) return { subject: "roost: capture", body: "" };

  const parts = active
    .filter((c) => c.written.length + c.encrypted.length > 0)
    .map((c) => `${c.module}(${c.written.length + c.encrypted.length})`);
  let subject = parts.length > 0 ? `capture: ${parts.join(" ")}` : "capture: blocked only";
  if (subject.length > 72) {
    const items = active.reduce((n, c) => n + c.written.length + c.encrypted.length, 0);
    subject = `capture: ${parts.length} modules, ${items} items`;
  }

  const lines: string[] = [];
  for (const c of active) {
    const ids = [...c.written, ...c.encrypted.map((id) => `${id} (encrypted)`)];
    if (ids.length > 0) lines.push(`${c.module}: ${ids.join(", ")}`);
    for (const b of c.blockedDetail ?? []) lines.push(`blocked: ${b.id} (${b.reason})`);
  }
  return { subject, body: lines.join("\n") };
}
```

Export from `packages/core/src/index.ts` (`export { summarizeCapture } from "./capture-summary.js";`).

- [ ] **Step 4: Thread it through.** `captureFlow.ts`: add the optional 4th param; build the commit message:

```ts
export async function finalizeCapture(
  exec: Exec,
  repoDir: string,
  _home: string,
  message?: { subject: string; body: string },
): Promise<void> {
  // … existing state-stamping unchanged …
  const msg = message && message.subject !== "roost: capture"
    ? (message.body ? `${message.subject}\n\n${message.body}` : message.subject)
    : "roost: capture";
  await commitRepo(exec, repoDir, msg);
}
```

Callers (all three): compute `const summary = summarizeCapture(changes/changeSets);` after `captureAll` and pass it — `packages/cli/src/commands/capture.ts:36`, the `/api/capture` route in `server.ts`, and the autoBackup `runCapture` dep in `server.ts` (it calls `finalizeCapture` directly). Import `summarizeCapture` from `@roost/core` in both files.

- [ ] **Step 5: Server-side assertion** — append to `server.test.ts` (reuse the behavior-aware exec pattern: porcelain returns " M f"; record calls):

```ts
  it("capture commits with a changelog subject instead of 'roost: capture'", async () => {
    // module that writes one file; assert the commit -m argument
    const calls: string[][] = [];
    const exec: Exec = {
      async run(cmd: string, args: string[]): Promise<ExecResult> {
        calls.push([cmd, ...args]);
        if (cmd === "git" && args.join(" ").includes("status --porcelain")) return { code: 0, stdout: " M x", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const reg = new ModuleRegistry();
    reg.register(makeFakeModule({
      name: "dotfiles",
      captureFn: async () => ({ module: "dotfiles", written: ["/u/.zshrc"], encrypted: [] }),
    }));
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    await server.inject({ method: "POST", url: "/api/capture" });
    const commit = calls.find((c) => c[0] === "git" && c.includes("commit"));
    expect(commit).toBeDefined();
    const mIdx = commit!.indexOf("-m");
    expect(commit![mIdx + 1]).toContain("capture: dotfiles(1)");
    expect(commit![mIdx + 1]).toContain("/u/.zshrc");
    await server.close();
  });
```

- [ ] **Step 6: Verify** — `npx vitest run packages/core/src/capture-summary.test.ts packages/cli` + `pnpm lint` + `pnpm -r typecheck` → green.
- [ ] **Step 7: Commit** — `git add packages/core/src/capture-summary.ts packages/core/src/capture-summary.test.ts packages/core/src/index.ts packages/cli/src/captureFlow.ts packages/cli/src/commands/capture.ts packages/cli/src/server.ts packages/cli/src/server.test.ts && git commit -m "feat: changelog capture commits (rule-based summarizeCapture)"`

---

### Task 2: A — AI tools catalog

**Files:** Create `packages/core/src/ai-tools-catalog.ts` + `.test.ts`; Modify `packages/core/src/index.ts`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAiToolsCatalog, DEFAULT_AI_TOOLS_CATALOG, NEVER_BACKUP } from "./ai-tools-catalog.js";

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-aicat-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("ai-tools catalog", () => {
  it("defaults include the v1 tools and credential never-list", () => {
    const ids = DEFAULT_AI_TOOLS_CATALOG.map((t) => t.id);
    expect(ids).toEqual(["claude-code", "claude-desktop", "codex", "gemini", "cc-switch"]);
    expect(NEVER_BACKUP).toContain(".claude.json");
    expect(NEVER_BACKUP).toContain(".codex/auth.json");
  });
  it("override file replaces by id and adds new tools", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "roost", "ai-tools-catalog.yaml"), `
tools:
  - id: codex
    label: Codex CLI
    paths:
      - { path: .codex/config.toml, kind: settings }
  - id: aider
    label: aider
    paths:
      - { path: .aider.conf.yml, kind: settings, encrypt: true }
`, "utf8");
    const cat = loadAiToolsCatalog(tmpDir);
    expect(cat.find((t) => t.id === "codex")!.paths).toHaveLength(1);
    expect(cat.find((t) => t.id === "aider")!.paths[0]!.encrypt).toBe(true);
    expect(cat.find((t) => t.id === "claude-code")).toBeDefined(); // defaults kept
  });
  it("malformed override falls back to defaults", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "roost", "ai-tools-catalog.yaml"), "tools: 42", "utf8");
    expect(loadAiToolsCatalog(tmpDir)).toEqual(DEFAULT_AI_TOOLS_CATALOG);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — mirror `app-config-catalog.ts`'s loader style exactly (defensive parse, replace-by-id merge). Catalog contents verbatim from the spec §A (five tools; comments citing ADR-0022 + "facts from public docs, zero personal paths — I8"). `NEVER_BACKUP = [".claude.json", ".codex/auth.json", ".gemini/.env"]` with the why-comment (short-lived session tokens — backup is pure risk). Export all three from core index.
- [ ] **Step 4: Verify** — file tests + `npx vitest run packages/core` + lint + typecheck → green.
- [ ] **Step 5: Commit** — `git add packages/core/src/ai-tools-catalog.ts packages/core/src/ai-tools-catalog.test.ts packages/core/src/index.ts && git commit -m "feat(core): curated AI tools catalog (overridable, credential never-list)"`

---

### Task 3: A — `aitools` module + registry

**Files:** Create `packages/core/src/modules/aitools.ts` + `.test.ts`; Modify `packages/core/src/orchestrate.ts` (register after dotfiles), `packages/core/src/index.ts` (export module).

- [ ] **Step 1: Failing tests** (mirror the dotfiles test harness in `modules/dotfiles.test.ts` — same fake exec/ctx helpers; verify exact helper names there first)

```ts
describe("aitools module", () => {
  it("discover emits existing catalog paths with tool labels, skips missing and dotfiles-managed ones", async () => {
    const home = tmpDir;
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "# global", "utf8");
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}", "utf8");
    const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir);
    // settings.json already managed by dotfiles → dedupe note, not a candidate
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", path.join(home, ".claude", "settings.json"));
    saveSelection(repoDir, sel);
    const ctx = makeCtx({ exec: makeFakeExec([]).exec, home, repoDir });
    const cands = await aitoolsModule.discover(ctx);
    const ids = cands.map((c) => c.id);
    expect(ids).toContain(path.join(home, ".claude", "CLAUDE.md"));
    expect(ids).not.toContain(path.join(home, ".claude", "settings.json"));
    expect(ids).not.toContain(path.join(home, ".claude.json")); // never-list, even if it existed
    const memo = cands.find((c) => c.id.endsWith("CLAUDE.md"))!;
    expect(memo.note).toContain("Claude Code");
  });

  it("capture encrypts catalog-encrypt paths and blocks never-backup ids", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, "Library/Application Support/Claude"), { recursive: true });
    const mcp = path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
    fs.writeFileSync(mcp, "{}", "utf8");
    const cred = path.join(home, ".claude.json");
    fs.writeFileSync(cred, "{}", "utf8");
    let sel = emptySelection();
    sel = addItem(sel, "aitools", mcp);
    sel = addItem(sel, "aitools", cred); // hand-added credential — must be refused
    const { exec, calls } = makeFakeExec(Array.from({ length: 10 }, () => ({ code: 0, stdout: "", stderr: "" })));
    const ctx = makeCtx({ exec, home, repoDir });
    const cs = await aitoolsModule.capture(ctx, sel);
    const add = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes(mcp));
    expect(add).toBeDefined();
    expect(add!.args).toContain("--encrypt"); // catalog says encrypt for the MCP file
    expect(cs.blockedDetail?.some((b) => b.id === cred && b.reason === "managed")).toBe(true);
    expect(calls.some((c) => c.args.includes(cred) && c.args.includes("add"))).toBe(false);
    expect(fs.existsSync(cred)).toBe(true); // local file untouched
  });
});
```

(Needs an age-key presence shim for the encrypt path? No — mirror dotfiles: encrypt requires `ensureChezmoiAgeConfig`; for the unit test, follow how dotfiles.test.ts handles encrypted-capture tests — reuse its existing pattern/fixture for age readiness; if it stubs via fake exec only, do the same.)

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** (`modules/aitools.ts`) — structure:

```ts
// AI tools config module (ADR-0022): catalog-driven capture of AI tool configs.
// Mechanics mirror dotfiles (chezmoi-backed); ownership of skills dirs stays
// with the skills module; credentials are never backed up.
import * as fs from "node:fs";
import * as path from "node:path";
import type { SyncModule, ModuleContext, Selection, Candidate, ChangeSet, DriftReport, ApplyPlan, ApplyResult, Health, BlockedItem } from "@roost/shared";
import { createChezmoi } from "../adapters/chezmoi.js";
import { loadAiToolsCatalog, NEVER_BACKUP } from "../ai-tools-catalog.js";
import { loadSelection } from "../selection.js";          // ← verify actual import source used by dotfiles.ts and mirror it
import { ensureChezmoiAgeConfig } from "../env-crypto.js"; // ← same helper dotfiles uses for --encrypt readiness
import { scanPathForSecrets } from "./dotfiles.js";

const isNever = (home: string, id: string): boolean =>
  NEVER_BACKUP.some((rel) => path.join(home, rel) === id);

export const aitoolsModule: SyncModule = {
  name: "aitools",

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const cat = loadAiToolsCatalog(ctx.repoDir);
    const dotfilesSel = new Set(loadSelection(ctx.repoDir).modules["dotfiles"] ?? []);
    const out: Candidate[] = [];
    for (const tool of cat) {
      for (const p of tool.paths) {
        const abs = path.join(ctx.home, p.path);
        if (isNever(ctx.home, abs)) continue;
        if (!fs.existsSync(abs)) continue;
        if (dotfilesSel.has(abs)) continue; // single owner: already under dotfiles
        out.push({ id: abs, note: `${tool.label} · ${p.kind}${p.encrypt ? " · encrypted" : ""}` });
      }
    }
    return out;
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const ids = sel.modules["aitools"] ?? [];
    const cat = loadAiToolsCatalog(ctx.repoDir);
    const encryptSet = new Set(
      cat.flatMap((t) => t.paths.filter((p) => p.encrypt).map((p) => path.join(ctx.home, p.path))),
    );
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const written: string[] = []; const encrypted: string[] = [];
    const blocked: string[] = []; const blockedDetail: BlockedItem[] = [];
    let ageReady: boolean | null = null;
    for (const id of ids) {
      if (isNever(ctx.home, id)) {
        blocked.push(id);
        blockedDetail.push({ id, reason: "managed", detail: "credential/session file — never backed up" });
        continue;
      }
      if (!fs.existsSync(id)) continue;
      if (encryptSet.has(id)) {
        if (ageReady === null) ageReady = (await ensureChezmoiAgeConfig(ctx.exec, { home: ctx.home, repoDir: ctx.repoDir })).ready;
        if (!ageReady) { blocked.push(id); blockedDetail.push({ id, reason: "error", detail: "no age key" }); continue; }
        await chezmoi.add(id, { encrypt: true });
        encrypted.push(id);
        continue;
      }
      const scan = scanPathForSecrets(id, { maxBytes: 100 * 1024 * 1024 });
      if (scan.secretFiles.length > 0) {
        blocked.push(id);
        blockedDetail.push({ id, reason: "secret", detail: `${scan.secretFiles.length} file(s)` });
        continue;
      }
      await chezmoi.add(id, { encrypt: false });
      written.push(id);
    }
    return { module: "aitools", written, encrypted, blocked, blockedDetail };
  },

  // status / apply / diff / unmanage / doctor: mirror the dotfiles implementations
  // verbatim with module name "aitools" and namespace sel.modules["aitools"]
  // (read packages/core/src/modules/dotfiles.ts:332+ and replicate; apply scopes
  // to plan targets; doctor: chezmoi availability check only).
};
```

(The status/apply/diff/unmanage/doctor bodies must be REAL replicas of the dotfiles versions with namespace swapped — the implementer copies them from dotfiles.ts and adjusts; verify the exact import names — `loadSelection`/`ensureChezmoiAgeConfig` sources — against dotfiles.ts's own imports.) Register in `orchestrate.ts` `defaultRegistry()` after `dotfilesModule`; export `aitoolsModule` from core index.

- [ ] **Step 4: Verify** — module tests + full `npx vitest run packages/core packages/cli` (registry change ripples into server tests — counts may shift; fix any fixture that hardcodes module lists) + lint + typecheck → green.
- [ ] **Step 5: Commit** — `git add packages/core/src/modules/aitools.ts packages/core/src/modules/aitools.test.ts packages/core/src/orchestrate.ts packages/core/src/index.ts && git commit -m "feat(core): aitools module — catalog-driven AI config capture (ADR-0022)"`

---

### Task 4: A — web「AI 工具」page + nav + i18n

**Files:** Create `packages/web/src/views/AiTools.tsx` + `packages/web/src/AiTools.test.tsx`; Modify `packages/web/src/App.tsx` (nav entry + route between skills and env), `packages/web/src/i18n/strings.ts`.

- [ ] **Step 1: i18n** (append):

```ts
  // ── AI tools module ─────────────────────────────────────────────────────
  "nav.aitools": { en: "AI Tools", zh: "AI 工具" },
  "ai.tagline": { en: "Runtime management belongs to tools like cc-switch — Roost encrypts and version-controls all of it into your repo.", zh: "运行时管理交给 cc-switch 这类工具;Roost 负责把这一切加密、带版本地备进你的仓库。" },
  "ai.kind.memory": { en: "memory", zh: "记忆" },
  "ai.kind.settings": { en: "settings", zh: "设置" },
  "ai.kind.mcp": { en: "MCP", zh: "MCP" },
  "ai.kind.data": { en: "data", zh: "数据" },
  "ai.encrypted": { en: "encrypted", zh: "加密" },
  "ai.empty": { en: "No AI tool configs discovered on this machine.", zh: "本机未发现可纳管的 AI 工具配置。" },
```

- [ ] **Step 2: Failing test** (`AiTools.test.tsx`) — mock `./api` `getDiscoverModule`/`getSelection`/`addSelection`/`removeSelection` (mirror the Dotfiles page test if one exists; otherwise the standard harness):

```tsx
vi.mock("./api", () => ({
  getDiscoverModule: vi.fn().mockResolvedValue({ candidates: { aitools: [
    { id: "/u/.claude/CLAUDE.md", note: "Claude Code · memory" },
    { id: "/u/Library/Application Support/Claude/claude_desktop_config.json", note: "Claude Desktop · mcp · encrypted" },
  ] } }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { aitools: [] } }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  removeSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
}));

it("groups candidates by tool and adds one to the aitools selection", async () => {
  render(<AiTools showHud={() => {}} />);
  expect(await screen.findByText(/Claude Code/)).toBeInTheDocument();
  expect(screen.getByText(/Claude Desktop/)).toBeInTheDocument();
  // add the memory file
  const row = screen.getByText(/CLAUDE\.md/).closest("div")!;
  within(row).getByRole("button").click();
  await waitFor(() => expect(api.addSelection).toHaveBeenCalledWith("aitools", "/u/.claude/CLAUDE.md"));
});
```

- [ ] **Step 3: Implement `AiTools.tsx`** — copy the structural skeleton of `views/Dotfiles.tsx` (two-tab Selected/Discovered, `common.*` strings, Hud) with: module name `"aitools"`, the `ai.tagline` line under the header, and candidate rows grouped by the tool label (parse from `note` prefix before " · "), kind shown as a small chip (`ai.kind.*`) and an `ai.encrypted` 🔐-style text chip (Phosphor `Lock` icon, no emoji). Wire `App.tsx`: `Tab` union + `MODULE_NAV` entry (`nav.aitools`, Phosphor `Robot` icon) + route `{activeTab === "aitools" && <AiTools showHud={showHud} />}` placed after skills.
- [ ] **Step 4: Verify** — `pnpm --filter @roost/web test -- AiTools` + full web suite + lint + typecheck → green.
- [ ] **Step 5: Commit** — `git add packages/web/src/views/AiTools.tsx packages/web/src/AiTools.test.tsx packages/web/src/App.tsx packages/web/src/i18n/strings.ts && git commit -m "feat(web): AI Tools module page"`

---

### Task 5: A — skills interop(external 徽章 + 让渡按钮)

**Files:** Modify `packages/cli/src/server.ts` (skills GET route), `packages/web/src/api.ts` (SkillRow type), `packages/web/src/views/Skills.tsx`, `packages/web/src/i18n/strings.ts`; Tests `packages/cli/src/server.test.ts` + `packages/web/src/Skills.test.tsx`.

- [ ] **Step 1: Core registry** — create `packages/core/src/external-managers.ts` (+ append tests to `ai-tools-catalog.test.ts`'s file or a sibling): `ExternalManager`/`DEFAULT_EXTERNAL_MANAGERS`/`loadExternalManagers` exactly per Shared contracts, loader mirroring `loadAiToolsCatalog` (override `roost/external-managers.yaml`, replace-by-id, malformed → defaults). Export from core index. Test: defaults contain cc-switch; override adds `{ id: "foo", label: "Foo Manager", roots: [".foo-manager"] }`.

- [ ] **Step 2: Server** — in the `GET /api/skills` row assembly, compute per skill (GENERIC — works for any manager):

```ts
// A mount owned by another runtime manager — a neutral fact, not a conflict
// (ADR-0022 §3). GENERIC rule: the installed entry is a symlink whose target
// resolves OUTSIDE Roost's skills source dir. The registry only prettifies the
// name; unknown managers are still recognized and labeled by their target root.
function detectExternal(
  home: string,
  sourceDir: string,
  name: string,
  targets: SkillTarget[],
  managers: ExternalManager[],
): { id: string; label: string } | undefined {
  const srcRoot = path.resolve(sourceDir) + path.sep;
  for (const t of targets) {
    const dest = path.join(home, t.path, name);
    let st: fs.Stats;
    try { st = fs.lstatSync(dest); } catch { continue; }
    if (!st.isSymbolicLink()) continue;
    let real: string;
    try { real = fs.realpathSync(dest); } catch { continue; }
    if (real.startsWith(srcRoot)) continue; // ours
    const hit = managers.find((m) => m.roots.some((r) => real.startsWith(path.join(home, r) + path.sep)));
    if (hit) return { id: hit.id, label: hit.label };
    // Unknown manager: label by the target's top-level dir under home.
    const rel = path.relative(home, real);
    const top = rel.startsWith("..") ? path.dirname(real) : rel.split(path.sep)[0]!;
    return { id: "unknown", label: rel.startsWith("..") ? top : `~/${top}` };
  }
  return undefined;
}
```

(`sourceDir` = the skills module's resolved source dir — reuse however the route already resolves it for links/conflicts; `managers = loadExternalManagers(repoDir)` once per request.) Attach `external` to each skill row. Server tests (isolated `importHome` pattern): (a) symlink → `~/.cc-switch/skills/foo` ⇒ `{ id: "cc-switch", label: "cc-switch" }`; (b) symlink → `~/.foo-manager/skills/bar`(未注册)⇒ `{ id: "unknown", label: "~/.foo-manager" }`; (c) symlink → Roost source ⇒ `external` undefined.

- [ ] **Step 3: Web** — `SkillRow` gains `external?: { id: string; label: string }`. In `Skills.tsx` managed rows: when `external` is set, render a neutral gray badge `${external.label} ${t("skills.external.suffix")}`(如「cc-switch 管理」「~/.foo-manager 管理」)next to the name and suppress conflict styling for that target. In the conflict resolve dialog, add a second button `${t("skills.external.cedePrefix")}${external?.label ?? t("skills.external.other")}`(让给 cc-switch / 让给对方)calling the existing per-target `toggleSkill(name, target, false)` and closing the dialog(first button stays 重新接管 = existing resolve). i18n:

```ts
  "skills.external.suffix": { en: "managed", zh: "管理" },
  "skills.external.cedePrefix": { en: "Leave it to ", zh: "让给 " },
  "skills.external.other": { en: "the other manager", zh: "对方" },
```

Web test: row with `external: { id: "cc-switch", label: "cc-switch" }` shows the badge; unknown-manager label renders too; conflict dialog shows both buttons and 让给 triggers `toggleSkill`.

- [ ] **Step 4: Verify** — server + web suites + lint + typecheck → green.
- [ ] **Step 5: Commit** — `git add packages/cli/src/server.ts packages/cli/src/server.test.ts packages/web/src/api.ts packages/web/src/views/Skills.tsx packages/web/src/Skills.test.tsx packages/web/src/i18n/strings.ts && git commit -m "feat(skills): external-manager badge + cede action (cc-switch interop)"`

---

### Task 6: B — server `file-history` + `file-restore`

**Files:** Modify `packages/cli/src/server.ts`; Test `packages/cli/src/server.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
describe("file history + restore (ADR-0022 §5)", () => {
  it("GET /api/file-history maps a target path to its source and lists commits", async () => {
    const calls: string[][] = [];
    const exec: Exec = {
      async run(cmd: string, args: string[]): Promise<ExecResult> {
        calls.push([cmd, ...args]);
        if (cmd === "chezmoi" && args.includes("source-path")) return { code: 0, stdout: path.join(tmpDir, "dot_zshrc") + "\n", stderr: "" };
        if (cmd === "git" && args.includes("log")) return { code: 0, stdout: "abc1234\x1fcapture: dotfiles(1)\x1f2026-06-12T10:00:00+08:00", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const server = buildServer({ repoDir: tmpDir, registry: new ModuleRegistry(), makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "GET", url: `/api/file-history?path=${encodeURIComponent("/u/.zshrc")}` });
    const body = res.json() as { entries: { sha: string; subject: string }[] };
    expect(body.entries[0]).toMatchObject({ sha: "abc1234", subject: "capture: dotfiles(1)" });
    expect(calls.some((c) => c[0] === "git" && c.includes("--follow"))).toBe(true);
    await server.close();
  });

  it("POST /api/file-restore checks out the source at the sha and commits a restore message — machine file untouched", async () => {
    const machineFile = path.join(tmpDir, "machine-zshrc");
    fs.writeFileSync(machineFile, "local content", "utf8");
    const calls: string[][] = [];
    const exec: Exec = {
      async run(cmd: string, args: string[]): Promise<ExecResult> {
        calls.push([cmd, ...args]);
        if (cmd === "chezmoi" && args.includes("source-path")) return { code: 0, stdout: path.join(tmpDir, "dot_zshrc") + "\n", stderr: "" };
        if (cmd === "git" && args.join(" ").includes("status --porcelain")) return { code: 0, stdout: " M dot_zshrc", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const server = buildServer({ repoDir: tmpDir, registry: new ModuleRegistry(), makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({
      method: "POST", url: "/api/file-restore",
      payload: { path: machineFile, sha: "abc1234def" }, headers: { "content-type": "application/json" },
    });
    expect((res.json() as { ok: boolean; syncHint: boolean }).syncHint).toBe(true);
    expect(calls.some((c) => c[0] === "git" && c.includes("checkout") && c.includes("abc1234def"))).toBe(true);
    const commit = calls.find((c) => c[0] === "git" && c.includes("commit"));
    expect(commit![commit!.indexOf("-m") + 1]).toBe("restore: machine-zshrc @ abc1234");
    expect(fs.readFileSync(machineFile, "utf8")).toBe("local content"); // never touched
    await server.close();
  });

  it("file-history for an unmanaged path returns empty entries", async () => {
    const exec: Exec = { async run(cmd: string): Promise<ExecResult> { return cmd === "chezmoi" ? { code: 1, stdout: "", stderr: "not managed" } : { code: 0, stdout: "", stderr: "" }; } };
    const server = buildServer({ repoDir: tmpDir, registry: new ModuleRegistry(), makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "GET", url: `/api/file-history?path=${encodeURIComponent("/u/.unknown")}` });
    expect((res.json() as { entries: unknown[] }).entries).toEqual([]);
    await server.close();
  });
});
```

- [ ] **Step 2: Implement** — shared helper + two routes (place near `/api/timeline`):

```ts
  // Map a managed target path to its repo-relative source path; null if unmanaged.
  const sourceRelFor = async (exec: Exec, target: string): Promise<string | null> => {
    const r = await exec.run("chezmoi", ["--source", repoDir, "source-path", target]);
    if (r.code !== 0) return null;
    const abs = r.stdout.trim();
    return abs ? path.relative(repoDir, abs) : null;
  };

  // ── GET /api/file-history ─────────────────────────────────────────────────────
  server.get<{ Querystring: { path?: string } }>("/api/file-history", async (req, reply) => {
    const target = req.query.path?.trim();
    if (!target) return reply.status(400).send({ error: "path is required" });
    const exec = makeCtx(true).exec;
    const rel = await sourceRelFor(exec, target);
    if (!rel) return reply.send({ entries: [] });
    const r = await exec.run("git", ["-C", repoDir, "log", "--follow", "--pretty=format:%H\x1f%s\x1f%cI", "-n", "30", "--", rel]);
    if (r.code !== 0) return reply.send({ entries: [] });
    const entries = r.stdout.split("\n").filter((l) => l.trim()).map((l) => {
      const [sha, subject, date] = l.split("\x1f");
      return { sha: sha ?? "", subject: subject ?? "", date: date ?? "" };
    });
    return reply.send({ entries });
  });

  // ── POST /api/file-restore ────────────────────────────────────────────────────
  // Repo-side only (ADR-0022 §5): rewrites the REPO version; the machine copy is
  // untouched — applying goes through the existing load/Sync Review gates (I7).
  server.post<{ Body: { path?: string; sha?: string } }>("/api/file-restore", async (req, reply) => {
    const target = req.body?.path?.trim();
    const sha = req.body?.sha?.trim();
    if (!target || !sha || !/^[0-9a-f]{7,40}$/i.test(sha)) return reply.status(400).send({ error: "path and sha are required" });
    try {
      cache.invalidateAll();
      const exec = makeCtx(false).exec;
      const rel = await sourceRelFor(exec, target);
      if (!rel) return reply.status(400).send({ error: "path is not managed" });
      const co = await exec.run("git", ["-C", repoDir, "checkout", sha, "--", rel]);
      if (co.code !== 0) return reply.status(500).send({ error: co.stderr.trim() || "checkout failed" });
      await commitRepo(exec, repoDir, `restore: ${path.basename(target)} @ ${sha.slice(0, 7)}`);
      return reply.send({ ok: true, syncHint: true });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
```

(`commitRepo` is exported from `@roost/core` — add to the import list if absent.)

- [ ] **Step 3: Verify** — server suite + lint + typecheck → green.
- [ ] **Step 4: Commit** — `git add packages/cli/src/server.ts packages/cli/src/server.test.ts && git commit -m "feat(server): per-file history + repo-side restore endpoints"`

---

### Task 7: B — web Timeline 文件历史 + 恢复

**Files:** Modify `packages/web/src/api.ts`, `packages/web/src/views/Timeline.tsx`, `packages/web/src/i18n/strings.ts`; Test `packages/web/src/FileHistory.test.tsx`.

- [ ] **Step 1: api.ts**

```ts
// ── Per-file history / restore (ADR-0022) ─────────────────────────────────────
export interface FileHistoryEntry { sha: string; subject: string; date: string }
export function getFileHistory(p: string): Promise<{ entries: FileHistoryEntry[] }> {
  return apiFetch(`/api/file-history?path=${encodeURIComponent(p)}`);
}
export function restoreFileVersion(p: string, sha: string): Promise<{ ok: boolean; syncHint: boolean }> {
  return apiFetch("/api/file-restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p, sha }) });
}
```

- [ ] **Step 2: i18n**

```ts
  // ── File history / restore ────────────────────────────────────────────────
  "history.searchPlaceholder": { en: "File path to inspect (e.g. ~/.zshrc)", zh: "要查看的文件路径(如 ~/.zshrc)" },
  "history.show": { en: "Show history", zh: "查看历史" },
  "history.back": { en: "All snapshots", zh: "全部快照" },
  "history.restore": { en: "Restore this version to the repo", zh: "恢复此版本到仓库" },
  "history.restored": { en: "Restored to the repo — apply to this machine in Sync Review.", zh: "已恢复到仓库 —— 在同步复核中应用到本机。" },
  "history.empty": { en: "This file is not in your backups.", zh: "此文件不在备份中。" },
  "history.restoring": { en: "Restoring…", zh: "恢复中…" },
```

- [ ] **Step 3: Failing test** (`FileHistory.test.tsx`) — mock api `getTimeline` (existing shape), `getFileHistory`, `restoreFileVersion`; render `<Timeline showHud={hud}/>` (check Timeline's actual props in App.tsx — add `showHud` prop if it lacks one, optional to avoid breaking App); type a path (`~` expansion handled server-side? No — expand `~` to nothing client-side: send as-is; the placeholder uses absolute or `~/`; implement client-side `~/` → leave to server? Keep simple: the input requires an absolute path or `~/…`, and the component replaces a leading `~` with nothing and lets the server treat it… **Decision: component expands `~/` using the repoDir-independent trick — it cannot know home; instead the server-side `sourceRelFor` receives the raw string, and chezmoi itself resolves `~`? chezmoi source-path requires an absolute path.** Resolve: component sends the raw input; ADD to Task 6's history route: if path starts with `~/`, replace with `os.homedir()`. Update Task 6 implementation + a small test case accordingly.); assert flow:

```tsx
it("shows a file's history and restores a version", async () => {
  render(<Timeline />);
  const input = await screen.findByPlaceholderText(/File path|要查看/);
  fireEvent.change(input, { target: { value: "~/.zshrc" } });
  screen.getByRole("button", { name: /Show history|查看历史/ }).click();
  expect(await screen.findByText("capture: dotfiles(1)")).toBeInTheDocument();
  screen.getByRole("button", { name: /Restore this version|恢复此版本/ }).click();
  await waitFor(() => expect(api.restoreFileVersion).toHaveBeenCalledWith("~/.zshrc", "abc1234"));
  expect(await screen.findByText(/Sync Review|同步复核/)).toBeInTheDocument();
});
```

- [ ] **Step 4: Implement** — Timeline.tsx gains a header row: path input + 查看历史 button; when file-mode: list `entries` with the existing `SnapshotRow` look plus a per-row ghost button `history.restore` (busy → `history.restoring`); success → inline notice `history.restored` (+ Hud if showHud prop exists) and a `history.back` button returns to the snapshot list. Empty entries → `history.empty` EmptyState.
- [ ] **Step 5: Verify** — web suite + lint + typecheck → green.
- [ ] **Step 6: Commit** — `git add packages/web/src/api.ts packages/web/src/views/Timeline.tsx packages/web/src/FileHistory.test.tsx packages/web/src/i18n/strings.ts && git commit -m "feat(web): Timeline per-file history + repo-side restore"`

---

### Task 8: B — CLI `history` / `restore`

**Files:** Modify `packages/cli/src/index.ts`; Test: covered by server tests (commands shell the same helpers); add a smoke test only if a commands test harness pattern exists for sibling commands.

- [ ] **Step 1: Implement** two commands after the `diff` command (mirror sibling command style):

```ts
program
  .command("history")
  .description("Show a managed file's snapshot history")
  .argument("<path>", "target file path (absolute or ~/)")
  .action(async (p: string) => {
    const { repoDir, ctx } = buildCtx();
    const target = p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
    const sp = await ctx.exec.run("chezmoi", ["--source", repoDir, "source-path", target]);
    if (sp.code !== 0) { console.error("not managed:", p); process.exit(1); }
    const rel = path.relative(repoDir, sp.stdout.trim());
    const r = await ctx.exec.run("git", ["-C", repoDir, "log", "--follow", "--pretty=format:%h  %cI  %s", "-n", "30", "--", rel]);
    console.log(r.stdout || "(no history)");
  });

program
  .command("restore")
  .description("Restore a managed file's REPO version to a past snapshot (machine file untouched; apply via Sync Review)")
  .argument("<path>", "target file path")
  .argument("<sha>", "snapshot sha (from `roost history`)")
  .action(async (p: string, sha: string) => {
    const { repoDir, ctx } = buildCtx();
    const target = p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
    const sp = await ctx.exec.run("chezmoi", ["--source", repoDir, "source-path", target]);
    if (sp.code !== 0) { console.error("not managed:", p); process.exit(1); }
    const rel = path.relative(repoDir, sp.stdout.trim());
    const co = await ctx.exec.run("git", ["-C", repoDir, "checkout", sha, "--", rel]);
    if (co.code !== 0) { console.error(co.stderr.trim() || "checkout failed"); process.exit(1); }
    await commitRepo(ctx.exec, repoDir, `restore: ${path.basename(target)} @ ${sha.slice(0, 7)}`);
    ctx.log.info(`restored in repo — run \`roost load\` (dry-run) or use Sync Review to apply`);
  });
```

(`commitRepo` from `@roost/core`; `os`/`path` already imported in index.ts — verify.)

- [ ] **Step 2: Verify** — `pnpm --filter @roost/cli build` + `npx vitest run packages/cli` + lint + typecheck → green; manual smoke: `node packages/cli/dist/index.js history ~/.zshrc` against the real repo prints entries.
- [ ] **Step 3: Commit** — `git add packages/cli/src/index.ts && git commit -m "feat(cli): roost history / roost restore (repo-side)"`

---

### Task 9: Full verification(controller-run)

- `pnpm -r build` · `pnpm lint` · `pnpm -r typecheck` · `pnpm test` · `pnpm --filter @roost/web test` · `pnpm build:sidecar` — all green.
- Real-machine: capture on the live repo → `git log -1` shows a changelog subject; `roost history ~/.zshrc` lists entries; restore round-trip on a throwaway managed test file (restore old version → repo commit appears → machine file unchanged → Sync Review shows repo-newer); AI 工具 page lists this machine's real candidates; skills page shows no false external badges.
- Docs follow-up (same branch): README capability bullets + the interop one-liner.

---

## Self-Review

**1. Spec coverage:** C → T1(三调用方全覆盖,含 auto-backup);catalog/never-list → T2;module+registry+dedupe → T3;UI page → T4;interop badges/cede → T5;history/restore server → T6(含 `~/` 展开修订);web → T7;CLI → T8;真机+文档 → T9。Out-of-scope 清单与 spec 一致(无 LLM、无 Windsurf 等、不自动重挂载)。
**2. Placeholder scan:** T3 的 status/apply 等五个方法以「verbatim 复刻 dotfiles 对应实现并换命名空间」交付——这是对既有代码的明确复制指令并附行号锚点,非 TBD;其余任务代码完整。
**3. Type consistency:** `summarizeCapture` 返回型在 T1 定义、T1 三处消费;`AiTool/AiToolPath/NEVER_BACKUP` T2→T3/T4;`external?: { id, label }` + `ExternalManager` 注册表 T5 server→web 同名(通用识别,未知管理器按目标根目录标注);`FileHistoryEntry`、`restoreFileVersion(path, sha)` T6 形状→T7 wrapper→T7 测试;restore 提交格式 `restore: <basename> @ <sha7>` T6/T8 一致;`~/` 展开规则 T6/T7/T8 一致(server 与 CLI 都展开,web 原样透传)。

---

# 修订 R1(2026-06-12 交互定稿)— 实施者必读

本节**覆盖**上文与之冲突的内容。执行顺序:**T1 → T2 → T3 → T4(按 R1 改)→ T10(新)→ T5 → T6 → T7(按 R1 改)→ T8 → T9**。

## R1-A:Task 4 改为「AiBackup 组件 + catalog 端点」(不挂导航,T10 挂)

**Files:** Create `packages/web/src/views/AiBackup.tsx` + `packages/web/src/AiBackup.test.tsx`; Modify `packages/cli/src/server.ts`(+`server.test.ts`)、`packages/web/src/api.ts`、`packages/web/src/i18n/strings.ts`。**不改 App.tsx**(路由/导航属 T10)。

1. **服务端新端点**(替代用通用 discover 驱动页面;通用 discover 行为不变):

```ts
  // ── GET /api/aitools/catalog ──────────────────────────────────────────────────
  // Full catalog with per-path state so the UI can show transparency rows
  // (dotfiles-managed grayed, credentials visibly never-backed-up). ADR-0022.
  server.get("/api/aitools/catalog", async (_req, reply) => {
    const cat = loadAiToolsCatalog(repoDir);
    const sel = loadSelection(repoDir);
    const selected = new Set(sel.modules["aitools"] ?? []);
    const dotfilesSel = new Set(sel.modules["dotfiles"] ?? []);
    const home = os.homedir();
    const neverAbs = new Set(NEVER_BACKUP.map((r) => path.join(home, r)));
    const tools = cat.map((t) => ({
      id: t.id,
      label: t.label,
      paths: t.paths.flatMap((p) => {
        const abs = path.join(home, p.path);
        const exists = fs.existsSync(abs);
        const state = neverAbs.has(abs) ? "never"
          : !exists ? "missing"
          : selected.has(abs) ? "selected"
          : dotfilesSel.has(abs) ? "dotfiles"
          : "available";
        return [{ path: abs, kind: p.kind, encrypt: p.encrypt ?? false, state }];
      }),
    }));
    // credentials are not catalog entries — append them per owning tool by prefix match
    for (const rel of NEVER_BACKUP) {
      const abs = path.join(home, rel);
      if (!fs.existsSync(abs)) continue;
      const owner = tools.find((t) => cat.find((c) => c.id === t.id)!.paths.some((p) => path.join(home, p.path).startsWith(path.dirname(abs))))
        ?? tools[0];
      owner?.paths.push({ path: abs, kind: "data", encrypt: false, state: "never" });
    }
    return reply.send({ tools });
  });
```

   归属兜底:`.claude.json` → claude-code、`.codex/auth.json` → codex、`.gemini/.env` → gemini——若 prefix 匹配不可靠,直接用这三条硬映射替换上面的 owner 查找(以测试断言为准,实现者择稳)。
   Server test:临时 home 内造 `.claude/CLAUDE.md`(available)、把某路径加进 dotfiles selection(dotfiles)、造 `.claude.json`(never),断言三种 state;missing 不返回…(注:missing 仍返回但 state="missing",由前端隐藏——按上面实现,两种皆可,测试与实现一致即可,推荐返回+前端隐藏,信息完整)。

2. **api.ts**:

```ts
export interface AiCatalogPath { path: string; kind: "memory" | "settings" | "mcp" | "data"; encrypt: boolean; state: "selected" | "available" | "dotfiles" | "never" | "missing" }
export interface AiCatalogTool { id: string; label: string; paths: AiCatalogPath[] }
export function getAiToolsCatalog(): Promise<{ tools: AiCatalogTool[] }> {
  return apiFetch("/api/aitools/catalog");
}
```

3. **AiBackup.tsx**:按工具分组渲染(组头=label+可纳管计数);每行 mono 路径 + kind chip(`ai.kind.*`)+ encrypt 时 Phosphor `Lock` 小标(`ai.encrypted`);state 渲染:
   - `available` → coral「添加」(`addSelection("aitools", path)` → 刷新 + Hud);
   - `selected` → 绿色「✓ 已纳管」+ ghost「移除」(`removeSelection`);
   - `dotfiles` → 整行 `opacity:.55` + 注「已在 dotfiles 管理」(`ai.managedByDotfiles`);
   - `never` → 整行灰 + 「🚫」用 Phosphor `Prohibit` 图标 + `ai.neverNote`;
   - `missing` → 不渲染。
   顶部 tagline(`ai.tagline`)。组件 props `{ showHud?: (m: HudMessage) => void }`。
4. **i18n 增补**(在 Task 4 原有 `ai.*` 基础上,删除不再使用的 `ai.empty` 若无处可用则保留作全空状态):

```ts
  "ai.managedByDotfiles": { en: "managed under Dotfiles", zh: "已在 dotfiles 管理" },
  "ai.neverNote": { en: "credential file — never backed up (session tokens; backing up only adds risk)", zh: "凭据文件 — 永不备份(会话令牌,备份只增风险)" },
  "ai.tab.backup": { en: "Config backup", zh: "配置备份" },
  "ai.tab.skills": { en: "Skills", zh: "Skills" },
```

5. 测试:mock `getAiToolsCatalog` 返回四种 state 各一,断言:available 行点添加调 `addSelection`;dotfiles/never 行灰显且无按钮;missing 不出现。验证门照旧(tests+lint+`pnpm -r typecheck`),提交信息 `feat(web): AiBackup tab content + aitools catalog endpoint`。

## R1-B:新 Task 10 —「IA 重组」(在 T4 之后执行)

**Files:** Create `packages/web/src/views/AiTools.tsx`(容器)、`packages/web/src/components/DiffPane.tsx`(从 Drift 提取);Modify `packages/web/src/App.tsx`、`packages/web/src/views/SyncState.tsx`、`packages/web/src/views/Settings.tsx`、`packages/web/src/components/CommandPalette.tsx`、`packages/web/src/i18n/strings.ts`;Delete `packages/web/src/views/Drift.tsx`;Tests:`packages/web/src/AiTools.test.tsx` + 受影响的 `App.test.tsx`/`Skills.test.tsx` 修正。

1. **AiTools 容器**:

```tsx
import { useState } from "react";
import { useT } from "../i18n";
import type { HudMessage } from "../components/Hud";
import { AiBackup } from "./AiBackup";
import { Skills } from "./Skills";

export function AiTools({ showHud }: { showHud?: (m: HudMessage) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<"backup" | "skills">("backup");
  const tabBtn = (active: boolean): React.CSSProperties => ({ appearance: "none", fontFamily: "var(--font)", fontSize: 13, fontWeight: active ? 600 : 400, padding: "6px 14px", borderRadius: 8, cursor: "pointer", background: active ? "var(--raise)" : "transparent", border: active ? "1px solid var(--border)" : "1px solid transparent", color: active ? "var(--text)" : "var(--muted)" });
  return (
    <div>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px", display: "flex", gap: 6, marginBottom: 14 }}>
        <button onClick={() => setTab("backup")} style={tabBtn(tab === "backup")}>{t("ai.tab.backup")}</button>
        <button onClick={() => setTab("skills")} style={tabBtn(tab === "skills")}>{t("ai.tab.skills")}</button>
      </div>
      {tab === "backup" ? <AiBackup showHud={showHud} /> : <Skills />}
    </div>
  );
}
```

   (核对 Skills 组件实际 props——若它要求 showHud 等则透传。)
2. **侧边栏终稿**(App.tsx):去掉「模块」组标题渲染与 `nav.modulesGroup` 使用;三段结构:
   `NAV_MAIN = [overview, sync, timeline]` · `NAV_CONTENT = [aitools, dotfiles, env, packages, appconfig, projects]`(**顺序即此**)· `NAV_TAIL = [settings]`;段间细分隔线沿用现有样式。`Tab` union:去掉 `"drift" | "setup" | "skills"`,加 `"aitools"`;路由:`{activeTab === "aitools" && <AiTools showHud={showHud} />}`;删除 Drift/Setup/Skills 三条路由(Setup 组件保留,见 4)。
3. **同步复核吸收偏移**:提取 Drift.tsx 的 `DiffPane` 到 `components/DiffPane.tsx`;SyncState 工具栏加视图切换(`sync.view.items` 默认 |「原始 diff」`sync.view.raw`),raw 视图= Drift 原逻辑(getStatus 模块列表 + getDiff 渲染 DiffPane);删除 Drift.tsx 与 `nav.drift`;⌘K 的 drift 命令改为打开 sync(文案沿用「查看差异」语义,改 key 为现有 sync 文案)。
4. **设置嵌入环境检查**:Settings 顶部(Repo 区之前)加 `sectionLabel t("setup.title")` + `<Setup embedded />`;删除 `nav.setup` 与侧边栏项;Overview 的 `onOpenSetup` 与引导里的跳转改为 `setActiveTab("settings")`(Overview props 不变,App 传入的回调改向)。
5. **改名**:`overview.moduleHealth` 值改为 `{ en: "Backup Health", zh: "备份健康度" }`(key 不动,避免连锁);新增

```ts
  "sync.view.items": { en: "Items", zh: "逐项" },
  "sync.view.raw": { en: "Raw diff", zh: "原始 diff" },
```

   删除 strings 中 `nav.drift`、`nav.setup`、`nav.modulesGroup`(grep 确认零引用后)。
6. 测试:AiTools 容器双标签切换渲染两个子组件;App 级:aitools 入口出现、drift/setup 入口消失、⌘K drift 命令落到 sync;受影响旧测试(若有直接 render Skills 路由断言)就地修正。提交 `feat(web): IA restructure — AI Tools container, sidebar flatten, drift/setup merges`。

## R1-C:Task 7 修订(Timeline 交互)

在 Task 7 原内容上叠加:
1. **timeline 端点带 body**:`/api/timeline` 的 pretty 改为 `--pretty=format:%H%x1f%s%x1f%cI%x1f%b%x1e`,按 `\x1e` 切记录再按 `\x1f` 取字段,`TimelineEntry` 增 `body?: string`(api.ts 同步);web 提交行可点击展开 body(等宽小字块,行内 `▾/▴`);
2. **文件历史**:列表第一条(最新)渲染禁用态「`history.current`(当前版本)」代替恢复按钮;
3. **恢复成功**提示行加「`history.goSync`(去同步复核)」按钮 → Timeline 新增可选 prop `onOpenSync?: () => void`(App 传 `() => setActiveTab("sync")`);
4. i18n 增:`"history.current": { en: "current", zh: "当前版本" }`、`"history.goSync": { en: "Open Sync Review", zh: "去同步复核" }`;
5. 对应测试:展开行显示 body;最新条无恢复按钮;成功后点 goSync 触发 onOpenSync。

## R1 自审
- 四种 state 的命名在 R1-A 服务端/类型/UI/测试一致;`ai.tab.*` 在 R1-A 定义、R1-B 消费;DiffPane 提取后 Drift 删除无悬挂引用(grep `from "./Drift"`);`onOpenSetup` 改道后 Overview/引导不破(props 名不变);执行顺序保证 AiBackup 先于容器存在。
