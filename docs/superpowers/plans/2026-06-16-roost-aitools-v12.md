# AI Tools v1.2 (Field Extraction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Back up a *field* of a mixed config+secret file and merge it back on restore — shipped for Claude Code `mcpServers` inside `~/.claude.json` — plus suggest-only MCP auto-detection. Per `docs/superpowers/specs/2026-06-16-roost-aitools-v12-field-extraction-design.md` + ADR-0024.

**Architecture:** A catalog `extract: { fields }` rule. Extract entries bypass chezmoi: Roost writes an age-encrypted artifact under `repo/aitools-extract/` (reusing `age` via the exec adapter), and on restore decrypts + **merges only those fields** into the live file (fresh read, backup first, through the apply gate). Auto-detect scans for JSON top-level `mcpServers` co-occurring with a secret and *suggests* a rule. Zero core domain logic outside the aitools module + a small extract helper.

**Tech Stack:** TS strict · Fastify · React+Vite · vitest. Branch `feat_aitools_v12` (cut). **Per-task gate: task tests + `pnpm lint` + `pnpm -r typecheck`.** Phosphor icons, no emoji, coral only for add. One commit per task, no push. **Never write into the real `~/.claude.json` in tests — use temp files.**

---

## Shared contracts

```ts
// core/src/ai-tools-catalog.ts
export interface AiExtract { fields: string[]; format?: "json" } // default "json"
export interface AiToolPath { path: string; kind: "memory"|"settings"|"mcp"|"data"; policy?: AiPolicy; extract?: AiExtract }
export function aiExtractEntries(repoDir: string, home: string): Map<string, AiExtract>; // abs path → extract spec

// core/src/aitools-extract.ts  (new — the primitive; pure helpers + age via exec)
export function pickFields(obj: unknown, fields: string[]): Record<string, unknown>;      // shallow allowlist
export function mergeFields(live: Record<string, unknown>, picked: Record<string, unknown>, fields: string[]): Record<string, unknown>; // set only `fields`
export function extractArtifactPath(repoDir: string, absPath: string): string;            // repo/aitools-extract/<slug>.json.age
export async function writeExtractArtifact(exec, opts: { repoDir; absPath; home; json: Record<string,unknown> }): Promise<void>; // age -r
export async function readExtractArtifact(exec, opts: { repoDir; absPath; home }): Promise<Record<string,unknown> | null>;       // age -d -i

// core/src/modules/aitools.ts — capture/status/apply/discover branch on extract; discover also emits MCP suggestions.
// shared Candidate gains optional `suggestExtract?: string[]` (for auto-detect rows).

// server: GET /api/aitools/catalog path entries gain `extract?: boolean`; suggestions returned as extra tools with a `suggest:true` flag.
//   POST /api/aitools/custom accepts optional `extract: { fields }`.
// web api: AiCatalogPath gains `extract?: boolean`; suggestion tools flagged; addAiCustom accepts extract.
```

## File map
**New:** `packages/core/src/aitools-extract.ts` (+ `.test.ts`).
**Modify:** `packages/core/src/ai-tools-catalog.ts` (+test), `packages/core/src/modules/aitools.ts` (+test), `packages/core/src/index.ts`, `packages/shared/src/types.ts` (Candidate.suggestExtract), `packages/cli/src/server.ts` (+test), `packages/web/src/api.ts`, `packages/web/src/views/AiBackup.tsx` (+test), `packages/web/src/i18n/strings.ts`.

---

### Task 1: core — extract schema + the primitive helper

**Files:** Modify `packages/core/src/ai-tools-catalog.ts`; Create `packages/core/src/aitools-extract.ts` + `packages/core/src/aitools-extract.test.ts`; Modify `packages/core/src/index.ts`.

- [ ] **Step 1: Failing tests** (`aitools-extract.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { pickFields, mergeFields, extractArtifactPath } from "./aitools-extract.js";

describe("aitools-extract primitives", () => {
  it("pickFields keeps only listed top-level fields", () => {
    const live = { mcpServers: { a: 1 }, oauthToken: "SECRET", projects: {} };
    expect(pickFields(live, ["mcpServers"])).toEqual({ mcpServers: { a: 1 } });
  });
  it("pickFields skips absent fields", () => {
    expect(pickFields({ x: 1 }, ["mcpServers"])).toEqual({});
  });
  it("mergeFields sets only listed fields, preserving everything else", () => {
    const live = { mcpServers: { old: 1 }, oauthToken: "KEEP", projects: { p: 1 } };
    const merged = mergeFields(live, { mcpServers: { new: 2 } }, ["mcpServers"]);
    expect(merged.mcpServers).toEqual({ new: 2 });
    expect(merged.oauthToken).toBe("KEEP");
    expect(merged.projects).toEqual({ p: 1 });
  });
  it("mergeFields with absent picked field leaves live untouched for that field", () => {
    const live = { mcpServers: { old: 1 }, t: "k" };
    expect(mergeFields(live, {}, ["mcpServers"])).toEqual({ mcpServers: { old: 1 }, t: "k" });
  });
  it("artifact path is repo-scoped and slugged", () => {
    const p = extractArtifactPath("/repo", "/Users/x/.claude.json");
    expect(p).toMatch(/\/repo\/aitools-extract\/.+\.json\.age$/);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/core/src/aitools-extract.test.ts`.

- [ ] **Step 3: Implement.**

3a. `aitools-extract.ts`:
```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Exec } from "@roost/shared";
import { defaultAgeKeyPath, recipientFromKey } from "./env-crypto.js";

// Shallow allowlist: keep only the named top-level fields of a parsed object.
export function pickFields(obj: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    for (const f of fields) if (f in o) out[f] = o[f];
  }
  return out;
}

// Set ONLY the named fields from `picked` onto a copy of `live`; everything else
// (incl. credentials) preserved. Absent picked fields leave live's value as-is.
export function mergeFields(
  live: Record<string, unknown>,
  picked: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...live };
  for (const f of fields) if (f in picked) out[f] = picked[f];
  return out;
}

function slug(absPath: string): string {
  return absPath.replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}
export function extractArtifactPath(repoDir: string, absPath: string): string {
  return path.join(repoDir, "aitools-extract", `${slug(absPath)}.json.age`);
}

// age-encrypt the extracted JSON to the artifact path. Plaintext only in tmpdir.
export async function writeExtractArtifact(
  exec: Exec,
  opts: { repoDir: string; absPath: string; home: string; json: Record<string, unknown> },
): Promise<void> {
  const recipient = await recipientFromKey(exec, defaultAgeKeyPath(opts.home));
  if (!recipient) throw new Error("no age key");
  const dest = extractArtifactPath(opts.repoDir, opts.absPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmpIn = path.join(os.tmpdir(), `roost-extract-${process.pid}-${slug(opts.absPath)}.tmp`);
  try {
    fs.writeFileSync(tmpIn, JSON.stringify(opts.json, null, 2), { encoding: "utf8", mode: 0o600 });
    const r = await exec.run("age", ["-r", recipient, "-o", dest, tmpIn]);
    if (r.code !== 0) throw new Error(r.stderr || `age -r exited ${r.code}`);
  } finally {
    try { fs.unlinkSync(tmpIn); } catch { /* gone */ }
  }
}

// Decrypt the artifact to a parsed object; null if missing / no key / parse fail.
export async function readExtractArtifact(
  exec: Exec,
  opts: { repoDir: string; absPath: string; home: string },
): Promise<Record<string, unknown> | null> {
  const src = extractArtifactPath(opts.repoDir, opts.absPath);
  const keyPath = defaultAgeKeyPath(opts.home);
  if (!fs.existsSync(src) || !fs.existsSync(keyPath)) return null;
  const r = await exec.run("age", ["-d", "-i", keyPath, src]);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout) as Record<string, unknown>; } catch { return null; }
}
```

3b. `ai-tools-catalog.ts`:
- Add `export interface AiExtract { fields: string[]; format?: "json" }` and `extract?: AiExtract` to `AiToolPath`.
- In `parseOverride`, after policy parsing: `const ex = po["extract"]; if (ex && typeof ex === "object" && Array.isArray((ex as { fields?: unknown }).fields)) entry.extract = { fields: ((ex as { fields: unknown[] }).fields).filter((f): f is string => typeof f === "string") };`
- Replace the Claude Code `.claude.json` skip entry with the extract entry:
  `{ path: ".claude.json", kind: "mcp", policy: "encrypt", extract: { fields: ["mcpServers"] } },`
- Add:
```ts
export function aiExtractEntries(repoDir: string, home: string): Map<string, AiExtract> {
  const m = new Map<string, AiExtract>();
  for (const tool of loadAiToolsCatalog(repoDir))
    for (const p of tool.paths) if (p.extract) m.set(path.join(home, p.path), p.extract);
  return m;
}
```

3c. `index.ts`: export `aiExtractEntries`, `type AiExtract` (catalog) and the four `aitools-extract.ts` functions + (no type beyond fns).

- [ ] **Step 4: Verify** — `npx vitest run packages/core/src/aitools-extract.test.ts packages/core/src/ai-tools-catalog.test.ts` + `pnpm lint` + `pnpm --filter @roost/core typecheck`.
- [ ] **Step 5: Commit** — `git add packages/core/src/aitools-extract.ts packages/core/src/aitools-extract.test.ts packages/core/src/ai-tools-catalog.ts packages/core/src/index.ts && git commit -m "feat(core): field-extraction primitive + Claude mcpServers extract rule (ADR-0024)"`

---

### Task 2: core aitools module — extract capture / status / apply (merge-restore)

**Files:** Modify `packages/core/src/modules/aitools.ts`; Test `packages/core/src/modules/aitools.test.ts`. Also `packages/core/src/apply.ts` is reused (`backupFiles`).

- [ ] **Step 1: Failing tests** (append; reuse harness; the age path is mocked via fake exec returning ciphertext/plaintext — assert the *logic*, mock `age` calls)

```ts
describe("aitools field extraction (ADR-0024)", () => {
  it("capture extracts only mcpServers; the token never enters the artifact JSON", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    const f = path.join(home, ".claude.json");
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { x: { command: "y" } }, oauthAccount: "TOKEN", projects: {} }), "utf8");
    // age key present so recipientFromKey works
    fs.mkdirSync(path.join(home, ".config/sops/age"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config/sops/age/keys.txt"), "AGE-SECRET-KEY-1");
    let sel = emptySelection(); sel = addItem(sel, "aitools", f);
    let captured = "";
    const exec: Exec = { async run(cmd, args) {
      if (cmd === "age-keygen") return { code: 0, stdout: "age1recipient", stderr: "" };
      if (cmd === "age" && args.includes("-r")) { const tmp = args[args.indexOf("-o")+2-1]; captured = fs.readFileSync(args[args.length-1], "utf8"); return { code: 0, stdout: "", stderr: "" }; }
      return { code: 0, stdout: "", stderr: "" };
    }};
    const cs = await aitoolsModule.capture(makeCtx({ exec, home, repoDir }), sel);
    expect(cs.encrypted).toContain(f);
    expect(captured).toContain("mcpServers");
    expect(captured).not.toContain("TOKEN");   // token never extracted
  });

  it("apply merges mcpServers back, preserves token, backs up first, dryRun no-write", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    const f = path.join(home, ".claude.json");
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { old: 1 }, oauthAccount: "KEEPTOKEN" }), "utf8");
    fs.mkdirSync(path.join(home, ".config/sops/age"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config/sops/age/keys.txt"), "k");
    const exec: Exec = { async run(cmd, args) {
      if (cmd === "age" && args.includes("-d")) return { code: 0, stdout: JSON.stringify({ mcpServers: { new: 2 } }), stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    }};
    const plan = { module: "aitools", actions: [{ id: f, kind: "update" as const, target: f }] };
    // dry-run: no write
    await aitoolsModule.apply({ ...makeCtx({ exec, home, repoDir }), dryRun: true }, plan);
    expect(JSON.parse(fs.readFileSync(f, "utf8")).mcpServers).toEqual({ old: 1 });
    // real: merge
    await aitoolsModule.apply(makeCtx({ exec, home, repoDir }), plan);
    const after = JSON.parse(fs.readFileSync(f, "utf8"));
    expect(after.mcpServers).toEqual({ new: 2 });
    expect(after.oauthAccount).toBe("KEEPTOKEN");   // token preserved
    expect(fs.existsSync(path.join(home, ".roost-backups", "aitools"))).toBe(true); // backed up
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add an extract branch to capture/status/apply.

3a. Imports: add `import { aiExtractEntries } from "../ai-tools-catalog.js";`, `import { pickFields, mergeFields, writeExtractArtifact, readExtractArtifact } from "../aitools-extract.js";`, `import { backupFiles } from "../apply.js";`, `import { scanContent? }` — for the extracted-subset scan reuse `scanPathForSecrets` is path-based; for the subset use the existing content scanner if exported, else scan the artifact's plaintext JSON string with the same rule. (If only `scanPathForSecrets` exists, write the picked JSON to a tmp file and scan it — but since policy is "encrypt" for the Claude rule, encryption covers it; run the scanner only when policy !== "encrypt".)

3b. `capture`: at the top of the per-id loop, before the policy switch, handle extract:
```ts
    const extracts = aiExtractEntries(ctx.repoDir, ctx.home);
    // ... in loop:
      const ex = extracts.get(id);
      if (ex) {
        if (!fs.existsSync(id)) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(fs.readFileSync(id, "utf8")); } catch { blocked.push(id); blockedDetail.push({ id, reason: "error", detail: "无法解析 JSON" }); continue; }
        const picked = pickFields(parsed, ex.fields);
        if (Object.keys(picked).length === 0) continue; // nothing to back up
        try { await writeExtractArtifact(ctx.exec, { repoDir: ctx.repoDir, absPath: id, home: ctx.home, json: picked }); }
        catch (e) { blocked.push(id); blockedDetail.push({ id, reason: "error", detail: e instanceof Error ? e.message : "encrypt failed" }); continue; }
        encrypted.push(id);
        continue;
      }
```
(Place this branch before the `policy === "skip"` check so an extract entry that also has policy is handled by extraction.)

3c. `status`: extract entries → compare:
```ts
    // before the chezmoi changedPaths logic, split extract ids out:
    const extracts = aiExtractEntries(ctx.repoDir, ctx.home);
    const extractItems = await Promise.all(ids.filter((id) => extracts.has(id)).map(async (id) => {
      const ex = extracts.get(id)!;
      let liveFields: Record<string, unknown> = {};
      try { liveFields = pickFields(JSON.parse(fs.readFileSync(id, "utf8")), ex.fields); } catch { /* unparsable → treat as drift */ }
      const artifact = await readExtractArtifact(ctx.exec, { repoDir: ctx.repoDir, absPath: id, home: ctx.home });
      const same = artifact !== null && JSON.stringify(liveFields) === JSON.stringify(pickFields(artifact, ex.fields));
      return { id, state: same ? "synced" as const : "drift" as const };
    }));
```
Run the existing chezmoi-based status only for the non-extract ids, then return `[...extractItems, ...chezmoiItems]`.

3d. `apply`: split actions into extract vs chezmoi:
```ts
    const extracts = aiExtractEntries(ctx.repoDir, ctx.home);
    const extractActions = plan.actions.filter((a) => extracts.has(a.target));
    const fileActions = plan.actions.filter((a) => !extracts.has(a.target));
    const applied: string[] = []; const backedUp: string[] = [];
    // field-merge restore for extract entries
    for (const a of extractActions) {
      const ex = extracts.get(a.target)!;
      const artifact = await readExtractArtifact(ctx.exec, { repoDir: ctx.repoDir, absPath: a.target, home: ctx.home });
      if (artifact === null) continue; // no key / no artifact → skip (status already showed drift)
      if (ctx.dryRun) { applied.length; continue; }
      let live: Record<string, unknown> = {};
      try { live = JSON.parse(fs.readFileSync(a.target, "utf8")); } catch { live = {}; }
      const backupDir = path.join(ctx.home, ".roost-backups", "aitools", String(Date.now()));
      if (fs.existsSync(a.target)) backedUp.push(...backupFiles([a.target], backupDir));
      const merged = mergeFields(live, pickFields(artifact, ex.fields), ex.fields);
      fs.writeFileSync(a.target, JSON.stringify(merged, null, 2) + "\n", "utf8");
      applied.push(a.id);
    }
    // chezmoi apply for the rest (existing logic) on fileActions' targets
    if (fileActions.length > 0) { const paths = fileActions.map((a) => a.target); await chezmoi.apply({ dryRun: ctx.dryRun, paths }); }
    return { module: "aitools", applied: ctx.dryRun ? [] : [...applied, ...(ctx.dryRun ? [] : fileActions.map((a) => a.id))], backedUp, skipped: ctx.dryRun ? plan.actions.map((a) => a.id) : [] };
```
(Confirm `ctx.dryRun` handling matches the existing return shape; keep dryRun → applied:[] skipped:all, non-dry → applied incl merged.)

- [ ] **Step 4: Verify** — `npx vitest run packages/core/src/modules/aitools.test.ts packages/core` + `pnpm lint` + `pnpm --filter @roost/core typecheck`.
- [ ] **Step 5: Commit** — `git add packages/core/src/modules/aitools.ts packages/core/src/modules/aitools.test.ts && git commit -m "feat(core): aitools extract capture + merge-restore (token-preserving, backup, gated)"`

---

### Task 3: core — MCP auto-detection in discover()

**Files:** Modify `packages/shared/src/types.ts` (Candidate.suggestExtract), `packages/core/src/modules/aitools.ts` (+test).

- [ ] **Step 1: Failing tests** (append to aitools.test.ts)

```ts
describe("aitools MCP auto-detect (ADR-0024)", () => {
  it("suggests extraction for a JSON file with top-level mcpServers + a secret", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, ".weirdtool"), { recursive: true });
    const f = path.join(home, ".weirdtool", "config.json");
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { a: { command: "x" } }, apiKey: "AKIAIOSFODNN7EXAMPLE1234567890AB" }), "utf8");
    const cands = await aitoolsModule.discover(makeCtx({ exec: makeFakeExec([]).exec, home, repoDir }));
    const s = cands.find((c) => c.path === f);
    expect(s?.suggestExtract).toEqual(["mcpServers"]);
  });
  it("does NOT suggest when there is no secret, or no mcpServers", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, ".cleantool"), { recursive: true });
    fs.writeFileSync(path.join(home, ".cleantool", "config.json"), JSON.stringify({ mcpServers: { a: {} } }), "utf8"); // no secret
    fs.mkdirSync(path.join(home, ".other"), { recursive: true });
    fs.writeFileSync(path.join(home, ".other", "config.json"), JSON.stringify({ apiKey: "AKIAIOSFODNN7EXAMPLE1234567890AB" }), "utf8"); // no mcpServers
    const cands = await aitoolsModule.discover(makeCtx({ exec: makeFakeExec([]).exec, home, repoDir }));
    expect(cands.some((c) => c.suggestExtract)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**

3a. `packages/shared/src/types.ts`: add `suggestExtract?: string[];` to the `Candidate` interface (optional, after existing fields).

3b. In `aitools.ts` `discover()`, after the catalog loop, add the auto-detect scan (bounded — catalog-known dirs + a short curated glob; do NOT deep-walk):
```ts
    // MCP auto-detect (ADR-0024): JSON files with a top-level mcpServers block that
    // also carry a secret → suggest extraction. Suggest-only; bounded candidate set.
    const seen = new Set(out.map((c) => c.path));
    const candidates = [
      ...cat.flatMap((tl) => tl.paths.map((p) => path.join(ctx.home, p.path))),  // catalog paths
      ...globShallow(ctx.home, [".config/*/config.json", ".config/*/*.json", ".*rc.json"]),
    ];
    for (const abs of new Set(candidates)) {
      if (seen.has(abs) || extracts.has(abs)) continue;       // already handled or already an extract rule
      if (!abs.endsWith(".json") || !fs.existsSync(abs)) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(fs.readFileSync(abs, "utf8")); } catch { continue; }
      if (!parsed || typeof parsed !== "object" || !("mcpServers" in (parsed as object))) continue;
      if (scanPathForSecrets(abs, { maxBytes: 2 * 1024 * 1024 }).secretFiles.length === 0) continue; // not mixed
      out.push({ id: abs, path: abs, category: "mcp", recommendation: "encrypt", note: `${path.basename(path.dirname(abs))} · MCP (建议提取)`, suggestExtract: ["mcpServers"] });
    }
```
Add a tiny `globShallow(home, patterns)` local helper (no external dep): for each pattern, resolve the single `*` segment via one `fs.readdirSync` level; return existing matches. Keep it to ≤2 levels, wrapped in try/catch, returning [].

3c. `aiExtractEntries` map is already loaded in discover for the capture path? No — discover currently loads `dotfilesSel`. Add `const extracts = aiExtractEntries(ctx.repoDir, ctx.home);` near the top of discover and ensure catalog extract entries are emitted as normal candidates (they are catalog paths; the existing loop emits them — make sure an `extract` path that exists is offered as a normal candidate with a `提取` note: in the existing per-path loop add `if (p.extract) note += " · 提取";` and skip the `policy==="skip"` continue for extract paths — extract paths have policy encrypt, so fine).

- [ ] **Step 4: Verify** — `npx vitest run packages/core packages/cli` + lint + typecheck.
- [ ] **Step 5: Commit** — `git add packages/shared/src/types.ts packages/core/src/modules/aitools.ts packages/core/src/modules/aitools.test.ts && git commit -m "feat(core): suggest-only MCP auto-detection in aitools discover (ADR-0024)"`

---

### Task 4: server — surface extract + suggestions; custom-add accepts extract

**Files:** Modify `packages/cli/src/server.ts`; Test `packages/cli/src/server.test.ts`.

- [ ] **Step 1: Failing tests** (append; temp-home pattern)

```ts
it("catalog endpoint marks extract entries with extract:true", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ex-"));
  try {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { a: {} } }));
    const ctx = (d: boolean): ModuleContext => ({ repoDir: tmpDir, home, profile: "base", dryRun: d, exec: makeFakeExec(), log: {info(){},warn(){},error(){}}, t: (k:string)=>k });
    const server = buildServer({ repoDir: tmpDir, registry: new ModuleRegistry(), makeCtx: ctx });
    const all = (await (await server.inject({ method:"GET", url:"/api/aitools/catalog" })).json() as { tools:{paths:{path:string;extract?:boolean}[]}[] }).tools.flatMap(t=>t.paths);
    expect(all.find(p => p.path === path.join(home, ".claude.json"))!.extract).toBe(true);
    await server.close();
  } finally { fs.rmSync(home, { recursive:true, force:true }); }
});
it("custom-add accepts an extract rule", async () => {
  const server = buildServer({ repoDir: tmpDir, registry: new ModuleRegistry(), makeCtx:(d)=>makeCtx(tmpDir,d) });
  await server.inject({ method:"POST", url:"/api/aitools/custom", payload:{ label:"W", path:"~/.w/c.json", kind:"mcp", extract:{ fields:["mcpServers"] } }, headers:{"content-type":"application/json"} });
  const cat = loadAiToolsCatalog(tmpDir);
  expect(cat.find(t=>t.paths.some(p=>p.path===".w/c.json" && p.extract?.fields?.includes("mcpServers")))).toBeTruthy();
  await server.close();
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** (server.ts):
  - Import `aiExtractEntries`. In `/api/aitools/catalog`, compute `const extracts = aiExtractEntries(repoDir, home);` and add `extract: extracts.has(abs)` to each path object.
  - Surface suggestions: after building `tools`, call the aitools module's discover via the registry IF registered, OR run a lightweight inline scan. Simplest: the catalog endpoint already returns catalog tools; suggestions come from `discoverAll`/the module — add them as extra "tools" with `suggest: true` and one path each: `{ id, label, suggest: true, paths: [{ path: abs, kind:"mcp", encrypt:true, state:"available", extract:false, suggest:true }] }`. (Pull from `aitoolsModule.discover(makeCtx(true))` filtered to `c.suggestExtract`.) Keep it defensive (try/catch → []).
  - `POST /api/aitools/custom`: accept optional `extract` in Body; when present and `Array.isArray(extract.fields)`, write `{ path, kind, extract: { fields } }` into the yaml entry.

- [ ] **Step 4: Verify** — `npx vitest run packages/cli/src/server.test.ts packages/core packages/cli` + lint + typecheck.
- [ ] **Step 5: Commit** — `git add packages/cli/src/server.ts packages/cli/src/server.test.ts && git commit -m "feat(server): expose extract flag + MCP suggestions; custom-add accepts extract"`

---

### Task 5: web — extract tag + suggestion group + i18n

**Files:** Modify `packages/web/src/api.ts`, `packages/web/src/views/AiBackup.tsx` (+test), `packages/web/src/i18n/strings.ts`.

- [ ] **Step 1: api.ts** — `AiCatalogPath` gains `extract?: boolean`; `AiCatalogTool` gains `suggest?: boolean`; `addAiCustom` body type gains `extract?: { fields: string[] }`.
- [ ] **Step 2: i18n** (append `ai.*`):
```ts
  "ai.extractTag": { en: "field", zh: "提取" },
  "ai.suggest.group": { en: "Detected MCP you can extract", zh: "检测到可提取的 MCP" },
  "ai.suggest.adopt": { en: "Back up just the MCP", zh: "按提取方式纳管" },
  "ai.suggest.note": { en: "Backs up only mcpServers; your token/secrets stay out of the repo.", zh: "只备份 mcpServers;令牌/密钥不入库。" },
```
- [ ] **Step 3: Failing test + impl** (`AiBackup.test.tsx`): a path with `extract:true` renders a `提取` tag after the filename; a tool with `suggest:true` renders in the suggestion group with a 「按提取方式纳管」 button that calls `addAiCustom` with an `extract` field. In `AiBackup.tsx`: render `extract` rows with a small `提取` tag (reuse the muted tag style); render `suggest` tools in a separate titled group at the bottom with the adopt button calling `addAiCustom({ path, label, kind:"mcp", extract:{ fields:["mcpServers"] } })` then `load()`.
- [ ] **Step 4: Verify** — `pnpm --filter @roost/web test` + lint + typecheck.
- [ ] **Step 5: Commit** — `git add packages/web/src/api.ts packages/web/src/views/AiBackup.tsx packages/web/src/AiBackup.test.tsx packages/web/src/i18n/strings.ts && git commit -m "feat(web): extract tag + MCP suggestion group (adopt-by-extraction)"`

---

### Task 6: Full verification (controller-run)

- `pnpm -r build` · `pnpm lint` · `pnpm -r typecheck` · `pnpm test` · `pnpm --filter @roost/web test` · `pnpm build:sidecar`.
- **Real-machine, SAFE (never the real `~/.claude.json` token destructively):**
  - copy the real `~/.claude.json` → a temp file; point an extract rule (override yaml in a temp ROOST_REPO) at the temp file; capture → assert the `.age` artifact decrypts to `{mcpServers}` only, NO token string present.
  - mutate the temp file's mcpServers; restore (apply) → assert mcpServers replaced AND the token field byte-preserved AND a backup was written.
  - auto-detect: confirm discover surfaces Claude Code's `~/.claude.json` as an extract/suggested MCP on this machine.
- Desktop rebuild + install; eyeball the 提取 tag + suggestion group.

---

## Self-Review
**1. Spec coverage:** A primitive→T1; B Claude rule→T1(catalog); capture/status/merge-restore→T2; C auto-detect→T3; server surface+custom→T4; web tag+suggestion→T5; verify+real-machine(safe)→T6. ✓
**2. Placeholders:** full code for T1/T2/T3 core; T4/T5 give exact endpoints/types + key UI behavior with tests; `globShallow` specified (≤2 levels, try/catch). No TODOs.
**3. Type consistency:** `AiExtract`/`aiExtractEntries` T1→T2/T3/T4; `pickFields`/`mergeFields`/`writeExtractArtifact`/`readExtractArtifact` T1→T2; `Candidate.suggestExtract` T3→T4; `extract?:boolean`/`suggest?:boolean`/`addAiCustom.extract` T4→T5; backup via `backupFiles`(apply.ts) + `~/.roost-backups/aitools`; token-never-stored asserted T2; merge-preserves-token asserted T2; real-machine test uses temp copy only.
