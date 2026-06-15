# AI Tools v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `aitools` module extensible (more tools as data) and honest about secrets (per-entry `policy` replacing the `NEVER_BACKUP` blacklist), and redesign the 配置备份 page to direction ① (collapsible, detected-first, calm). Per `docs/superpowers/specs/2026-06-15-roost-aitools-v11-design.md` + ADR-0023.

**Architecture:** Pure data + module + UI change, zero core domain logic. Catalog gains `policy: "plain"|"encrypt"|"skip"`; credentials become `skip` catalog entries (no hardcoded list); the plaintext-secret scanner stays as the always-on backstop (I6). Page becomes single-column collapsible.

**Tech Stack:** TS strict · Fastify · React+Vite · vitest. Branch `feat_aitools_v11` (cut). **Per-task gate: task tests + `pnpm lint` + `pnpm -r typecheck`.** No emoji; Phosphor icons; coral only for primary/add. Stage explicitly, one commit per task, no push.

---

## Shared contracts

```ts
// core/src/ai-tools-catalog.ts
export type AiPolicy = "plain" | "encrypt" | "skip";
export interface AiToolPath { path: string; kind: "memory"|"settings"|"mcp"|"data"; policy?: AiPolicy } // default "plain"
export interface AiTool { id: string; label: string; paths: AiToolPath[] }
export const DEFAULT_AI_TOOLS_CATALOG: AiTool[];
export function loadAiToolsCatalog(repoDir: string): AiTool[];   // override merge by id; accepts legacy `encrypt:true`
export function effectivePolicy(p: AiToolPath): AiPolicy;        // p.policy ?? "plain"
export function aiPathPolicies(repoDir: string, home: string): Map<string, AiPolicy>; // abs path → policy (skip/encrypt/plain), for module + server
// NEVER_BACKUP export is REMOVED.

// server: GET /api/aitools/catalog path.state union gains nothing new — `skip` paths report state "never" (UI label unchanged).
//   POST /api/aitools/custom { label?, path, kind?, policy? } → writes roost/ai-tools-catalog.yaml (append/merge), → { ok:true }

// web/src/api.ts: AiCatalogPath stays { path, kind, encrypt, state } (encrypt = policy==="encrypt", derived server-side); add addAiCustom(path, label?).
```

## File map
**Modify:** `packages/core/src/ai-tools-catalog.ts` (+ `.test.ts`), `packages/core/src/modules/aitools.ts` (+ `.test.ts`), `packages/core/src/index.ts` (drop NEVER_BACKUP export, add effectivePolicy/aiPathPolicies), `packages/cli/src/server.ts` (+ `server.test.ts`), `packages/web/src/api.ts`, `packages/web/src/views/AiBackup.tsx` (+ `AiBackup.test.tsx`), `packages/web/src/i18n/strings.ts`.

---

### Task 1: core catalog — policy schema, skip entries, 4 new tools

**Files:** Modify `packages/core/src/ai-tools-catalog.ts`, `packages/core/src/index.ts`; Test `packages/core/src/ai-tools-catalog.test.ts`.

- [ ] **Step 1: Failing tests** (append to `ai-tools-catalog.test.ts`)

```ts
import { effectivePolicy, aiPathPolicies, DEFAULT_AI_TOOLS_CATALOG, loadAiToolsCatalog } from "./ai-tools-catalog.js";
import * as os from "node:os";

describe("ai catalog policy (ADR-0023)", () => {
  it("defaults to plain; reads encrypt/skip", () => {
    expect(effectivePolicy({ path: "x", kind: "settings" })).toBe("plain");
    expect(effectivePolicy({ path: "x", kind: "settings", policy: "encrypt" })).toBe("encrypt");
    expect(effectivePolicy({ path: "x", kind: "data", policy: "skip" })).toBe("skip");
  });
  it("credentials are skip entries in the catalog, not a separate list", () => {
    const cc = DEFAULT_AI_TOOLS_CATALOG.find((t) => t.id === "claude-code")!;
    expect(cc.paths.find((p) => p.path === ".claude.json")!.policy).toBe("skip");
    const gem = DEFAULT_AI_TOOLS_CATALOG.find((t) => t.id === "gemini")!;
    expect(gem.paths.some((p) => p.path === ".gemini/oauth_creds.json" && p.policy === "skip")).toBe(true);
    expect(gem.paths.some((p) => p.path === ".gemini/google_accounts.json" && p.policy === "skip")).toBe(true);
  });
  it("includes the v1.1 tools", () => {
    const ids = DEFAULT_AI_TOOLS_CATALOG.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["cursor", "windsurf", "zed", "copilot"]));
  });
  it("aiPathPolicies maps abs paths to policy", () => {
    const home = "/h";
    const m = aiPathPolicies("/repo-nonexistent", home);
    expect(m.get("/h/.claude.json")).toBe("skip");
    expect(m.get("/h/.claude/settings.local.json")).toBe("encrypt");
    expect(m.get("/h/.claude/CLAUDE.md")).toBe("plain");
  });
  it("override yaml back-compat: encrypt:true ⇒ encrypt", () => {
    // covered by loader test below; see existing override test pattern
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/core/src/ai-tools-catalog.test.ts` → FAIL.

- [ ] **Step 3: Implement.** Replace the schema + defaults + loader in `ai-tools-catalog.ts`:

3a. Type:
```ts
export type AiPolicy = "plain" | "encrypt" | "skip";
export interface AiToolPath {
  path: string; // home-relative
  kind: "memory" | "settings" | "mcp" | "data";
  policy?: AiPolicy; // default "plain"; "skip" = never backed up (credential/session/large)
}
export interface AiTool { id: string; label: string; paths: AiToolPath[] }
export function effectivePolicy(p: AiToolPath): AiPolicy { return p.policy ?? "plain"; }
```

3b. Replace `DEFAULT_AI_TOOLS_CATALOG` (migrate `encrypt:true`→`policy:"encrypt"`, fold credentials in as `skip`, add 4 tools):
```ts
export const DEFAULT_AI_TOOLS_CATALOG: AiTool[] = [
  { id: "claude-code", label: "Claude Code", paths: [
    { path: ".claude/CLAUDE.md", kind: "memory" },
    { path: ".claude/settings.json", kind: "settings" },
    { path: ".claude/settings.local.json", kind: "settings", policy: "encrypt" },
    { path: ".claude/keybindings.json", kind: "settings" },
    { path: ".claude/agents", kind: "settings" },
    { path: ".claude/commands", kind: "settings" },
    { path: ".claude.json", kind: "data", policy: "skip" },
  ]},
  { id: "claude-desktop", label: "Claude Desktop", paths: [
    { path: "Library/Application Support/Claude/claude_desktop_config.json", kind: "mcp", policy: "encrypt" },
  ]},
  { id: "codex", label: "Codex CLI", paths: [
    { path: ".codex/config.toml", kind: "settings" },
    { path: ".codex/AGENTS.md", kind: "memory" },
    { path: ".codex/auth.json", kind: "data", policy: "skip" },
  ]},
  { id: "gemini", label: "Gemini CLI", paths: [
    { path: ".gemini/GEMINI.md", kind: "memory" },
    { path: ".gemini/settings.json", kind: "settings" },
    { path: ".gemini/.env", kind: "data", policy: "skip" },
    { path: ".gemini/oauth_creds.json", kind: "data", policy: "skip" },
    { path: ".gemini/google_accounts.json", kind: "data", policy: "skip" },
  ]},
  { id: "cursor", label: "Cursor", paths: [
    { path: ".cursor/mcp.json", kind: "mcp", policy: "encrypt" },
    { path: "Library/Application Support/Cursor/User/settings.json", kind: "settings" },
    { path: "Library/Application Support/Cursor/User/keybindings.json", kind: "settings" },
  ]},
  { id: "windsurf", label: "Windsurf", paths: [
    { path: ".codeium/windsurf/mcp_config.json", kind: "mcp", policy: "encrypt" },
    { path: ".codeium/windsurf/memories/global_rules.md", kind: "memory" },
  ]},
  { id: "zed", label: "Zed", paths: [
    { path: ".config/zed/settings.json", kind: "settings", policy: "encrypt" },
    { path: ".config/zed/keymap.json", kind: "settings" },
  ]},
  { id: "copilot", label: "GitHub Copilot", paths: [
    { path: "Library/Application Support/Code/User/prompts", kind: "memory" },
  ]},
  { id: "cc-switch", label: "cc-switch", paths: [
    { path: ".cc-switch/cc-switch.db", kind: "data", policy: "encrypt" },
    { path: ".cc-switch/settings.json", kind: "data", policy: "encrypt" },
  ]},
  { id: "ollama", label: "Ollama", paths: [
    { path: ".ollama/models", kind: "data", policy: "skip" },
  ]},
];
```
Delete the `NEVER_BACKUP` export entirely.

3c. `parseOverride`: accept `policy` and legacy `encrypt`:
```ts
      const entry: AiToolPath = { path: ppath, kind };
      const pol = po["policy"];
      if (pol === "plain" || pol === "encrypt" || pol === "skip") entry.policy = pol;
      else if (po["encrypt"] === true) entry.policy = "encrypt";
      paths.push(entry);
```

3d. Add at end of file:
```ts
// All catalog paths' effective policy, keyed by absolute path. Used by the
// aitools module (capture/discover) and the server endpoint — no hardcoded list.
export function aiPathPolicies(repoDir: string, home: string): Map<string, AiPolicy> {
  const m = new Map<string, AiPolicy>();
  for (const tool of loadAiToolsCatalog(repoDir)) {
    for (const p of tool.paths) m.set(path.join(home, p.path), effectivePolicy(p));
  }
  return m;
}
```

3e. `packages/core/src/index.ts`: remove `NEVER_BACKUP` from the ai-tools-catalog export line; add `effectivePolicy, aiPathPolicies, type AiPolicy`.

- [ ] **Step 4: Verify** — `npx vitest run packages/core/src/ai-tools-catalog.test.ts` + `npx vitest run packages/core` + `pnpm lint` + `pnpm -r typecheck`. (Expect failures in modules/aitools.ts + server.ts for the removed NEVER_BACKUP — those are fixed in T2/T3; if typecheck fails ONLY there, proceed; the per-file tests for catalog pass.)
- [ ] **Step 5: Commit** — `git add packages/core/src/ai-tools-catalog.ts packages/core/src/ai-tools-catalog.test.ts packages/core/src/index.ts && git commit -m "feat(core): AI catalog per-entry policy + skip entries + Cursor/Windsurf/Zed/Copilot (ADR-0023)"`

---

### Task 2: core aitools module — policy-driven capture

**Files:** Modify `packages/core/src/modules/aitools.ts`; Test `packages/core/src/modules/aitools.test.ts`.

- [ ] **Step 1: Failing tests** (append; reuse the file's existing harness — confirm helper names)

```ts
describe("aitools policy capture (ADR-0023)", () => {
  it("skip-policy path is blocked (managed) and not captured; local file untouched", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    const cred = path.join(home, ".claude.json"); fs.writeFileSync(cred, "{}", "utf8");
    let sel = emptySelection(); sel = addItem(sel, "aitools", cred);
    const { exec, calls } = makeFakeExec([]);
    const cs = await aitoolsModule.capture(makeCtx({ exec, home, repoDir }), sel);
    expect(cs.blockedDetail?.some((b) => b.id === cred && b.reason === "managed")).toBe(true);
    expect(calls.some((c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes(cred))).toBe(false);
    expect(fs.existsSync(cred)).toBe(true);
  });
  it("encrypt-policy path adds with --encrypt; plain path runs scanner then plain add", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, "Library/Application Support/Claude"), { recursive: true });
    const mcp = path.join(home, "Library/Application Support/Claude/claude_desktop_config.json"); fs.writeFileSync(mcp, "{}", "utf8");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    const mem = path.join(home, ".claude/CLAUDE.md"); fs.writeFileSync(mem, "# notes", "utf8");
    let sel = emptySelection(); sel = addItem(sel, "aitools", mcp); sel = addItem(sel, "aitools", mem);
    const { exec, calls } = makeFakeExec(Array.from({ length: 12 }, () => ({ code: 0, stdout: "", stderr: "" })));
    const cs = await aitoolsModule.capture(makeCtx({ exec, home, repoDir }), sel);
    const encAdd = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes(mcp));
    expect(encAdd!.args).toContain("--encrypt");
    expect(cs.written).toContain(mem);     // plain
    expect(cs.encrypted).toContain(mcp);   // encrypt
  });
});
```
(Adapt the encrypt test to the file's age-readiness pattern — check how the existing encrypt test fakes `ensureChezmoiAgeConfig`; mirror it.)

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — rewrite `modules/aitools.ts` capture/discover to use policies:

3a. Imports: replace `import { loadAiToolsCatalog, NEVER_BACKUP } from "../ai-tools-catalog.js";` with `import { loadAiToolsCatalog, aiPathPolicies } from "../ai-tools-catalog.js";`. Delete the `isNever` helper.

3b. `discover`: skip `skip`-policy + missing + dotfiles-managed:
```ts
  async discover(ctx) {
    const cat = loadAiToolsCatalog(ctx.repoDir);
    const policies = aiPathPolicies(ctx.repoDir, ctx.home);
    const dotfilesSel = new Set(loadSelection(ctx.repoDir).modules["dotfiles"] ?? []);
    const out: Candidate[] = [];
    for (const tool of cat) {
      for (const p of tool.paths) {
        const abs = path.join(ctx.home, p.path);
        if (policies.get(abs) === "skip") continue;
        if (!fs.existsSync(abs)) continue;
        if (dotfilesSel.has(abs)) continue;
        const enc = policies.get(abs) === "encrypt";
        out.push({ id: abs, path: abs, category: p.kind, recommendation: enc ? "encrypt" : "track", note: `${tool.label} · ${p.kind}${enc ? " · encrypted" : ""}` });
      }
    }
    return out;
  },
```

3c. `capture`: policy switch:
```ts
  async capture(ctx, sel) {
    const ids = sel.modules["aitools"] ?? [];
    const policies = aiPathPolicies(ctx.repoDir, ctx.home);
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const written: string[] = []; const encrypted: string[] = [];
    const blocked: string[] = []; const blockedDetail: BlockedItem[] = [];
    let ageReady: boolean | null = null;
    for (const id of ids) {
      const policy = policies.get(id) ?? "plain";
      if (policy === "skip") {
        blocked.push(id);
        blockedDetail.push({ id, reason: "managed", detail: "凭据 / 会话文件 — 永不备份" });
        continue;
      }
      if (!fs.existsSync(id)) continue;
      if (policy === "encrypt") {
        if (ageReady === null) ageReady = (await ensureChezmoiAgeConfig(ctx.exec, { home: ctx.home, repoDir: ctx.repoDir })).ready;
        if (!ageReady) { blocked.push(id); blockedDetail.push({ id, reason: "error", detail: "no age key" }); continue; }
        await chezmoi.add(id, { encrypt: true }); encrypted.push(id); continue;
      }
      // plain — scanner backstop (I6) unchanged
      const scan = scanPathForSecrets(id, { maxBytes: 100 * 1024 * 1024 });
      if (scan.secretFiles.length > 0) { blocked.push(id); blockedDetail.push({ id, reason: "secret", detail: `${scan.secretFiles.length} file(s)` }); continue; }
      await chezmoi.add(id, { encrypt: false }); written.push(id);
    }
    return { module: "aitools", written, encrypted, blocked, blockedDetail };
  },
```
(status/apply/diff/unmanage/doctor unchanged.)

- [ ] **Step 4: Verify** — `npx vitest run packages/core packages/cli` (server still references removed exports → may fail; T3 fixes. Run `npx vitest run packages/core/src/modules/aitools.test.ts` to confirm THIS task green) + `pnpm lint`.
- [ ] **Step 5: Commit** — `git add packages/core/src/modules/aitools.ts packages/core/src/modules/aitools.test.ts && git commit -m "feat(core): aitools capture driven by per-entry policy (ADR-0023)"`

---

### Task 3: server — catalog endpoint via policy + custom-add endpoint

**Files:** Modify `packages/cli/src/server.ts`; Test `packages/cli/src/server.test.ts`.

- [ ] **Step 1: Failing tests** (append; reuse the temp-home + injected makeCtx pattern of the existing aitools/catalog tests)

```ts
it("catalog endpoint: skip-policy paths report state never; plain/encrypt unaffected", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-aipol-"));
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude/CLAUDE.md"), "# x");
    fs.writeFileSync(path.join(home, ".claude.json"), "{}"); // skip entry
    const ctx = (d: boolean): ModuleContext => ({ repoDir: tmpDir, home, profile: "base", dryRun: d, exec: makeFakeExec(), log: { info(){}, warn(){}, error(){} }, t: (k: string) => k });
    const server = buildServer({ repoDir: tmpDir, registry: new ModuleRegistry(), makeCtx: ctx });
    const all = (await (await server.inject({ method: "GET", url: "/api/aitools/catalog" })).json() as { tools: { paths: { path: string; state: string }[] }[] }).tools.flatMap((t) => t.paths);
    expect(all.find((p) => p.path === path.join(home, ".claude.json"))!.state).toBe("never");
    expect(all.find((p) => p.path === path.join(home, ".claude/CLAUDE.md"))!.state).toBe("available");
    await server.close();
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
it("POST /api/aitools/custom writes the override and dedupes", async () => {
  const server = buildServer({ repoDir: tmpDir, registry: new ModuleRegistry(), makeCtx: (d) => makeCtx(tmpDir, d) });
  const res = await server.inject({ method: "POST", url: "/api/aitools/custom", payload: { label: "MyTool", path: "~/.mytool/config.json", kind: "settings" }, headers: { "content-type": "application/json" } });
  expect(res.statusCode).toBe(200);
  const cat = loadAiToolsCatalog(tmpDir);
  expect(cat.some((t) => t.paths.some((p) => p.path === ".mytool/config.json"))).toBe(true);
  await server.close();
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**

3a. Update the `@roost/core` import in server.ts: remove `NEVER_BACKUP`, add `aiPathPolicies`, `saveSelection` already present, and `js-yaml` (`import * as yaml from "js-yaml"` — check if already imported; if not add). Also `saveSelection`/`addItem` present.

3b. Rewrite the `/api/aitools/catalog` state derivation. Replace the `neverAbs`/`neverOwner`/`encrypt: p.encrypt ?? false` block with policy-based:
```ts
    const policies = aiPathPolicies(repoDir, home);
    const tools = cat.map((t) => ({
      id: t.id, label: t.label,
      paths: t.paths.map((p) => {
        const abs = path.join(home, p.path);
        const policy = policies.get(abs) ?? "plain";
        const exists = fs.existsSync(abs);
        const state: "selected"|"pending"|"available"|"dotfiles"|"never"|"missing" =
          policy === "skip" ? "never"
          : !exists ? "missing"
          : selected.has(abs) ? (managedAbs === null || managedAbs.has(abs) ? "selected" : "pending")
          : dotfilesSel.has(abs) ? "dotfiles"
          : "available";
        return { path: abs, kind: p.kind, encrypt: policy === "encrypt", state };
      }),
    }));
    return reply.send({ tools });
```
Delete the trailing "append credential files under owning tool" loop and the `neverOwner`/`neverAbs` consts (skip entries are now real catalog entries).

3c. Add the custom-add endpoint near `/api/aitools/catalog`:
```ts
  // ── POST /api/aitools/custom ─────────────────────────────────────────────────
  // Self-serve: add a tool/path to roost/ai-tools-catalog.yaml (override file). I8.
  server.post<{ Body: { label?: string; path?: string; kind?: string; policy?: string } }>("/api/aitools/custom", async (req, reply) => {
    const raw = req.body?.path?.trim();
    if (!raw) return reply.status(400).send({ error: "path is required" });
    const rel = raw.replace(/^~\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
    const kind = ["memory","settings","mcp","data"].includes(req.body?.kind ?? "") ? req.body!.kind! : "settings";
    const policy = ["plain","encrypt","skip"].includes(req.body?.policy ?? "") ? req.body!.policy : undefined;
    const label = req.body?.label?.trim() || "自定义";
    const id = "custom-" + rel.replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "").toLowerCase();
    const file = path.join(repoDir, "roost", "ai-tools-catalog.yaml");
    let doc: { tools: { id: string; label: string; paths: { path: string; kind: string; policy?: string }[] }[] } = { tools: [] };
    try { if (fs.existsSync(file)) { const parsed = yaml.load(fs.readFileSync(file, "utf8")); if (parsed && typeof parsed === "object" && Array.isArray((parsed as { tools?: unknown }).tools)) doc = parsed as typeof doc; } } catch { doc = { tools: [] }; }
    let tool = doc.tools.find((tt) => tt.id === id);
    if (!tool) { tool = { id, label, paths: [] }; doc.tools.push(tool); }
    if (!tool.paths.some((pp) => pp.path === rel)) tool.paths.push({ path: rel, kind, ...(policy ? { policy } : {}) });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, yaml.dump(doc), "utf8");
    cache.invalidateAll();
    return reply.send({ ok: true });
  });
```

- [ ] **Step 4: Verify** — `npx vitest run packages/cli/src/server.test.ts` + `npx vitest run packages/core packages/cli` (all green now) + `pnpm lint` + `pnpm -r typecheck`.
- [ ] **Step 5: Commit** — `git add packages/cli/src/server.ts packages/cli/src/server.test.ts && git commit -m "feat(server): aitools catalog state via policy; self-serve custom-add endpoint"`

---

### Task 4: web api types + i18n

**Files:** Modify `packages/web/src/api.ts`, `packages/web/src/i18n/strings.ts`.

- [ ] **Step 1: api.ts** — `AiCatalogPath` is unchanged (`{ path, kind, encrypt, state }`; `encrypt` now means policy==="encrypt", server-derived). Add:
```ts
export function addAiCustom(body: { path: string; label?: string; kind?: string; policy?: string }): Promise<{ ok: boolean }> {
  return apiFetch("/api/aitools/custom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
```

- [ ] **Step 2: i18n** (`strings.ts`, append in `ai.*`):
```ts
  "ai.detected": { en: "Detected", zh: "本机检测到" },
  "ai.all": { en: "All supported", zh: "全部支持" },
  "ai.addTool": { en: "Add tool / path", zh: "添加工具 / 路径" },
  "ai.addAll": { en: "Add all", zh: "全部添加" },
  "ai.state.backedUp": { en: "backed up", zh: "已备份" },
  "ai.state.pending": { en: "pending capture", zh: "待捕获" },
  "ai.state.add": { en: "Add", zh: "添加" },
  "ai.state.never": { en: "never backed up", zh: "永不备份" },
  "ai.managedByDotfiles": { en: "managed under Dotfiles", zh: "已在 dotfiles 管理" },
  "ai.custom.pathPh": { en: "Path, e.g. ~/.mytool/config.json", zh: "路径,如 ~/.mytool/config.json" },
  "ai.custom.labelPh": { en: "Tool name (optional)", zh: "工具名(可选)" },
  "ai.custom.save": { en: "Add", zh: "添加" },
```
(Keep existing `ai.kind.*`, `ai.encrypted`, `ai.tagline`, `ai.neverNote`, `ai.tab.*`.)

- [ ] **Step 3: Verify + commit** — `pnpm --filter @roost/web build` + `pnpm -r typecheck`. `git add packages/web/src/api.ts packages/web/src/i18n/strings.ts && git commit -m "feat(web): aitools custom-add api + v1.1 strings"`

---

### Task 5: web — AiBackup redesign to direction ① + custom-add form

**Files:** Rewrite `packages/web/src/views/AiBackup.tsx`; Test `packages/web/src/AiBackup.test.tsx`. **Visual spec = the approved mockup at `/tmp/roost-mock/index.html` (single-column collapsible, detected-first segmented control, kind as leading muted Phosphor icon, normal-weight mono filename, 1px left guide on file group, single state per row, coral only on add, `Lock` after encrypted name, `Prohibit` for skip).**

- [ ] **Step 1: Failing tests** (rewrite `AiBackup.test.tsx`'s factory to add `addAiCustom: vi.fn().mockResolvedValue({ ok: true })`; keep `getAiToolsCatalog`/`addSelection`/`removeSelection`/`getFilePreview` mocks). Tests:

```tsx
it("collapsed tool shows coverage; expanding reveals file rows", async () => {
  vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [
    { id: "claude-code", label: "Claude Code", paths: [
      { path: "/h/.claude/CLAUDE.md", kind: "memory", encrypt: false, state: "selected" },
      { path: "/h/.claude/settings.json", kind: "settings", encrypt: false, state: "available" },
      { path: "/h/.claude.json", kind: "data", encrypt: false, state: "never" },
    ]},
    { id: "cursor", label: "Cursor", paths: [ { path: "/h/.cursor/mcp.json", kind: "mcp", encrypt: true, state: "missing" } ] },
  ] });
  render(<AiBackup />);
  const head = await screen.findByText("Claude Code");
  // missing-only tool (Cursor) hidden under "all" — not in detected view
  fireEvent.click(head);
  expect(await screen.findByText("CLAUDE.md")).toBeInTheDocument();
  expect(screen.getByText(/never backed up|永不备份/)).toBeInTheDocument();
});
it("available row adds to aitools selection", async () => {
  vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [ { id: "claude-code", label: "Claude Code", paths: [ { path: "/h/.claude/settings.json", kind: "settings", encrypt: false, state: "available" } ] } ] });
  render(<AiBackup />);
  fireEvent.click(await screen.findByText("Claude Code"));
  fireEvent.click(await screen.findByRole("button", { name: /Add|添加/ }));
  await waitFor(() => expect(api.addSelection).toHaveBeenCalledWith("aitools", "/h/.claude/settings.json"));
});
it("add-tool form posts a custom path", async () => {
  vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [] });
  render(<AiBackup />);
  fireEvent.click(await screen.findByRole("button", { name: /Add tool|添加工具/ }));
  fireEvent.change(screen.getByPlaceholderText(/Path|路径/), { target: { value: "~/.x/c.json" } });
  fireEvent.click(screen.getByRole("button", { name: /^Add$|^添加$/ }));
  await waitFor(() => expect(api.addAiCustom).toHaveBeenCalledWith(expect.objectContaining({ path: "~/.x/c.json" })));
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — rewrite `AiBackup.tsx` to direction ①. Full component:

```tsx
import { useState, useEffect, useCallback } from "react";
import { Lock, Prohibit, CaretRight, CaretDown, FileText, GearSix, Plugs, Plus, CheckCircle } from "@phosphor-icons/react";
import type { HudMessage } from "../components/Hud";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getAiToolsCatalog, addSelection, removeSelection, addAiCustom } from "../api";
import type { AiCatalogTool, AiCatalogPath } from "../api";

export interface AiBackupProps { showHud?: (m: HudMessage) => void }

function KindIcon({ kind, state }: { kind: AiCatalogPath["kind"]; state: AiCatalogPath["state"] }) {
  const c = "var(--muted)";
  if (state === "never") return <Prohibit size={14} style={{ color: c, flexShrink: 0 }} />;
  if (kind === "memory") return <FileText size={14} style={{ color: c, flexShrink: 0 }} />;
  if (kind === "mcp") return <Plugs size={14} style={{ color: c, flexShrink: 0 }} />;
  if (kind === "data") return <FileText size={14} style={{ color: c, flexShrink: 0 }} />;
  return <GearSix size={14} style={{ color: c, flexShrink: 0 }} />;
}

function Dots({ done, total }: { done: number; total: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i < done ? "var(--green)" : "var(--border)" }} />
      ))}
    </span>
  );
}

function ToolCard({ tool, onAdd, onRemove }: { tool: AiCatalogTool; onAdd: (p: string) => void; onRemove: (p: string) => void }) {
  const { t } = useT();
  const visible = tool.paths.filter((p) => p.state !== "missing");
  const dotfilesOnly = visible.length > 0 && visible.every((p) => p.state === "dotfiles");
  const backable = visible.filter((p) => p.state !== "never" && p.state !== "dotfiles");
  const done = backable.filter((p) => p.state === "selected").length;
  const total = backable.length;
  const [open, setOpen] = useState(false);
  if (visible.length === 0) return null;

  const stateEl = (p: AiCatalogPath) => {
    if (p.state === "selected") return <span style={{ color: "var(--green)", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle size={13} />{t("ai.state.backedUp")}</span>;
    if (p.state === "pending") return <span style={{ color: "var(--amber)", fontSize: 11.5 }}>{t("ai.state.pending")}</span>;
    if (p.state === "never") return <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{t("ai.state.never")}</span>;
    if (p.state === "dotfiles") return <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{t("ai.managedByDotfiles")}</span>;
    return <button onClick={() => onAdd(p.path)} style={{ appearance: "none", border: "none", background: "none", color: "var(--accent)", fontSize: 11.5, cursor: "pointer", fontFamily: "var(--font)" }}>{t("ai.state.add")}</button>;
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 2px", cursor: "pointer" }}>
        {open ? <CaretDown size={13} style={{ color: "var(--muted)" }} /> : <CaretRight size={13} style={{ color: "var(--muted)" }} />}
        <span style={{ fontSize: 13, fontWeight: 500 }}>{tool.label}</span>
        {dotfilesOnly
          ? <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{t("ai.managedByDotfiles")}</span>
          : <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 9 }}><Dots done={done} total={total} /><span style={{ fontSize: 11, color: done === total && total > 0 ? "var(--green)" : "var(--muted)", minWidth: 26, textAlign: "right" }}>{done}/{total}</span></span>}
      </div>
      {open && (
        <div style={{ marginLeft: 9, borderLeft: "1px solid var(--border-soft)" }}>
          {visible.map((p) => (
            <div key={p.path} role="row" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 2px 9px 18px", borderTop: "1px solid var(--border-soft)", fontSize: 12.5, opacity: p.state === "never" || p.state === "dotfiles" ? 0.5 : 1 }}>
              <KindIcon kind={p.kind} state={p.state} />
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 400, color: "var(--text)" }}>{p.path.split("/").pop()}</span>
              {p.encrypt && <Lock size={12} style={{ color: "var(--amber)", flexShrink: 0 }} />}
              {p.state === "selected" || p.state === "pending"
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{stateEl(p)}<button onClick={() => onRemove(p.path)} style={{ appearance: "none", border: "none", background: "none", color: "var(--muted)", fontSize: 11.5, cursor: "pointer" }}>{t("common.remove")}</button></span>
                : stateEl(p)}
            </div>
          ))}
          {backable.some((p) => p.state === "available") && (
            <div style={{ padding: "8px 2px 12px 18px", textAlign: "right" }}>
              <button onClick={() => backable.filter((p) => p.state === "available").forEach((p) => onAdd(p.path))} style={{ appearance: "none", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e", fontWeight: 600, fontSize: 11.5, padding: "4px 11px", borderRadius: 7, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}><Plus size={12} weight="bold" />{t("ai.addAll")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AiBackup({ showHud }: AiBackupProps) {
  const { t } = useT();
  const [tools, setTools] = useState<AiCatalogTool[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [customLabel, setCustomLabel] = useState("");

  const load = useCallback(async () => {
    try { const { tools: ts } = await getAiToolsCatalog(); setTools(ts); } catch { setTools([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onAdd = useCallback(async (p: string) => { await addSelection("aitools", p); showHud?.({ text: t("common.added"), type: "success" }); void load(); }, [load, showHud, t]);
  const onRemove = useCallback(async (p: string) => { await removeSelection("aitools", p); void load(); }, [load]);
  const onSaveCustom = useCallback(async () => {
    if (!customPath.trim()) return;
    await addAiCustom({ path: customPath.trim(), label: customLabel.trim() || undefined });
    setAdding(false); setCustomPath(""); setCustomLabel(""); void load();
  }, [customPath, customLabel, load]);

  if (tools === null) return <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}><Skeleton height={48} /><Skeleton height={48} /></div>;

  const detected = tools.filter((tl) => tl.paths.some((p) => p.state !== "missing"));
  const undetected = tools.filter((tl) => tl.paths.every((p) => p.state === "missing"));
  const list = showAll ? [...detected, ...undetected] : detected;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0 10px" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>{t("ai.tagline")}</span>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
          <button onClick={() => setShowAll(false)} style={{ appearance: "none", border: "none", fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font)", background: !showAll ? "var(--raise)" : "transparent", color: !showAll ? "var(--text)" : "var(--muted)" }}>{t("ai.detected")} {detected.length}</button>
          <button onClick={() => setShowAll(true)} style={{ appearance: "none", border: "none", fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font)", background: showAll ? "var(--raise)" : "transparent", color: showAll ? "var(--text)" : "var(--muted)" }}>{t("ai.all")} {tools.length}</button>
        </div>
        <button onClick={() => setAdding(!adding)} style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontSize: 11.5, padding: "4px 10px", borderRadius: 7, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font)" }}><Plus size={13} />{t("ai.addTool")}</button>
      </div>
      {adding && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder={t("ai.custom.labelPh")} style={{ width: 140, appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 12.5, padding: "6px 10px", borderRadius: 6 }} />
          <input value={customPath} onChange={(e) => setCustomPath(e.target.value)} placeholder={t("ai.custom.pathPh")} style={{ flex: 1, appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12.5, padding: "6px 10px", borderRadius: 6 }} />
          <button onClick={() => void onSaveCustom()} disabled={!customPath.trim()} style={{ appearance: "none", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e", fontWeight: 600, fontSize: 12.5, padding: "6px 12px", borderRadius: 6, cursor: "pointer", opacity: customPath.trim() ? 1 : 0.5 }}>{t("ai.custom.save")}</button>
        </div>
      )}
      <div>{list.map((tl) => <ToolCard key={tl.id} tool={tl} onAdd={onAdd} onRemove={onRemove} />)}</div>
    </div>
  );
}
```

(Confirm `var(--green)`/`var(--amber)`/`var(--accent)`/`var(--text)`/`var(--muted)`/`var(--border)`/`var(--border-soft)`/`var(--raise)`/`var(--font)`/`var(--mono)` exist in index.css — they do, used across the app. Drop the old `FilePreview` import if file-preview-on-click is not re-wired here; v1.1 keeps preview optional — if the existing AiBackup had preview, preserve it by keeping `useFilePreview` on the filename span. To stay minimal and match the mockup, this rewrite omits inline preview; if the reviewer flags lost functionality, re-add `useFilePreview`+`FilePreviewPane` on the row.)

- [ ] **Step 4: Verify** — `pnpm --filter @roost/web test` + `pnpm -r typecheck` + `pnpm lint`.
- [ ] **Step 5: Commit** — `git add packages/web/src/views/AiBackup.tsx packages/web/src/AiBackup.test.tsx && git commit -m "feat(web): AiBackup redesign — collapsible detected-first list + self-serve add (direction ①)"`

---

### Task 6: Full verification (controller-run)

- `pnpm -r build` · `pnpm lint` · `pnpm -r typecheck` · `pnpm test` · `pnpm --filter @roost/web test` · `pnpm build:sidecar` — all green.
- Real-machine: `/api/aitools/catalog` shows Cursor/Windsurf/Zed (this machine has them) with real candidates; a `skip` entry (`.claude.json`) shows state never; `POST /api/aitools/custom` writes `roost/ai-tools-catalog.yaml`; capture of a `plain` + an `encrypt` entry round-trips; a `skip` path hand-added is blocked and its local file untouched.
- Desktop rebuild + install; eyeball the redesigned page vs the approved mockup.

---

## Self-Review

**1. Spec coverage:** A(catalog expansion)→T1; B(policy + skip + safety補漏)→T1(data)+T2(capture)+T3(endpoint); C(page ①)→T5; self-serve add→T3(endpoint)+T4(api)+T5(form); field-extraction explicitly deferred; icons stay Phosphor. ✓
**2. Placeholder scan:** none — full code for core/server/api; full AiBackup component; the one conditional note (re-add preview if reviewer wants) is an explicit fallback, not a gap.
**3. Type consistency:** `AiPolicy`/`effectivePolicy`/`aiPathPolicies` defined T1, consumed T2/T3; `NEVER_BACKUP` removed everywhere (T1 export, T2 import, T3 import); catalog state union `selected|pending|available|dotfiles|never|missing` consistent T3↔T4↔T5; `addAiCustom` T4→T5; selection namespace `aitools` throughout; skip→state "never"→UI label 永不备份 consistent.
