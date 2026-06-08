# Skills Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user resolve a Skills matrix conflict (⚠️ — the IDE target already holds the user's own real directory) by "back up & take over": move the real dir to `~/.roost-backups/`, then symlink/copy the canonical source into place — per-cell, with confirmation, never deleting user data.

**Architecture:** One new core function `resolveSkillConflict(ctx, skill, targetId)` in the existing `skills` module reuses the module's backup/materialize/link conventions; a new `POST /api/skills/resolve` endpoint calls it; the web Skills matrix turns a conflict cell into a "Resolve" control with a confirm dialog. No architecture/schema change — extends ADR-0012 (documented in ADR-0014).

**Tech Stack:** TypeScript (strict), Node fs (rename/lstat/symlink), fastify, React, vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-roost-skills-conflict-resolution-design.md`.

**Context the implementer needs (verified against current code):**
- `packages/core/src/modules/skills.ts` already has, module-scoped: `expandHome(home, p)`, `repoSkillsDir(ctx)`, `hashSkillDir(dir)` (exported), and imports `loadSkillsTargets` (from `../skills-catalog.js`) + `loadSkillsConfig, loadSkillLinks, saveSkillLinks, effectiveSkill` and type `SkillLink` (from `../skills-config.js`). `SkillTarget = { id, path (home-relative), label }`. `SkillLink = { skill, target, path, kind }`. `effectiveSkill(cfg, name) → { enabled, targets, method }`.
- apply's backup convention: `path.join(ctx.home, ".roost-backups", "skills", String(Date.now()), targetId, skill)`. Materialize = `fs.cpSync(repoSkillsDir/skill, sourceRoot/skill, {recursive:true})`. Link = `fs.symlinkSync(src, dest)` (or `cpSync` for copy).
- Server `packages/cli/src/server.ts` `buildServer` has existing `/api/skills*` routes; `cache.invalidateAll()` is the cache-clear call; `makeCtx(dryRun)` builds the ctx; routes use `reply.status(n).send(...)`. `@roost/core` is imported there.
- Web `Skills.tsx` renders the managed matrix; `targetStatus(row, targetId)` returns `"conflict"` when `row.conflicts?.includes(targetId)`; `StatusBadge` already handles `"conflict"`. api.ts has `getSkills`/`toggleSkill`/etc. Tests: `packages/web/src/Skills.test.tsx` (mocks `./api`), `packages/cli/src/server.test.ts` (buildServer + inject + `makeRealCtx`), `packages/core/src/modules/skills.test.ts` (real-fs with `home`/`repo`/`ctx`/`mkSkill`/`saveSkillsConfig`).
- Tests from repo root: `cd /Users/keliang/MacMove && pnpm exec vitest run <path>`; web: `pnpm --filter @roost/web test`. Lint `pnpm lint`.

---

## File Structure

**Create:** `docs/adr/0014-skills-conflict-resolution.md`

**Modify:**
- `packages/core/src/modules/skills.ts` — add exported `resolveSkillConflict`.
- `packages/core/src/modules/skills.test.ts` — tests for it.
- `packages/core/src/index.ts` — export `resolveSkillConflict`.
- `packages/cli/src/server.ts` — `POST /api/skills/resolve`.
- `packages/cli/src/server.test.ts` — endpoint tests.
- `packages/web/src/api.ts` — `resolveSkillConflict` client fn.
- `packages/web/src/views/Skills.tsx` — conflict cell → Resolve control + confirm.
- `packages/web/src/Skills.test.tsx` — Resolve control test.
- `packages/web/src/i18n/strings.ts` — `skills.resolve.*` keys.

---

## Task 1: ADR-0014

**Files:** Create `docs/adr/0014-skills-conflict-resolution.md`

- [ ] **Step 1: Write the ADR** (mirror `docs/adr/0013-tauri-desktop-shell.md` house style):

```markdown
# ADR-0014: skills conflict resolution (back up & take over)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Extends: ADR-0012 (skills module)

## Context
The skills module's apply SKIPS a target when the IDE's skills dir already holds
a user's own real directory (a "conflict"), to never destroy user data. Users
need a way to resolve such conflicts from the UI.

## Decision
Add an explicit, user-confirmed "back up & take over" action (core
`resolveSkillConflict` + `POST /api/skills/resolve` + a Resolve control in the
matrix). It MOVES the user's real directory to `~/.roost-backups/skills/<ts>/...`
(via rename; copy+rm fallback across devices), then links/copies the canonical
source into place and records the link.

- MOVE, never delete — fully recoverable (I7).
- Per-cell (skill × target); requires UI confirmation.
- Guarded: acts only on a genuine conflict (a real dir Roost does not own);
  refuses symlinks / absent targets / Roost-owned links.
- No architecture, module-contract, or selection-schema change. macOS-only (I9).

## Consequences
- Roost may relocate a user dir into backups on explicit confirm.
- One new core function + one endpoint + one UI control; no new module.
```

- [ ] **Step 2: Commit**
```bash
git add docs/adr/0014-skills-conflict-resolution.md
git commit -m "docs(adr): ADR-0014 skills conflict resolution (back up & take over)"
```

---

## Task 2: core `resolveSkillConflict` (TDD, real fs)

**Files:**
- Modify: `packages/core/src/modules/skills.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/modules/skills.test.ts`

- [ ] **Step 1: Write failing tests** (append to `skills.test.ts`; it already has `home`/`repo`/`ctx`/`mkSkill` and imports `saveSkillsConfig`, `DEFAULT_SKILLS_CONFIG`):

```ts
import { resolveSkillConflict } from "./skills.js";

describe("resolveSkillConflict (back up & take over)", () => {
  function setupConflict(method: "symlink" | "copy" = "symlink") {
    // managed skill content in the repo
    mkSkill(path.join(repo, "skills"), "foo", "# canonical foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), method, targets: ["claude"], skills: { foo: {} } });
    // the user's OWN real dir at the claude target
    mkSkill(path.join(home, ".claude/skills"), "foo", "# USER's own foo");
    return path.join(home, ".claude/skills/foo");
  }

  it("moves the real dir to backups and symlinks the canonical source", async () => {
    const dest = setupConflict("symlink");
    const res = await resolveSkillConflict({ ...ctx() }, "foo", "claude");
    // user content preserved in backup
    expect(fs.existsSync(res.backedUp)).toBe(true);
    expect(fs.readFileSync(path.join(res.backedUp, "SKILL.md"), "utf8")).toBe("# USER's own foo");
    // dest is now a symlink to the canonical source
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(path.join(home, ".agents/skills/foo")));
    // link recorded
    expect(loadSkillLinks(repo).some((l) => l.skill === "foo" && l.target === "claude")).toBe(true);
  });

  it("with method=copy takes over as a real copy (not a symlink)", async () => {
    const dest = setupConflict("copy");
    await resolveSkillConflict({ ...ctx() }, "foo", "claude");
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(dest, "SKILL.md"))).toBe(true);
  });

  it("refuses when target is already a symlink (not a conflict)", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    mkSkill(path.join(home, ".agents/skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    fs.mkdirSync(path.join(home, ".claude/skills"), { recursive: true });
    fs.symlinkSync(path.join(home, ".agents/skills/foo"), path.join(home, ".claude/skills/foo"));
    await expect(resolveSkillConflict({ ...ctx() }, "foo", "claude")).rejects.toThrow();
  });

  it("refuses when target is absent (nothing to resolve)", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    await expect(resolveSkillConflict({ ...ctx() }, "foo", "claude")).rejects.toThrow();
  });

  it("dry-run makes no changes", async () => {
    const dest = setupConflict("symlink");
    const res = await resolveSkillConflict({ ...ctx(), dryRun: true }, "foo", "claude");
    expect(fs.existsSync(res.backedUp)).toBe(false);          // nothing moved
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);  // still the real dir
    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("# USER's own foo");
  });
});
```
(Confirm `loadSkillLinks` is imported in the test file; the apply tests already import it — if not, add `import { loadSkillLinks } from "../skills-config.js";`.)

- [ ] **Step 2: Run, verify FAIL** — `cd /Users/keliang/MacMove && pnpm exec vitest run packages/core/src/modules/skills.test.ts`

- [ ] **Step 3: Implement** — add to `packages/core/src/modules/skills.ts` (after the module export or near the other helpers; it's a standalone export, NOT part of the `SyncModule` interface):

```ts
// Resolve a conflict by "back up & take over": MOVE the user's real dir at the
// target to ~/.roost-backups, then link/copy the canonical source into place.
// Guarded to act only on a genuine conflict (a real dir Roost doesn't own).
export async function resolveSkillConflict(
  ctx: ModuleContext,
  skill: string,
  targetId: string,
): Promise<{ backedUp: string; linked: string }> {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const target = loadSkillsTargets(ctx.repoDir).find((t) => t.id === targetId);
  if (!target) throw new Error(`unknown target: ${targetId}`);
  const dest = path.join(ctx.home, target.path, skill);

  // Guard: must be a REAL dir Roost does not own.
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dest);
  } catch {
    throw new Error(`no conflict at ${dest}: nothing there`);
  }
  if (st.isSymbolicLink()) throw new Error(`no conflict: ${dest} is already a symlink`);
  if (!st.isDirectory()) throw new Error(`no conflict: ${dest} is not a directory`);
  const links = loadSkillLinks(ctx.repoDir);
  if (links.some((l) => l.skill === skill && l.target === targetId && l.path === dest)) {
    throw new Error(`no conflict: ${dest} is Roost-managed`);
  }

  const eff = effectiveSkill(cfg, skill);
  const sourceRoot = expandHome(ctx.home, cfg.sourceDir);
  const src = path.join(sourceRoot, skill);
  const backupPath = path.join(ctx.home, ".roost-backups", "skills", String(Date.now()), targetId, skill);
  if (ctx.dryRun) return { backedUp: backupPath, linked: dest };

  // 1. MOVE the user's dir to backup (rename; cross-device EXDEV → copy+rm).
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  try {
    fs.renameSync(dest, backupPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EXDEV") {
      fs.cpSync(dest, backupPath, { recursive: true });
      fs.rmSync(dest, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
  // 2. Materialize the canonical source from the repo if missing.
  fs.mkdirSync(sourceRoot, { recursive: true });
  if (!fs.existsSync(src)) {
    const repoSkill = path.join(repoSkillsDir(ctx), skill);
    if (fs.existsSync(repoSkill)) fs.cpSync(repoSkill, src, { recursive: true });
  }
  // 3. Link (or copy) into the now-vacated target.
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (eff.method === "copy") fs.cpSync(src, dest, { recursive: true });
  else fs.symlinkSync(src, dest);
  // 4. Record the link.
  links.push({ skill, target: targetId, path: dest, kind: eff.method });
  saveSkillLinks(ctx.repoDir, links);

  return { backedUp: backupPath, linked: dest };
}
```
(`fs.Stats` type: if the file uses `import * as fs from "node:fs"`, `fs.Stats` is valid. If strict-mode complains, type `st` as `ReturnType<typeof fs.lstatSync>`.)

- [ ] **Step 4: Export from core** — in `packages/core/src/index.ts`, add to the skills exports line:
```ts
export { skillsModule, resolveSkillConflict } from "./modules/skills.js";
```
(If `skillsModule` is exported elsewhere, just add `resolveSkillConflict` alongside it.)

- [ ] **Step 5: Run tests + typecheck** — `pnpm exec vitest run packages/core/src/modules/skills.test.ts` (all pass) + `pnpm --filter @roost/core typecheck` + `pnpm test` (whole core/cli green).

- [ ] **Step 6: Commit**
```bash
git add packages/core/src/modules/skills.ts packages/core/src/modules/skills.test.ts packages/core/src/index.ts
git commit -m "feat(core): resolveSkillConflict — back up user dir & take over (guarded, reversible)"
```

---

## Task 3: server `POST /api/skills/resolve` (TDD via inject)

**Files:**
- Modify: `packages/cli/src/server.ts`, `packages/cli/src/server.test.ts`

- [ ] **Step 1: Write failing tests** (append to `server.test.ts`, "skills api" style):

```ts
describe("skills resolve api", () => {
  it("POST /api/skills/resolve backs up a real dir and links", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-resolve-"));
    // managed skill + recipe + a real conflicting dir under the test home
    fs.mkdirSync(path.join(tmp, "skills", "foo"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "skills", "foo", "SKILL.md"), "# canonical");
    // makeRealCtx uses os.homedir(); override the claude target to a unique home-relative dir
    fs.mkdirSync(path.join(tmp, "roost"), { recursive: true });
    const uniq = `.roost-test-${Date.now()}/skills`;
    fs.writeFileSync(path.join(tmp, "roost", "skills-catalog.yaml"),
      `targets:\n  - { id: claude, path: ${uniq}, label: Claude }\n`);
    fs.writeFileSync(path.join(tmp, "roost", "skills.yaml"),
      `sourceDir: ${path.join(os.homedir(), ".roost-test-src-" + Date.now())}\nmethod: symlink\ntargets: [claude]\nskills: { foo: {} }\n`);
    const dest = path.join(os.homedir(), uniq, "foo");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "SKILL.md"), "# USER own");
    try {
      const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
      const res = await server.inject({ method: "POST", url: "/api/skills/resolve", payload: { skill: "foo", target: "claude" } });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(body.backedUp)).toBe(true);
      await server.close();
    } finally {
      fs.rmSync(path.join(os.homedir(), uniq.split("/")[0]), { recursive: true, force: true });
    }
  });

  it("POST /api/skills/resolve returns 400 on a non-conflict", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-resolve2-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/resolve", payload: { skill: "nope", target: "claude" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});
```
(This touches the real `$HOME` under a unique `.roost-test-*` dir and cleans it in `finally`, matching how the existing skills-conflict server test does it. Confirm `makeRealCtx` signature first; adapt if needed.)

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — in `server.ts`, add `resolveSkillConflict` to the `@roost/core` import, and add the route near the other `/api/skills*` routes:
```ts
  server.post("/api/skills/resolve", async (req, reply) => {
    const b = (req.body ?? {}) as { skill?: string; target?: string };
    if (!b.skill || !b.target) return reply.status(400).send({ error: "skill + target required" });
    try {
      const { backedUp, linked } = await resolveSkillConflict(makeCtx(false), b.skill, b.target);
      cache.invalidateAll();
      return reply.send({ ok: true, backedUp, linked });
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });
```

- [ ] **Step 4: Run tests + typecheck** — `pnpm exec vitest run packages/cli/src/server.test.ts` + `pnpm --filter @roost/cli typecheck` + `pnpm lint`.

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(cli): POST /api/skills/resolve (back up & take over a conflict)"
```

---

## Task 4: web Resolve control + confirm + i18n + browser verify

**Files:**
- Modify: `packages/web/src/api.ts`, `packages/web/src/views/Skills.tsx`, `packages/web/src/Skills.test.tsx`, `packages/web/src/i18n/strings.ts`

- [ ] **Step 1: api.ts** — add (mirror existing POST helpers' `apiFetch` + `JSON.stringify` + Content-Type style):
```ts
export function resolveSkillConflict(skill: string, target: string): Promise<{ ok: boolean; backedUp: string; linked: string }> {
  return apiFetch("/api/skills/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill, target }) });
}
```

- [ ] **Step 2: i18n** — add to `strings.ts` (en + zh, matching the file's flat `{en, zh}` shape):
```
skills.resolve.action:  "Resolve" / "解决"
skills.resolve.confirm: "Your existing folder at {dest} will be moved to ~/.roost-backups (recoverable) and replaced with a link to the canonical source. Continue?" / "你在 {dest} 的现有目录将被移动到 ~/.roost-backups(可找回),并替换为指向规范源的软链。继续？"
skills.resolve.done:    "Resolved — old folder backed up." / "已解决 —— 旧目录已备份。"
```
(If `t()` doesn't support `{dest}` interpolation, use a generic message without the path; check how other strings handle vars and match.)

- [ ] **Step 3: Skills.test.tsx** — add a test: a conflict cell renders a Resolve control and clicking it (with `window.confirm` mocked → true) calls `resolveSkillConflict`. Extend the api mock with `resolveSkillConflict: vi.fn().mockResolvedValue({ ok: true, backedUp: "/b", linked: "/l" })`, and add `conflicts: ["claude"]` to the mocked `foo` row. Example:
```tsx
it("offers Resolve on a conflict cell and calls the API on confirm", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Skills />);
  const btn = await screen.findByRole("button", { name: /resolve|解决/i });
  btn.click();
  await waitFor(() => expect(api.resolveSkillConflict).toHaveBeenCalledWith("foo", "claude"));
});
```
(Match the file's existing import/mock mechanics — it mocks `"./api"`; import the mocked module as needed to assert the call. Adapt the query if the control isn't a `button` role.)

- [ ] **Step 4: Run, verify FAIL** — `pnpm --filter @roost/web test -- Skills`

- [ ] **Step 5: Skills.tsx** — in the matrix cell render, when `targetStatus(row, t.id) === "conflict"`, render a small **Resolve** button (instead of / alongside the ⚠️ badge) whose onClick:
```tsx
onClick={async () => {
  const dest = `${t.label}: ${row.name}`; // or build the real path if available
  if (!window.confirm(t("skills.resolve.confirm", { dest }))) return;
  await resolveSkillConflict(row.name, t.id);
  await refresh(); // the existing getSkills() refetch used elsewhere in this view
}}
```
Import `resolveSkillConflict` from `../api`. Use the view's existing refetch function (whatever reloads `getSkills()` after toggles). Keep the conflict styling (coral) on the control. Only conflict cells get the button; non-conflict cells keep their badge.

- [ ] **Step 6: Run web tests + typecheck** — `pnpm --filter @roost/web test` (whole suite green) + `pnpm --filter @roost/web typecheck` + `pnpm lint`.

- [ ] **Step 7: Browser verify (real conflict).** Rebuild web + sidecar + tauri and exercise it against a REAL conflict on this machine (there are 3: equity-new-priority-membership / -workspace / stock-deviation-monitor in the `claude` column). To avoid the full desktop rebuild loop, verify via the served web build instead:
```bash
pnpm --filter @roost/web build
pnpm -r build && node scripts/build-sidecar.mjs   # only if engine changed; else skip
# run the engine standalone and open the built web in a browser to drive it:
packages/web/src-tauri/binaries/roost-server-aarch64-apple-darwin serve --port 4317 &
# open the web/dist via a static server OR (simpler) use the preview tooling against the dev server
```
Actually simplest: use the preview MCP tooling to load the built web pointed at the engine, navigate to Skills, click Resolve on one real conflict, confirm the cell turns ✅ and that `~/.roost-backups/skills/<ts>/claude/<skill>` now holds the old dir. **Pick ONE real conflict (e.g. stock-deviation-monitor), resolve it, and verify the backup exists + the `~/.claude/skills/stock-deviation-monitor` is now a symlink.** Report the backup path. Kill the engine after.
(If driving the Tauri app directly is easier, rebuild it with `pnpm build:desktop` and click Resolve in the native window — either path is acceptable; the goal is one real end-to-end resolve with a verified backup.)

- [ ] **Step 8: Commit**
```bash
git add packages/web/src/api.ts packages/web/src/views/Skills.tsx packages/web/src/Skills.test.tsx packages/web/src/i18n/strings.ts
git commit -m "feat(web): Resolve control for skill conflicts (back up & take over, confirmed)"
```

---

## Self-Review Notes
- **Spec coverage:** §3 core `resolveConflict` + guard + rename/EXDEV + materialize + link → Task 2; §4 endpoint → Task 3; §5 web Resolve + confirm + api + i18n → Task 4; §6 ADR-0014 → Task 1; §7 tests (real-fs resolve, guard refusals, dry-run, copy method, endpoint 200/400, web control) → Tasks 2–4. All covered.
- **Naming consistency:** core `resolveSkillConflict(ctx, skill, targetId)` ↔ exported in index.ts ↔ imported in server.ts ↔ web api `resolveSkillConflict(skill, target)` (web fn omits ctx, server supplies it). Endpoint `/api/skills/resolve` consistent. Backup path convention matches apply (`~/.roost-backups/skills/<ts>/<targetId>/<skill>`).
- **Safety:** rename (move) not delete; guard refuses non-conflicts (symlink/absent/owned) BEFORE touching anything — covered by 3 refusal tests + dry-run test. This is the load-bearing safety property; do not weaken the guard.
- **No regression:** purely additive (new fn/route/control); existing suites must stay green (checked each task).
