# Adopt Local Skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Roost adopt machine-local skills via the existing Discover→capture flow — capturing *real content* (not dangling symlinks), classifying candidates by their real directory, decoupling from other tools on consent, and allowing un-adopt — while repairing the 10 cc-switch skills already stored in the repo as broken symlinks.

**Architecture:** All behavior lives in the **skills module** (`packages/core/src/modules/skills.ts`) + two server endpoints + the web Skills view. `capture()` dereferences a top-level symlink before copy. `discover()` classifies each candidate by its resolved real directory (`Candidate.origin`), surfaces repo-symlink entries as `needsRepair`, requires `SKILL.md`, and skips dotfiles. Adopt = capture + optional `materializeSource` (decouple). Unadopt = forget (drop repo/config/link records), never delete local files. No core-orchestration/selection-schema change (ADR-0019).

**Tech Stack:** TypeScript (strict), pnpm monorepo, vitest, Fastify (cli server), React + Vite (web), Phosphor icons. Shell is **zsh**. Run tests with `npx vitest run <path>` from repo root; build `pnpm -r build`; lint `pnpm lint`.

**Pre-req (already done):** branch `feat_adopt-local-skills` cut from `main`; ADR-0019 + spec committed (`c7f3470`).

---

## File Structure

- `packages/shared/src/types.ts` — add `CandidateOrigin` + `Candidate.origin?` (additive).
- `packages/core/src/modules/skills.ts` — `capture()` deref + `opts.from`; `discover()` rewrite (origin/needsRepair/SKILL.md/dotfile filter/conflict); new `materializeSource()`; new `unadoptSkills()`; `apply()` step-1 refactor to share materialize; `collapseHome()` helper; change `: SyncModule` → `satisfies SyncModule`.
- `packages/core/src/modules/skills.test.ts` — new tests for all of the above.
- `packages/core/src/index.ts` — export `materializeSource`, `unadoptSkills`.
- `packages/cli/src/server.ts` — extend `POST /api/skills/capture` (decouple+from); new `POST /api/skills/unadopt`; import `skillsModule`, `materializeSource`, `unadoptSkills`.
- `packages/cli/src/server.test.ts` — adopt(decouple)/unadopt endpoint tests (isolated home).
- `packages/web/src/api.ts` — `origin` on discover result; `adoptSkills`, `unadoptSkills`.
- `packages/web/src/views/Skills.tsx` — group Discover by `origin.location`; symlink-group hint; `needsRepair` badge; conflict radio; adopt confirm dialog (preview + decouple toggle); managed-tab "remove from management".
- `packages/web/src/i18n/strings.ts` — `skills.adopt.*` (en+zh).

---

## Task 1: shared — `Candidate.origin`

**Files:**
- Modify: `packages/shared/src/types.ts` (the `Candidate` interface, ~line 19)

- [ ] **Step 1: Add the type**

In `packages/shared/src/types.ts`, immediately above `export interface Candidate {`, add:

```ts
export interface CandidateOrigin {
  /** Directory where the real content lives, home-collapsed for display (e.g. "~/.cc-switch/skills"). */
  location: string;
  /** True if the candidate is reached via a symlink (UI shows the "another tool manages this" hint). */
  linked: boolean;
  /** Already in <repo>/skills but stored as a symlink / no real content — re-capture repairs it. */
  needsRepair?: boolean;
  /** Same name found in >1 directory with differing content; UI lets the user pick which to adopt. */
  conflictLocations?: string[];
}
```

Then add this field inside `Candidate` (after `note?: string;`):

```ts
  origin?: CandidateOrigin;
```

- [ ] **Step 2: Build shared**

Run: `pnpm --filter @roost/shared build`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add Candidate.origin (additive)"
```

---

## Task 2: core — `capture()` dereference + `opts.from`

**Files:**
- Modify: `packages/core/src/modules/skills.ts` (`capture()`, ~line 126; module annotation ~line 91; imports ~line 9)
- Test: `packages/core/src/modules/skills.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/modules/skills.test.ts`:

```ts
describe("capture dereferences symlinked sources (adopt)", () => {
  it("captures real content (not a symlink) when source is a symlink, preserving the target", () => {
    // real content lives outside the source dir (mimics ~/.cc-switch/skills/X)
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ext-"));
    mkSkill(external, "tool-skill", "# real body");
    const srcDir = path.join(home, ".agents", "skills");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.symlinkSync(path.join(external, "tool-skill"), path.join(srcDir, "tool-skill"));

    const cs = skillsModuleSync().capture(ctx(), sel(["tool-skill"]));
    return Promise.resolve(cs).then((r) => {
      expect(r.written).toContain("tool-skill");
      const repoEntry = path.join(repo, "skills", "tool-skill");
      expect(fs.lstatSync(repoEntry).isSymbolicLink()).toBe(false); // real dir, not a symlink
      expect(fs.readFileSync(path.join(repoEntry, "SKILL.md"), "utf8")).toBe("# real body");
      // the external target is untouched
      expect(fs.existsSync(path.join(external, "tool-skill", "SKILL.md"))).toBe(true);
      fs.rmSync(external, { recursive: true, force: true });
    });
  });

  it("honors opts.from to pick a specific source directory", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "dup", "# from source");
    mkSkill(path.join(home, ".claude", "skills"), "dup", "# from claude");
    const cs = await skillsModule.capture(ctx(), sel(["dup"]), { from: { dup: "~/.claude/skills" } });
    expect(cs.written).toContain("dup");
    expect(fs.readFileSync(path.join(repo, "skills", "dup", "SKILL.md"), "utf8")).toBe("# from claude");
  });
});

// helper used above (capture is the same object; this just documents intent)
function skillsModuleSync() { return skillsModule; }
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/src/modules/skills.test.ts -t "dereferences"`
Expected: FAIL — repo entry is a symlink (current bug) / `opts.from` ignored.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/skills.ts`:

(a) change the module annotation (~line 91) from `export const skillsModule: SyncModule = {` to keep concrete types for the extra param:

```ts
export const skillsModule = {
```
…and at the **end** of the object literal (the closing `};` ~line 276) change it to:
```ts
} satisfies SyncModule;
```

(b) replace the `capture` method signature and root-resolution/copy (lines ~126–154) with:

```ts
  async capture(ctx: ModuleContext, sel: Selection, opts?: { from?: Record<string, string> }): Promise<ChangeSet> {
    const names = sel.modules.skills ?? [];
    const written: string[] = [];
    const blocked: string[] = [];
    const blockedDetail: BlockedItem[] = [];
    for (const name of names) {
      // prefer a user-chosen source dir (conflict picker), else first scan root that has it
      const chosen = opts?.from?.[name];
      const chosenPath = chosen ? path.join(expandHome(ctx.home, chosen), name) : undefined;
      const root = chosenPath && fs.existsSync(chosenPath)
        ? chosenPath
        : scanRoots(ctx).map((r) => path.join(r.dir, name)).find((p) => fs.existsSync(p));
      if (!root) { blocked.push(name); blockedDetail.push({ id: name, reason: "error", detail: "not found" }); continue; }
      const scan = scanPathForSecrets(root);
      if (scan.tooLarge) {
        ctx.log.warn(`skills: ${name} too large to scan safely; blocked`);
        blocked.push(name);
        blockedDetail.push({ id: name, reason: "too-large", detail: `${Math.round(scan.bytes / 1048576)}MB / ${scan.files} files` });
        continue;
      }
      if (scan.secretFiles.length > 0) {
        ctx.log.warn(`skills capture: skill "${name}" contains potential secrets — skipped. Rotate any exposed credentials.`);
        blocked.push(name);
        blockedDetail.push({ id: name, reason: "secret", detail: `${scan.secretFiles.length} file(s)` });
        continue; // I6 hard gate
      }
      // dereference a top-level symlink so REAL content lands in the repo (inner symlinks preserved)
      const realRoot = fs.lstatSync(root).isSymbolicLink() ? fs.realpathSync(root) : root;
      const dest = path.join(repoSkillsDir(ctx), name);
      if (!ctx.dryRun) {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(realRoot, dest, { recursive: true });
      }
      written.push(name);
    }
    return { module: "skills", written, encrypted: [], blocked, blockedDetail };
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/src/modules/skills.test.ts`
Expected: PASS (new tests + all existing skills tests stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/skills.ts packages/core/src/modules/skills.test.ts
git commit -m "fix(skills): capture dereferences symlinked source; add opts.from"
```

---

## Task 3: core — `discover()` rewrite (origin / needsRepair / SKILL.md / dotfiles / conflict)

**Files:**
- Modify: `packages/core/src/modules/skills.ts` (`discover()` ~lines 94–119; add `collapseHome` helper near `expandHome`)
- Test: `packages/core/src/modules/skills.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/modules/skills.test.ts`:

```ts
describe("discover classifies by real directory (origin)", () => {
  it("tags a bare source skill: linked:false, location ~/.agents/skills", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "bare1", "# bare");
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "bare1")!;
    expect(c.origin?.linked).toBe(false);
    expect(c.origin?.location).toBe("~/.agents/skills");
  });

  it("tags a symlinked source skill: linked:true, location = resolved dir", async () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ext2-"));
    fs.mkdirSync(path.join(external, "skills"), { recursive: true });
    mkSkill(path.join(external, "skills"), "linked1", "# x");
    const srcDir = path.join(home, ".agents", "skills");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.symlinkSync(path.join(external, "skills", "linked1"), path.join(srcDir, "linked1"));
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "linked1")!;
    expect(c.origin?.linked).toBe(true);
    expect(c.origin?.location).toBe(path.join(external, "skills")); // absolute (not under home → not collapsed)
    fs.rmSync(external, { recursive: true, force: true });
  });

  it("surfaces a repo entry stored as a symlink as needsRepair", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "broken1", "# real");
    // repo holds a symlink (the bug's footprint), not real content
    fs.mkdirSync(path.join(repo, "skills"), { recursive: true });
    fs.symlinkSync(path.join(home, ".agents", "skills", "broken1"), path.join(repo, "skills", "broken1"));
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "broken1");
    expect(c?.origin?.needsRepair).toBe(true);
  });

  it("skips dirs without SKILL.md and dotfile entries", async () => {
    const srcDir = path.join(home, ".agents", "skills");
    fs.mkdirSync(path.join(srcDir, "not-a-skill"), { recursive: true });   // no SKILL.md
    fs.writeFileSync(path.join(srcDir, "not-a-skill", "README.md"), "x");
    fs.mkdirSync(path.join(srcDir, ".system"), { recursive: true });        // dotfile
    fs.writeFileSync(path.join(srcDir, ".system", "SKILL.md"), "x");
    const ids = (await skillsModule.discover(ctx())).map((c) => c.id);
    expect(ids).not.toContain("not-a-skill");
    expect(ids).not.toContain(".system");
  });

  it("fills conflictLocations when same name differs across directories", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "dup2", "# A");
    mkSkill(path.join(home, ".claude", "skills"), "dup2", "# B");
    const c = (await skillsModule.discover(ctx())).find((x) => x.id === "dup2")!;
    expect((c.origin?.conflictLocations ?? []).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/src/modules/skills.test.ts -t "origin"`
Expected: FAIL — `origin` undefined / needsRepair entry skipped.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/skills.ts`, add next to `expandHome` (~line 17):

```ts
function collapseHome(home: string, abs: string): string {
  if (abs === home) return "~";
  if (abs.startsWith(home + path.sep)) return "~/" + abs.slice(home.length + 1);
  return abs;
}
```

Replace the entire `discover()` method (~lines 94–119) with:

```ts
  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const repoDir = repoSkillsDir(ctx);
    // repo state per name: "real" (properly managed → skip), "broken" (symlink/empty → repair), "none"
    const repoState = (name: string): "real" | "broken" | "none" => {
      const p = path.join(repoDir, name);
      let st: fs.Stats;
      try { st = fs.lstatSync(p); } catch { return "none"; }
      if (st.isSymbolicLink()) return "broken";
      return hashSkillDir(p) ? "real" : "broken";
    };
    type Entry = { real: string; hash: string; linked: boolean };
    const byName = new Map<string, Entry[]>();
    for (const { dir } of scanRoots(ctx)) {
      for (const name of listSkillDirs(dir)) {
        if (name.startsWith(".")) continue; // skip dotfile / junk entries
        const abs = path.join(dir, name);
        let real: string;
        try { real = fs.realpathSync(abs); } catch { continue; } // dangling link
        if (!fs.existsSync(path.join(real, "SKILL.md"))) continue; // must be a real skill
        let linked = false;
        try { linked = fs.lstatSync(abs).isSymbolicLink(); } catch { /* */ }
        const arr = byName.get(name) ?? [];
        arr.push({ real, hash: hashSkillDir(real), linked });
        byName.set(name, arr);
      }
    }
    const loc = (real: string) => collapseHome(ctx.home, path.dirname(real));
    const out: Candidate[] = [];
    for (const [name, entries] of byName) {
      const rs = repoState(name);
      if (rs === "real") continue; // already properly managed
      const seen = new Map<string, Entry>();
      for (const e of entries) if (!seen.has(e.real)) seen.set(e.real, e);
      const distinct = [...seen.values()];
      const conflict = new Set(distinct.map((e) => e.hash)).size > 1;
      const rep = distinct[0]!;
      const scan = scanPathForSecrets(rep.real);
      out.push({
        id: name,
        path: name,
        category: "skills",
        recommendation: "track",
        sizeBytes: scan.bytes,
        note: conflict
          ? `conflict: differing content across ${distinct.map((e) => loc(e.real)).join(", ")}`
          : rs === "broken"
            ? "needs repair (stored as symlink)"
            : `found in ${loc(rep.real)}`,
        origin: {
          location: loc(rep.real),
          linked: distinct.some((e) => e.linked),
          ...(rs === "broken" ? { needsRepair: true } : {}),
          ...(conflict ? { conflictLocations: distinct.map((e) => loc(e.real)) } : {}),
        },
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/src/modules/skills.test.ts`
Expected: PASS (incl. existing "discover finds skills…" and "marks…conflict").

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/skills.ts packages/core/src/modules/skills.test.ts
git commit -m "feat(skills): discover classifies by real dir + surfaces needs-repair"
```

---

## Task 4: core — `materializeSource()` + DRY `apply()`

**Files:**
- Modify: `packages/core/src/modules/skills.ts` (add helper + export; refactor `apply()` step-1 ~lines 194–201)
- Test: `packages/core/src/modules/skills.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/modules/skills.test.ts`:

```ts
describe("materializeSource (decouple)", () => {
  it("replaces a symlinked source with the repo's real content", async () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ext3-"));
    mkSkill(external, "dec1", "# real");
    const srcDir = path.join(home, ".agents", "skills");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.symlinkSync(path.join(external, "dec1"), path.join(srcDir, "dec1"));
    // repo already has the real content (post-capture)
    mkSkill(path.join(repo, "skills"), "dec1", "# real");

    const done = materializeSource(ctx(), ["dec1"]);
    expect(done).toEqual(["dec1"]);
    const srcEntry = path.join(srcDir, "dec1");
    expect(fs.lstatSync(srcEntry).isSymbolicLink()).toBe(false); // now a real dir
    expect(fs.readFileSync(path.join(srcEntry, "SKILL.md"), "utf8")).toBe("# real");
    fs.rmSync(external, { recursive: true, force: true });
  });

  it("dry-run makes no changes", async () => {
    mkSkill(path.join(repo, "skills"), "dec2", "# x");
    const dctx = { ...ctx(), dryRun: true };
    materializeSource(dctx, ["dec2"]);
    expect(fs.existsSync(path.join(home, ".agents", "skills", "dec2"))).toBe(false);
  });
});
```

Add `materializeSource` to the import at the top of the test file:
```ts
import { skillsModule, hashSkillDir, resolveSkillConflict, materializeSource, unadoptSkills } from "./skills.js";
```
(`unadoptSkills` is used by Task 5; import it now to avoid a second edit.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/src/modules/skills.test.ts -t "materializeSource"`
Expected: FAIL — `materializeSource is not a function`.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/skills.ts`, add a private helper + exported function (place above `export const skillsModule`):

```ts
function materializeOne(ctx: ModuleContext, sourceRoot: string, repoDirSkills: string, name: string): void {
  const src = path.join(sourceRoot, name);
  if (ctx.dryRun) return;
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.rmSync(src, { recursive: true, force: true }); // removes only the symlink/dir here, never its target
  fs.cpSync(path.join(repoDirSkills, name), src, { recursive: true });
}

// Materialize repo content into the canonical source dir, replacing any symlink
// (decouples a skill from whatever tool the symlink pointed at). Skips names with
// no repo content. Returns the names actually materialized.
export function materializeSource(ctx: ModuleContext, names: string[]): string[] {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const sourceRoot = expandHome(ctx.home, cfg.sourceDir);
  const repoDirSkills = repoSkillsDir(ctx);
  const done: string[] = [];
  for (const name of names) {
    if (!fs.existsSync(path.join(repoDirSkills, name))) continue;
    materializeOne(ctx, sourceRoot, repoDirSkills, name);
    done.push(name);
  }
  return done;
}
```

Then in `apply()`, replace the inline materialize block (currently):
```ts
      const src = path.join(sourceRoot, name);
      if (!ctx.dryRun) {
        fs.mkdirSync(sourceRoot, { recursive: true });
        fs.rmSync(src, { recursive: true, force: true });
        fs.cpSync(path.join(repoDirSkills, name), src, { recursive: true });
      }
```
with:
```ts
      const src = path.join(sourceRoot, name);
      materializeOne(ctx, sourceRoot, repoDirSkills, name);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/src/modules/skills.test.ts`
Expected: PASS (incl. existing "skills apply + reconcile").

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/skills.ts packages/core/src/modules/skills.test.ts
git commit -m "feat(skills): materializeSource() + DRY apply step-1"
```

---

## Task 5: core — `unadoptSkills()` (forget, don't delete)

**Files:**
- Modify: `packages/core/src/modules/skills.ts` (add export; add `saveSkillsConfig` to imports ~line 9)
- Test: `packages/core/src/modules/skills.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/modules/skills.test.ts`:

```ts
describe("unadoptSkills (forget, keep local)", () => {
  it("removes repo + config + link records but leaves source and links on disk", async () => {
    // managed: repo content + a config entry + a recorded IDE link
    mkSkill(path.join(repo, "skills"), "ua1", "# x");
    mkSkill(path.join(home, ".agents", "skills"), "ua1", "# x");        // live source
    const ideDir = path.join(home, ".claude", "skills");
    fs.mkdirSync(ideDir, { recursive: true });
    fs.symlinkSync(path.join(home, ".agents", "skills", "ua1"), path.join(ideDir, "ua1"));
    saveSkillsConfig(repo, { sourceDir: "~/.agents/skills", method: "symlink", targets: ["claude"], skills: { ua1: { enabled: true } } });
    saveSkillLinks(repo, [{ skill: "ua1", target: "claude", path: path.join(ideDir, "ua1"), kind: "symlink" }]);

    const removed = unadoptSkills(ctx(), ["ua1"]);
    expect(removed).toEqual(["ua1"]);
    expect(fs.existsSync(path.join(repo, "skills", "ua1"))).toBe(false);          // forgotten in repo
    expect(loadSkillsConfig(repo).skills.ua1).toBeUndefined();                    // config entry gone
    expect(loadSkillLinks(repo).find((l) => l.skill === "ua1")).toBeUndefined();  // link record gone
    expect(fs.existsSync(path.join(home, ".agents", "skills", "ua1", "SKILL.md"))).toBe(true); // source kept
    expect(fs.existsSync(path.join(ideDir, "ua1"))).toBe(true);                   // on-disk link kept
  });

  it("dry-run makes no changes", async () => {
    mkSkill(path.join(repo, "skills"), "ua2", "# x");
    unadoptSkills({ ...ctx(), dryRun: true }, ["ua2"]);
    expect(fs.existsSync(path.join(repo, "skills", "ua2"))).toBe(true);
  });
});
```

Add `saveSkillsConfig`, `loadSkillsConfig` to the test's config import:
```ts
import { loadSkillLinks, saveSkillLinks, loadSkillsConfig, saveSkillsConfig } from "../skills-config.js";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/src/modules/skills.test.ts -t "unadopt"`
Expected: FAIL — `unadoptSkills is not a function`.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/skills.ts` imports (~line 9), add `saveSkillsConfig`:
```ts
import { loadSkillsConfig, saveSkillsConfig, loadSkillLinks, saveSkillLinks, effectiveSkill } from "../skills-config.js";
```

Add the exported function (near `materializeSource`):

```ts
// "Forget" skills: drop <repo>/skills/<name>, the skills.yaml entry, and the
// per-machine link records — WITHOUT deleting the user's source dir or on-disk
// links. Fully reversible (the skill becomes a Discover candidate again).
export function unadoptSkills(ctx: ModuleContext, names: string[]): string[] {
  const cfg = loadSkillsConfig(ctx.repoDir);
  let links = loadSkillLinks(ctx.repoDir);
  const set = new Set(names);
  const done: string[] = [];
  let changed = false;
  for (const name of names) {
    if (!ctx.dryRun) fs.rmSync(path.join(repoSkillsDir(ctx), name), { recursive: true, force: true });
    if (cfg.skills[name]) { delete cfg.skills[name]; changed = true; }
    done.push(name);
  }
  const before = links.length;
  links = links.filter((l) => !set.has(l.skill));
  if (links.length !== before) changed = true;
  if (!ctx.dryRun && changed) { saveSkillsConfig(ctx.repoDir, cfg); saveSkillLinks(ctx.repoDir, links); }
  return done;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/src/modules/skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/skills.ts packages/core/src/modules/skills.test.ts
git commit -m "feat(skills): unadoptSkills() — forget without deleting local files"
```

---

## Task 6: core — export new functions

**Files:**
- Modify: `packages/core/src/index.ts` (~line 172)

- [ ] **Step 1: Update the export**

Change line 172 from:
```ts
export { skillsModule, resolveSkillConflict } from "./modules/skills.js";
```
to:
```ts
export { skillsModule, resolveSkillConflict, materializeSource, unadoptSkills } from "./modules/skills.js";
```

- [ ] **Step 2: Build core**

Run: `pnpm --filter @roost/core build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "chore(core): export materializeSource, unadoptSkills"
```

---

## Task 7: server — adopt (decouple + from) on `/api/skills/capture`

**Files:**
- Modify: `packages/cli/src/server.ts` (imports ~line 40–60; capture handler ~lines 855–863)
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new test block to `packages/cli/src/server.test.ts` (mirrors the isolated-home pattern at ~line 135):

```ts
describe("POST /api/skills/capture (adopt + decouple)", () => {
  it("captures real content and materializes the source (decouple default on)", async () => {
    const reg = new ModuleRegistry();
    reg.register(skillsModule);
    const aHome = fs.mkdtempSync(path.join(os.tmpdir(), "roost-adopt-home-"));
    const aRepo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-adopt-repo-"));
    try {
      // external real content + a symlink in the source dir (mimics cc-switch)
      const external = fs.mkdtempSync(path.join(os.tmpdir(), "roost-adopt-ext-"));
      fs.mkdirSync(path.join(external, "x-skill"), { recursive: true });
      fs.writeFileSync(path.join(external, "x-skill", "SKILL.md"), "# real");
      const srcDir = path.join(aHome, ".agents", "skills");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.symlinkSync(path.join(external, "x-skill"), path.join(srcDir, "x-skill"));

      const ctxFn = (dryRun: boolean): ModuleContext => ({
        repoDir: aRepo, home: aHome, profile: "base", dryRun,
        exec: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
        log: { info() {}, warn() {}, error() {} }, t: (k) => k,
      });
      const server = buildServer({ repoDir: aRepo, registry: reg, makeCtx: ctxFn });
      const res = await server.inject({
        method: "POST", url: "/api/skills/capture",
        payload: { names: ["x-skill"] }, // decouple defaults to true
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.written).toContain("x-skill");
      expect(body.materialized).toContain("x-skill");
      // repo has REAL content (not a symlink)
      expect(fs.lstatSync(path.join(aRepo, "skills", "x-skill")).isSymbolicLink()).toBe(false);
      // source is now a real dir (decoupled)
      expect(fs.lstatSync(path.join(srcDir, "x-skill")).isSymbolicLink()).toBe(false);
      fs.rmSync(external, { recursive: true, force: true });
    } finally {
      fs.rmSync(aHome, { recursive: true, force: true });
      fs.rmSync(aRepo, { recursive: true, force: true });
    }
  });
});
```

Ensure the test file imports `skillsModule`, `ModuleRegistry`, `ModuleContext` (most already imported at top; add any missing):
```ts
import { skillsModule, ModuleRegistry } from "@roost/core";
import type { ModuleContext } from "@roost/shared";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/cli/src/server.test.ts -t "adopt"`
Expected: FAIL — `body.materialized` undefined (handler ignores decouple).

- [ ] **Step 3: Implement**

In `packages/cli/src/server.ts`, add to the `@roost/core` import block (~line 40–60):
```ts
  skillsModule,
  materializeSource,
  unadoptSkills,
```

Replace the capture handler (~lines 855–863) with:

```ts
  // ── POST /api/skills/capture (adopt: capture + optional decouple) ─────────────
  server.post<{ Body: { names?: string[]; decouple?: boolean; from?: Record<string, string> } }>(
    "/api/skills/capture",
    async (req, reply) => {
      const names = req.body?.names ?? [];
      const decouple = req.body?.decouple !== false; // default true
      const from = req.body?.from;
      const cs = await skillsModule.capture(makeCtx(false), { modules: { skills: names } }, { from });
      const materialized = decouple ? materializeSource(makeCtx(false), cs.written) : [];
      cache.invalidateAll();
      return reply.send({ ...cs, materialized });
    },
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/cli/src/server.test.ts`
Expected: PASS (all existing server tests stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(server): /api/skills/capture adopts + decouples (materializeSource)"
```

---

## Task 8: server — `POST /api/skills/unadopt`

**Files:**
- Modify: `packages/cli/src/server.ts` (add handler after the capture handler)
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/src/server.test.ts`:

```ts
describe("POST /api/skills/unadopt", () => {
  it("forgets a skill (repo entry gone) but keeps the source dir", async () => {
    const reg = new ModuleRegistry();
    reg.register(skillsModule);
    const aHome = fs.mkdtempSync(path.join(os.tmpdir(), "roost-un-home-"));
    const aRepo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-un-repo-"));
    try {
      fs.mkdirSync(path.join(aRepo, "skills", "y-skill"), { recursive: true });
      fs.writeFileSync(path.join(aRepo, "skills", "y-skill", "SKILL.md"), "# x");
      fs.mkdirSync(path.join(aHome, ".agents", "skills", "y-skill"), { recursive: true });
      fs.writeFileSync(path.join(aHome, ".agents", "skills", "y-skill", "SKILL.md"), "# x");
      const ctxFn = (dryRun: boolean): ModuleContext => ({
        repoDir: aRepo, home: aHome, profile: "base", dryRun,
        exec: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
        log: { info() {}, warn() {}, error() {} }, t: (k) => k,
      });
      const server = buildServer({ repoDir: aRepo, registry: reg, makeCtx: ctxFn });
      const res = await server.inject({ method: "POST", url: "/api/skills/unadopt", payload: { names: ["y-skill"] } });
      expect(res.statusCode).toBe(200);
      expect(res.json().removed).toContain("y-skill");
      expect(fs.existsSync(path.join(aRepo, "skills", "y-skill"))).toBe(false);
      expect(fs.existsSync(path.join(aHome, ".agents", "skills", "y-skill", "SKILL.md"))).toBe(true);
    } finally {
      fs.rmSync(aHome, { recursive: true, force: true });
      fs.rmSync(aRepo, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/cli/src/server.test.ts -t "unadopt"`
Expected: FAIL — 404 (route missing).

- [ ] **Step 3: Implement**

In `packages/cli/src/server.ts`, add right after the capture handler:

```ts
  // ── POST /api/skills/unadopt (forget, keep local files) ──────────────────────
  server.post<{ Body: { names?: string[] } }>("/api/skills/unadopt", async (req, reply) => {
    const removed = unadoptSkills(makeCtx(false), req.body?.names ?? []);
    cache.invalidateAll();
    return reply.send({ ok: true, removed });
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/cli/src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(server): POST /api/skills/unadopt"
```

---

## Task 9: web api.ts — origin on discover + adopt/unadopt

**Files:**
- Modify: `packages/web/src/api.ts` (discover ~line 429, capture ~line 433)

- [ ] **Step 1: Implement (types + functions)**

In `packages/web/src/api.ts`, replace `discoverSkills` and `captureSkills` (~lines 429–439) with:

```ts
export interface CandidateOrigin {
  location: string;
  linked: boolean;
  needsRepair?: boolean;
  conflictLocations?: string[];
}
export interface SkillCandidate {
  id: string;
  note?: string;
  sizeBytes?: number;
  origin?: CandidateOrigin;
}
export function discoverSkills(): Promise<{ candidates: SkillCandidate[] }> {
  return apiFetch<{ candidates: SkillCandidate[] }>("/api/skills/discover");
}
export function adoptSkills(
  names: string[],
  opts?: { decouple?: boolean; from?: Record<string, string> },
): Promise<{ written: string[]; blocked?: string[]; blockedDetail?: { id: string; reason: string; detail?: string }[]; materialized: string[] }> {
  return apiFetch("/api/skills/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names, decouple: opts?.decouple ?? true, from: opts?.from }),
  });
}
export function unadoptSkills(names: string[]): Promise<{ ok: boolean; removed: string[] }> {
  return apiFetch("/api/skills/unadopt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
}
```

(Leave `captureSkills` in place if any other caller uses it — grep `captureSkills`; if only `Skills.tsx` uses it, it will be replaced in Task 11, so remove it then.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @roost/web exec tsc --noEmit`
Expected: PASS (Skills.tsx still imports the old names until Task 11 — if tsc errors on a missing `captureSkills`, keep `captureSkills` exported until Task 11).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api.ts
git commit -m "feat(web/api): discover origin + adoptSkills/unadoptSkills"
```

---

## Task 10: web — group Discover by origin, hint, repair badge, conflict picker

**Files:**
- Modify: `packages/web/src/views/Skills.tsx` (discovered tab list ~lines 466–498; state ~line 100; imports)

- [ ] **Step 1: Implement grouping + per-item controls**

In `packages/web/src/views/Skills.tsx`:

(a) update imports — `discoverSkills` now returns `SkillCandidate`; add `adoptSkills, unadoptSkills` and the `Wrench` icon:
```ts
import { getSkills, discoverSkills, toggleSkill, linkSkills, saveSkillsConfig, resolveSkillConflict, postSkillsImportScan, postSkillsImportApply, adoptSkills, unadoptSkills } from "../api";
import type { SkillCandidate } from "../api";
```
Add `Wrench` to the existing `@phosphor-icons/react` import.

(b) add state near `checked` (~line 100):
```ts
  const [fromChoice, setFromChoice] = useState<Record<string, string>>({}); // conflict picker
  const [confirmAdopt, setConfirmAdopt] = useState(false);
  const [decouple, setDecouple] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null); // skill pending un-adopt
```

(c) change `cands`/`newCands` typing to `SkillCandidate[]` (find the `useState` for `cands` and the `newCands` derivation; update the generic to `SkillCandidate[]`).

(d) replace the discovered-tab list body (the `newCands.length === 0 ? … : (…)` block, ~lines 468–498) with grouped rendering:

```tsx
        ) : (
          <div>
            {checked.size > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px" }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{checked.size} {t("common.selected")}</span>
                <button onClick={() => setConfirmAdopt(true)} disabled={busy} style={{ ...ic, marginLeft: "auto", color: "var(--accent)", borderColor: "var(--accent)" }}>
                  <FloppyDisk size={11} />{t("skills.adopt.action")}
                </button>
              </div>
            )}
            {Object.entries(
              newCands.reduce<Record<string, SkillCandidate[]>>((acc, c) => {
                const k = c.origin?.location ?? t("skills.adopt.unknownLocation");
                (acc[k] = acc[k] ?? []).push(c);
                return acc;
              }, {}),
            ).map(([location, items]) => {
              const linkedGroup = items.some((c) => c.origin?.linked);
              return (
                <div key={location} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 0 6px", fontSize: 12.5, color: "var(--muted)" }}>
                    <span className="mono">{location}</span>
                    <span>· {items.length}</span>
                  </div>
                  {linkedGroup && (
                    <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--raise)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
                      {t("skills.adopt.linkedHint")}
                    </div>
                  )}
                  <div style={card}>
                    {items.map((c) => (
                      <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14 }}>
                        <input type="checkbox" aria-label={`select ${c.id}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} style={{ accentColor: "var(--accent)", width: 17, height: 17, cursor: "pointer" }} />
                        <Stack size={14} style={{ color: "var(--muted)" }} />
                        <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.id}</span>
                        {c.origin?.needsRepair && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#f0b352" }}>
                            <Wrench size={11} weight="fill" />{t("skills.adopt.repair")}
                          </span>
                        )}
                        {c.origin?.conflictLocations && c.origin.conflictLocations.length > 1 && (
                          <select
                            aria-label={`source for ${c.id}`}
                            value={fromChoice[c.id] ?? c.origin.conflictLocations[0]}
                            onChange={(e) => setFromChoice((m) => ({ ...m, [c.id]: e.target.value }))}
                            style={{ ...ic, padding: "3px 6px", fontSize: 12 }}
                          >
                            {c.origin.conflictLocations.map((loc) => (
                              <option key={loc} value={loc}>{loc}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          )}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @roost/web exec tsc --noEmit`
Expected: errors only for missing `t()` keys handler refs (`applyImport`/`onBackup` still referenced) — those are wired in Task 11; if `onBackup` is now unused, it's removed in Task 11. Acceptable to proceed; do not commit until Task 11 compiles clean.

- [ ] **Step 3: (no commit yet — continues in Task 11)**

---

## Task 11: web — adopt confirm dialog (preview + decouple) + wire adopt

**Files:**
- Modify: `packages/web/src/views/Skills.tsx` (replace `onBackup` ~line 246; add dialog near the `pending` dialog ~line 502)

- [ ] **Step 1: Replace the capture handler with adopt**

Replace `onBackup` (~lines 246–257) with:

```ts
  const applyAdopt = useCallback(async () => {
    const names = [...checked];
    if (names.length === 0) return;
    setBusy(true);
    try {
      const from = Object.fromEntries(Object.entries(fromChoice).filter(([k]) => checked.has(k)));
      await adoptSkills(names, { decouple, from: Object.keys(from).length ? from : undefined });
      setChecked(new Set());
      setFromChoice({});
      setConfirmAdopt(false);
      if (cands) setCands(await discoverSkills().then((r) => r.candidates)); // re-scan
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "adopt failed");
    } finally { setBusy(false); }
  }, [checked, fromChoice, decouple, cands, refetch]);
```

(If `cands`/`setCands` are named differently, match the existing names. Remove the now-unused `captureSkills` import in `api.ts` and its export if nothing else references it.)

- [ ] **Step 2: Add the confirm dialog**

Near the existing `{pending && (…)}` dialog (~line 502), add:

```tsx
      {confirmAdopt && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
          <div style={{ ...card, maxWidth: 480, width: "100%", padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t("skills.adopt.confirmTitle")} ({checked.size})</div>
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-soft)", borderRadius: 8, marginBottom: 12 }}>
              {(cands ?? []).filter((c) => checked.has(c.id)).map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5 }}>
                  <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{c.id}</span>
                  <span style={{ color: "var(--muted)" }}>{c.origin?.location}</span>
                  {typeof c.sizeBytes === "number" && <span style={{ color: "var(--muted)" }}>{Math.max(1, Math.round(c.sizeBytes / 1024))}KB</span>}
                  {c.origin?.needsRepair && <span style={{ color: "#f0b352" }}>{t("skills.adopt.repair")}</span>}
                </div>
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
              <input type="checkbox" checked={decouple} onChange={(e) => setDecouple(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
              {t("skills.adopt.decouple")}
            </label>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{t("skills.adopt.confirmNote")}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmAdopt(false)} disabled={busy} style={{ ...ic, padding: "6px 12px" }}>{t("skills.resolve.cancel")}</button>
              <button onClick={() => void applyAdopt()} disabled={busy} style={{ ...ic, padding: "6px 12px", color: "#fff", background: "var(--accent)", borderColor: "var(--accent)" }}>{t("skills.adopt.confirmAction")}</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @roost/web exec tsc --noEmit && pnpm --filter @roost/web build`
Expected: PASS (after Task 13 adds the i18n keys; if keys missing only fail at runtime not typecheck — `t()` takes a string. Build should pass).

- [ ] **Step 4: Commit (with Task 10)**

```bash
git add packages/web/src/views/Skills.tsx packages/web/src/api.ts
git commit -m "feat(web): adopt flow — grouped discover, hint, repair, conflict picker, confirm dialog"
```

---

## Task 12: web — "remove from management" in the managed tab

**Files:**
- Modify: `packages/web/src/views/Skills.tsx` (managed table rows ~lines 331–377; add a confirm dialog)

- [ ] **Step 1: Add the handler**

Add near `applyAdopt`:

```ts
  const doUnadopt = useCallback(async (name: string) => {
    setBusy(true);
    try {
      await unadoptSkills([name]);
      setRemoving(null);
      await refetch();
      if (cands) setCands(await discoverSkills().then((r) => r.candidates));
    } catch (e) {
      setError(e instanceof Error ? e.message : "remove failed");
    } finally { setBusy(false); }
  }, [refetch, cands]);
```

- [ ] **Step 2: Add a per-row "remove" control**

In the managed table, the method `<td>` (~lines 365–376) currently ends each row. Add a trailing `<td>` after it:

```tsx
                    <td style={cellPad}>
                      <button aria-label={`remove ${row.name}`} title={t("skills.adopt.removeTitle")} disabled={busy} onClick={() => setRemoving(row.name)} style={{ ...ic, padding: "4px 8px", color: "var(--muted)" }}>
                        {t("skills.adopt.remove")}
                      </button>
                    </td>
```
And add a matching header `<th>` after the method header (~line 327):
```tsx
                  <th style={{ ...cellPad, fontWeight: 600 }}></th>
```

- [ ] **Step 3: Add the confirm dialog**

Near the other dialogs:

```tsx
      {removing && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
          <div style={{ ...card, maxWidth: 420, width: "100%", padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t("skills.adopt.removeTitle")}</div>
            <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.5, color: "var(--muted)" }}>{t("skills.adopt.removeNote")}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setRemoving(null)} disabled={busy} style={{ ...ic, padding: "6px 12px" }}>{t("skills.resolve.cancel")}</button>
              <button onClick={() => void doUnadopt(removing)} disabled={busy} style={{ ...ic, padding: "6px 12px", color: "var(--accent)", borderColor: "var(--accent)" }}>{t("skills.adopt.remove")}</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @roost/web exec tsc --noEmit && pnpm --filter @roost/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Skills.tsx
git commit -m "feat(web): remove-from-management (un-adopt) in managed tab"
```

---

## Task 13: web — i18n strings

**Files:**
- Modify: `packages/web/src/i18n/strings.ts` (near the other `skills.*` keys)

- [ ] **Step 1: Add keys**

Add (en + zh):

```ts
  "skills.adopt.action": { en: "Adopt", zh: "接管" },
  "skills.adopt.repair": { en: "needs repair", zh: "需修复" },
  "skills.adopt.unknownLocation": { en: "(unknown location)", zh: "(位置未知)" },
  "skills.adopt.linkedHint": { en: "These skills' real content lives in the directory above and is symlinked in. Adopting copies the content into your repo; if another program auto-manages that directory, turn its auto-management off after adopting, or the two will keep overwriting each other.", zh: "这些 skill 的真实内容在上面的目录,是软链接进来的。接管会把内容复制进你的仓库;若该目录另有程序在自动管理,接管后请关掉它的自动管理,否则两边会持续互相覆盖。" },
  "skills.adopt.confirmTitle": { en: "Adopt these skills?", zh: "接管这些 skill?" },
  "skills.adopt.confirmAction": { en: "Adopt", zh: "接管" },
  "skills.adopt.confirmNote": { en: "Real content is copied into your repo and tracked. Skills containing secrets or that are too large are skipped automatically.", zh: "真实内容会复制进你的仓库并被跟踪。含密钥或过大的 skill 会自动跳过。" },
  "skills.adopt.decouple": { en: "Take effect now (replace the local copy, detaching from the other tool)", zh: "立即生效(替换本地副本,脱离原工具)" },
  "skills.adopt.remove": { en: "Remove", zh: "移出" },
  "skills.adopt.removeTitle": { en: "Remove from management?", zh: "移出管理?" },
  "skills.adopt.removeNote": { en: "Roost stops tracking this skill (removes it from the repo and its records). Your local skill files and links are left untouched — nothing is deleted.", zh: "Roost 停止跟踪此 skill(从仓库与记录中移除)。你本地的 skill 文件与链接保持不变——不会删除任何东西。" },
```

- [ ] **Step 2: Typecheck + build + lint**

Run: `pnpm --filter @roost/web exec tsc --noEmit && pnpm --filter @roost/web build && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/i18n/strings.ts
git commit -m "feat(web/i18n): skills.adopt.* strings (en+zh)"
```

---

## Task 14: web — component tests

**Files:**
- Test: `packages/web/src/views/Skills.test.tsx` (follow the existing test's render/mocking style — check the file first)

- [ ] **Step 1: Write tests**

Add tests that mock `../api`:
- `discoverSkills` resolves candidates in two groups (one bare, one `linked:true`) → assert two group headers render and the linked group shows the hint text (`skills.adopt.linkedHint` en).
- a `needsRepair:true` candidate → assert the "needs repair" badge renders.
- selecting a candidate + clicking Adopt → opens confirm dialog; clicking confirm calls `adoptSkills` (assert mock called with the name and `{ decouple: true }`).
- a managed row's Remove → confirm → `unadoptSkills` called with `[name]`.

Match the existing render helper and `vi.mock("../api", …)` pattern already used in `Skills.test.tsx`.

- [ ] **Step 2: Run**

Run: `npx vitest run packages/web/src/views/Skills.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/Skills.test.tsx
git commit -m "test(web): adopt grouping, repair badge, adopt/unadopt wiring"
```

---

## Task 15: Full verification + desktop + real-machine

**Files:** none (verification only)

- [ ] **Step 1: Whole-repo build + lint + tests**

Run:
```bash
pnpm -r build && pnpm lint && npx vitest run
```
Expected: all PASS.

- [ ] **Step 2: Rebuild + reinstall desktop**

Run:
```bash
pnpm build:desktop > /tmp/roost-adopt-build.log 2>&1
# wait for "Finished 2 bundles" in the log, then:
osascript -e 'quit app "Roost"' 2>/dev/null; pkill -f roost-server 2>/dev/null; sleep 1
rm -rf /Applications/Roost.app
ditto packages/web/src-tauri/target/release/bundle/macos/Roost.app /Applications/Roost.app
xattr -dr com.apple.quarantine /Applications/Roost.app
open /Applications/Roost.app; sleep 5
curl -s http://127.0.0.1:4317/api/health
```
Expected: health `{ ok: true, ... }`.

- [ ] **Step 3: Real-machine verification (the actual goal)**

In the running app's Skills → Discover:
- One of the 10 broken cc-switch skills (e.g. `database-query`) appears under its `~/.cc-switch/skills` group with a **needs repair** badge → adopt it (decouple on) → confirm.
  - Verify repo now holds real content: `git -C ~/.local/share/chezmoi ls-files skills/database-query | wc -l` is **> 1**, and `test -L ~/.local/share/chezmoi/skills/database-query && echo SYMLINK || echo REAL` prints **REAL**.
  - Verify source decoupled: `test -L ~/.agents/skills/database-query && echo SYMLINK || echo REAL` prints **REAL**.
  - Verify cc-switch untouched: `test -f ~/.cc-switch/skills/database-query/SKILL.md && echo KEPT`.
- A bare un-managed skill (e.g. `hackernews`) → adopt → appears in Managed.
- A managed skill → Remove → it leaves Managed and reappears in Discover; `test -f ~/.agents/skills/<name>/SKILL.md && echo KEPT` confirms local files survive.

- [ ] **Step 4: Final status**

Run: `git log --oneline origin/main..HEAD`
Expected: the related `0721c6d` + the spec/ADR commit + this feature's commits — no unrelated commits. Report to the user; do NOT push (await explicit confirmation).

---

## Self-Review

**Spec coverage:**
- capture deref → Task 2 ✔ · discover origin/needsRepair/SKILL.md/dotfiles/conflict → Task 3 ✔ · materializeSource → Task 4 ✔ · unadopt → Task 5 ✔ · `Candidate.origin` → Task 1 ✔ · server adopt(decouple+from) → Task 7 ✔ · server unadopt → Task 8 ✔ · web group/hint/repair/conflict → Task 10 ✔ · confirm dialog (preview+decouple) → Task 11 ✔ · remove-from-management → Task 12 ✔ · i18n → Task 13 ✔ · tests core/server/web → Tasks 2–5,7,8,14 ✔ · desktop + real-machine repair/adopt/unadopt → Task 15 ✔.
- I6 (secret gate) preserved in capture (unchanged gate). I7 (dry-run/reversible) — materializeSource & unadopt honor `ctx.dryRun`; nothing writes before the confirm dialog. I8 — discover groups by resolved directory, no tool name in core or UI strings (the hint is directory-worded). I9 — macOS-only, no new platform branch.

**Placeholder scan:** No TBD/TODO; every code step has complete code. Task 14 references the existing `Skills.test.tsx` mock pattern rather than inventing one — the executor must open that file first (noted in the task).

**Type consistency:** `CandidateOrigin` fields (`location`, `linked`, `needsRepair`, `conflictLocations`) identical in shared (Task 1), api.ts (Task 9), and Skills.tsx usage (Task 10/11). `adoptSkills(names, {decouple, from})` / `unadoptSkills(names)` signatures match across api.ts (9), server (7/8), and Skills.tsx (11/12). `materializeSource(ctx, names)` and `unadoptSkills(ctx, names)` identical in core (4/5), index export (6), and server import (7/8).
