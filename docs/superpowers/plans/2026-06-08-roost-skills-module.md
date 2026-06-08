# Roost `skills` Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `skills` SyncModule that backs up cross-IDE skills directories into the config repo and distributes them (cc-switch style: per-skill symlink default, copy optional) into each IDE's skills dir, with three layers of control — managed/backed-up, enabled/active, and per-IDE — driven by a shareable recipe and idempotent reconcile.

**Architecture:** Pure module addition via the §7 extension contract — `core` gains a new `SyncModule` and two small helper files; no core branching, no selection-schema change. The recipe (`roost/skills.yaml`, shareable) holds sourceDir/method/targets + per-skill `{enabled,targets,method}`; per-machine link state lives in `state/skills-links.json` (already `.chezmoiignore`'d). `apply` materializes repo→sourceDir, then reconciles links (build for enabled×targets, remove Roost-owned links that no longer apply), backing up before overwrite and never touching non-Roost dirs.

**Tech Stack:** TypeScript (strict), Node fs (symlink/lstat/realpath), js-yaml, vitest, commander (CLI), Fastify (server), React + Phosphor (web).

**Spec:** `docs/superpowers/specs/2026-06-08-roost-skills-module-design.md`

---

## File Structure

**Create:**
- `docs/adr/0012-skills-module.md` — governance ADR.
- `packages/core/src/skills-catalog.ts` — `DEFAULT_SKILLS_TARGETS` + `loadSkillsTargets(repoDir)` (merge-by-id override via `roost/skills-catalog.yaml`).
- `packages/core/src/skills-config.ts` — recipe (`roost/skills.yaml`) load/save + `effectiveSkill()`, and link-state (`state/skills-links.json`) load/save.
- `packages/core/src/skills-catalog.test.ts`, `packages/core/src/skills-config.test.ts`.
- `packages/core/src/modules/skills.ts` — the `SyncModule`.
- `packages/core/src/modules/skills.test.ts` — unit + dry-run + idempotent + real-symlink reconcile.
- `packages/cli/src/commands/skills.ts` — `link/unlink/enable/disable` command implementations.
- `packages/web/src/views/Skills.tsx` + `packages/web/src/Skills.test.tsx`.

**Modify:**
- `packages/core/src/orchestrate.ts` — register `skillsModule`.
- `packages/core/src/index.ts` — export the new public symbols.
- `packages/cli/src/index.ts` — add the `skills` command group.
- `packages/cli/src/server.ts` — `/api/skills*` endpoints.
- `packages/web/src/api.ts` — skills API client functions + types.
- `packages/web/src/i18n/strings.ts` — `skills.*` keys (en + zh).
- `packages/web/src/App.tsx` — nav entry + route for the Skills page.

---

## Task 1: ADR-0012 (governance gate)

**Files:**
- Create: `docs/adr/0012-skills-module.md`

- [ ] **Step 1: Read an existing ADR for house style**

Run: `sed -n '1,40p' docs/adr/0011-desktop-app-packaging.md` (mirror its metadata line + section headings).

- [ ] **Step 2: Write the ADR**

Create `docs/adr/0012-skills-module.md`:

```markdown
# ADR-0012: skills module (cross-IDE backup + symlink distribution)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08

## Context
Users keep agent "skills" in per-IDE directories that differ across tools
(~/.claude/skills, ~/.codex/skills, …) plus a canonical source (~/.agents/skills).
They want one backup + cc-switch-style activation that links a canonical source
into each IDE, with per-skill and per-IDE enable/disable.

## Decision
Add a `skills` SyncModule via the §7 extension contract.

- Backup is plain files under `<repo>/skills/<name>/`. A shareable recipe
  `roost/skills.yaml` holds sourceDir/method/targets + per-skill
  {enabled,targets,method}. Per-machine link state lives in
  `state/skills-links.json` (already .chezmoiignore'd).
- `apply` materializes repo→sourceDir then RECONCILES links: build symlink
  (default) or copy for each enabled skill × selected IDE; remove Roost-owned
  links that no longer apply. Default dry-run; back up before overwrite; never
  touch non-Roost directories.
- Targets catalog default lives in code (`DEFAULT_SKILLS_TARGETS`), overridable
  via `roost/skills-catalog.yaml` (I8). No core branching, no selection-schema
  change, macOS-only (I9). Secret Scanner gates capture (I6).

## Consequences
- New module + two repo data files (skills.yaml recipe, skills-catalog.yaml).
- New per-machine state file under state/.
- No change to invariants I1–I9 or other modules.
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0012-skills-module.md
git commit -m "docs(adr): ADR-0012 skills module (cross-IDE backup + symlink distribution)"
```

---

## Task 2: `skills-catalog.ts` — target catalog + override (TDD)

**Files:**
- Create: `packages/core/src/skills-catalog.ts`
- Test: `packages/core/src/skills-catalog.test.ts`

Mirror the existing `app-config-catalog.ts` override mechanism (read it first: `sed -n '1,90p' packages/core/src/app-config-catalog.ts`).

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/skills-catalog.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_SKILLS_TARGETS, loadSkillsTargets } from "./skills-catalog.js";

let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skcat-")); });
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

describe("skills catalog", () => {
  it("ships the cc-switch default targets", () => {
    const ids = DEFAULT_SKILLS_TARGETS.map((t) => t.id);
    expect(ids).toEqual(["claude", "codex", "gemini", "opencode"]);
    expect(DEFAULT_SKILLS_TARGETS.find((t) => t.id === "claude")!.path).toBe(".claude/skills");
  });

  it("returns defaults when no override file exists", () => {
    expect(loadSkillsTargets(repo)).toEqual(DEFAULT_SKILLS_TARGETS);
  });

  it("merges override by id (override path wins, new id added)", () => {
    fs.mkdirSync(path.join(repo, "roost"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "roost", "skills-catalog.yaml"),
      "targets:\n  - { id: claude, path: .config/claude/skills, label: Claude }\n  - { id: cursor, path: .cursor/skills, label: Cursor }\n",
    );
    const got = loadSkillsTargets(repo);
    expect(got.find((t) => t.id === "claude")!.path).toBe(".config/claude/skills");
    expect(got.find((t) => t.id === "cursor")!.path).toBe(".cursor/skills");
    // untouched defaults remain
    expect(got.find((t) => t.id === "codex")!.path).toBe(".codex/skills");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd /Users/keliang/MacMove && pnpm exec vitest run packages/core/src/skills-catalog.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `skills-catalog.ts`**

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

// A target IDE/agent skills directory. `path` is home-relative.
export interface SkillTarget {
  id: string;
  path: string;
  label: string;
}

// Curated defaults (cc-switch set). macOS home-relative paths; zero personal
// paths (I8). Overridable via roost/skills-catalog.yaml.
export const DEFAULT_SKILLS_TARGETS: SkillTarget[] = [
  { id: "claude", path: ".claude/skills", label: "Claude Code" },
  { id: "codex", path: ".codex/skills", label: "Codex" },
  { id: "gemini", path: ".gemini/skills", label: "Gemini CLI" },
  { id: "opencode", path: ".config/opencode/skills", label: "OpenCode" },
];

function overridePath(repoDir: string): string {
  return path.join(repoDir, "roost", "skills-catalog.yaml");
}

function parseTargets(raw: unknown): SkillTarget[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { targets?: unknown }).targets;
  if (!Array.isArray(list)) return [];
  const out: SkillTarget[] = [];
  for (const e of list) {
    if (e && typeof e === "object") {
      const t = e as Record<string, unknown>;
      if (typeof t.id === "string" && typeof t.path === "string") {
        out.push({ id: t.id, path: t.path, label: typeof t.label === "string" ? t.label : t.id });
      }
    }
  }
  return out;
}

// Defaults merged with user override, keyed by id (override path/label wins;
// new ids appended; default ids not mentioned remain).
export function loadSkillsTargets(repoDir: string): SkillTarget[] {
  let overrides: SkillTarget[] = [];
  try {
    const raw = fs.readFileSync(overridePath(repoDir), "utf8");
    overrides = parseTargets(yaml.load(raw));
  } catch {
    overrides = [];
  }
  const byId = new Map<string, SkillTarget>();
  for (const t of DEFAULT_SKILLS_TARGETS) byId.set(t.id, t);
  for (const t of overrides) byId.set(t.id, t);
  return [...byId.values()];
}
```

- [ ] **Step 4: Run, verify PASS** — `pnpm exec vitest run packages/core/src/skills-catalog.test.ts` (3 pass). Then `pnpm --filter @roost/core typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills-catalog.ts packages/core/src/skills-catalog.test.ts
git commit -m "feat(core): skills target catalog + overridable loader"
```

---

## Task 3: `skills-config.ts` — recipe + effective config + link state (TDD)

**Files:**
- Create: `packages/core/src/skills-config.ts`
- Test: `packages/core/src/skills-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/skills-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_SKILLS_CONFIG,
  loadSkillsConfig,
  saveSkillsConfig,
  effectiveSkill,
  loadSkillLinks,
  saveSkillLinks,
} from "./skills-config.js";

let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skcfg-")); });
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

describe("skills config", () => {
  it("defaults: symlink, ~/.agents/skills, all four targets", () => {
    expect(DEFAULT_SKILLS_CONFIG.method).toBe("symlink");
    expect(DEFAULT_SKILLS_CONFIG.sourceDir).toBe("~/.agents/skills");
    expect(DEFAULT_SKILLS_CONFIG.targets).toEqual(["claude", "codex", "gemini", "opencode"]);
  });

  it("load returns defaults when no file", () => {
    expect(loadSkillsConfig(repo)).toEqual(DEFAULT_SKILLS_CONFIG);
  });

  it("save then load round-trips", () => {
    const cfg = { ...DEFAULT_SKILLS_CONFIG, method: "copy" as const, targets: ["claude"], skills: { foo: { enabled: false } } };
    saveSkillsConfig(repo, cfg);
    expect(fs.existsSync(path.join(repo, "roost", "skills.yaml"))).toBe(true);
    expect(loadSkillsConfig(repo)).toEqual(cfg);
  });

  it("effectiveSkill inherits top-level defaults", () => {
    const cfg = { ...DEFAULT_SKILLS_CONFIG, method: "symlink" as const, targets: ["claude", "codex"] };
    expect(effectiveSkill(cfg, "unknown")).toEqual({ enabled: true, targets: ["claude", "codex"], method: "symlink" });
  });

  it("effectiveSkill applies per-skill overrides", () => {
    const cfg = { ...DEFAULT_SKILLS_CONFIG, targets: ["claude", "codex"], skills: { foo: { enabled: false, targets: ["claude"], method: "copy" as const } } };
    expect(effectiveSkill(cfg, "foo")).toEqual({ enabled: false, targets: ["claude"], method: "copy" });
  });

  it("link state round-trips under state/ (not roost/)", () => {
    const links = [{ skill: "foo", target: "claude", path: "/h/.claude/skills/foo", kind: "symlink" as const }];
    saveSkillLinks(repo, links);
    expect(fs.existsSync(path.join(repo, "state", "skills-links.json"))).toBe(true);
    expect(loadSkillLinks(repo)).toEqual(links);
  });

  it("loadSkillLinks returns [] when missing", () => {
    expect(loadSkillLinks(repo)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm exec vitest run packages/core/src/skills-config.test.ts`

- [ ] **Step 3: Implement `skills-config.ts`**

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export type SkillMethod = "symlink" | "copy";

export interface SkillEntry {
  enabled?: boolean;
  targets?: string[];
  method?: SkillMethod;
}

export interface SkillsConfig {
  sourceDir: string; // "~/.agents/skills" or absolute
  method: SkillMethod;
  targets: string[]; // default-enabled target ids
  skills: Record<string, SkillEntry>;
}

export const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  sourceDir: "~/.agents/skills",
  method: "symlink",
  targets: ["claude", "codex", "gemini", "opencode"],
  skills: {},
};

function recipePath(repoDir: string): string {
  return path.join(repoDir, "roost", "skills.yaml");
}

export function loadSkillsConfig(repoDir: string): SkillsConfig {
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(recipePath(repoDir), "utf8"));
  } catch {
    return { ...DEFAULT_SKILLS_CONFIG, skills: {} };
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SKILLS_CONFIG, skills: {} };
  const o = raw as Record<string, unknown>;
  return {
    sourceDir: typeof o.sourceDir === "string" ? o.sourceDir : DEFAULT_SKILLS_CONFIG.sourceDir,
    method: o.method === "copy" ? "copy" : "symlink",
    targets: Array.isArray(o.targets) ? (o.targets.filter((x) => typeof x === "string") as string[]) : [...DEFAULT_SKILLS_CONFIG.targets],
    skills: o.skills && typeof o.skills === "object" ? (o.skills as Record<string, SkillEntry>) : {},
  };
}

export function saveSkillsConfig(repoDir: string, cfg: SkillsConfig): void {
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  fs.writeFileSync(recipePath(repoDir), yaml.dump(cfg), "utf8");
}

export interface EffectiveSkill {
  enabled: boolean;
  targets: string[];
  method: SkillMethod;
}

export function effectiveSkill(cfg: SkillsConfig, name: string): EffectiveSkill {
  const e = cfg.skills[name] ?? {};
  return {
    enabled: e.enabled ?? true,
    targets: e.targets ?? cfg.targets,
    method: e.method ?? cfg.method,
  };
}

// ── per-machine link state (state/skills-links.json, .chezmoiignore'd) ─────────

export interface SkillLink {
  skill: string;
  target: string; // target id
  path: string; // absolute link/copy path created
  kind: SkillMethod;
}

function linksPath(repoDir: string): string {
  return path.join(repoDir, "state", "skills-links.json");
}

export function loadSkillLinks(repoDir: string): SkillLink[] {
  try {
    const arr = JSON.parse(fs.readFileSync(linksPath(repoDir), "utf8"));
    return Array.isArray(arr) ? (arr as SkillLink[]) : [];
  } catch {
    return [];
  }
}

export function saveSkillLinks(repoDir: string, links: SkillLink[]): void {
  fs.mkdirSync(path.join(repoDir, "state"), { recursive: true });
  fs.writeFileSync(linksPath(repoDir), JSON.stringify(links, null, 2), "utf8");
}
```

- [ ] **Step 4: Run, verify PASS** + `pnpm --filter @roost/core typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills-config.ts packages/core/src/skills-config.test.ts
git commit -m "feat(core): skills recipe config + effective resolution + link state"
```

---

## Task 4: `skills.ts` module — read ops (discover/index/capture/status/diff/unmanage/doctor) (TDD)

**Files:**
- Create: `packages/core/src/modules/skills.ts`
- Test: `packages/core/src/modules/skills.test.ts`

Read `packages/core/src/modules/appconfig.ts` and `projects.ts` first for the SyncModule shape, secret-scan usage, and `toHomeRelative`/`fromHomeRelative` helpers (in `modules/projects.ts`). Use the Secret Scanner: `grep -n "scanForSecrets\|scanPathForSecrets" packages/core/src/secrets/scanner.ts packages/core/src/modules/dotfiles.ts` to find the exact import + signature, and reuse it in capture.

This task implements every SyncModule method EXCEPT `apply` (which is Task 5; stub it to return an empty result so the module typechecks and registers, with a comment that Task 5 fills it).

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/modules/skills.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModuleContext, Selection } from "@roost/shared";
import { skillsModule } from "./skills.js";

let home: string, repo: string;
function ctx(): ModuleContext {
  return {
    repoDir: repo, home, profile: "base", dryRun: false,
    exec: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
    log: { info() {}, warn() {}, error() {} },
    t: (k) => k,
  };
}
function sel(names: string[]): Selection { return { modules: { skills: names } }; }
function mkSkill(dir: string, name: string, body: string) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), body);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sk-home-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sk-repo-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("skills module read ops", () => {
  it("discover finds skills under source + IDE target dirs, not yet managed", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# foo");
    mkSkill(path.join(home, ".claude", "skills"), "bar", "# bar");
    const cands = await skillsModule.discover(ctx());
    const ids = cands.map((c) => c.id).sort();
    expect(ids).toEqual(["bar", "foo"]);
  });

  it("discover marks same-name different-content as conflict", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# A");
    mkSkill(path.join(home, ".claude", "skills"), "foo", "# B");
    const cands = await skillsModule.discover(ctx());
    const foo = cands.find((c) => c.id === "foo")!;
    expect(foo.note ?? "").toMatch(/conflict/i);
  });

  it("capture copies a selected skill into <repo>/skills/<name>", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "foo", "# foo body");
    const cs = await skillsModule.capture(ctx(), sel(["foo"]));
    expect(cs.written).toContain("foo");
    expect(fs.readFileSync(path.join(repo, "skills", "foo", "SKILL.md"), "utf8")).toBe("# foo body");
  });

  it("capture blocks a skill whose file contains a secret", async () => {
    mkSkill(path.join(home, ".agents", "skills"), "leaky", 'export OPENAI_API_KEY="sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
    const cs = await skillsModule.capture(ctx(), sel(["leaky"]));
    expect(cs.blocked ?? []).toContain("leaky");
    expect(fs.existsSync(path.join(repo, "skills", "leaky"))).toBe(false);
  });

  it("index reports managed count", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    const idx = await skillsModule.index!(ctx());
    expect(idx.available).toBe(true);
    expect(idx.managed).toBe(1);
  });

  it("unmanage removes the skill from selection result (no throw when nothing linked)", async () => {
    const res = await skillsModule.unmanage(ctx(), sel(["foo"]));
    expect(res.module).toBe("skills");
  });
});
```

NOTE: confirm the secret-scanner triggers on the `sk-...` sample — check the actual rules in `packages/core/src/secrets/scanner.ts`. If the OpenAI-key rule needs a different shape to fire, adjust the test's secret string to one the scanner definitely catches (e.g. an AWS key `AKIA...`), and note which you used.

- [ ] **Step 2: Run, verify FAIL** — `pnpm exec vitest run packages/core/src/modules/skills.test.ts`

- [ ] **Step 3: Implement `skills.ts`** (apply stubbed)

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
  SyncModule, ModuleContext, Candidate, Selection,
  DriftReport, DriftItem, ChangeSet, ApplyPlan, ApplyResult, Health, ModuleIndex,
} from "@roost/shared";
import { loadSkillsTargets } from "../skills-catalog.js";
import { loadSkillsConfig, effectiveSkill, loadSkillLinks } from "../skills-config.js";
import { scanPathForSecrets } from "./dotfiles.js"; // reuse bounded content scanner (confirm export name)

function expandHome(home: string, p: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

// All scan roots on this machine: the canonical source + each catalog target dir.
function scanRoots(ctx: ModuleContext): { id: string; dir: string }[] {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const targets = loadSkillsTargets(ctx.repoDir);
  const roots = [{ id: "source", dir: expandHome(ctx.home, cfg.sourceDir) }];
  for (const t of targets) roots.push({ id: t.id, dir: path.join(ctx.home, t.path) });
  return roots;
}

function listSkillDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Stable content hash of a skill directory (sorted relative file paths + bytes).
export function hashSkillDir(dir: string): string {
  const h = crypto.createHash("sha256");
  const walk = (d: string, rel: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else { h.update(r); h.update(fs.readFileSync(abs)); }
    }
  };
  try { walk(dir, ""); } catch { /* empty/missing */ }
  return h.digest("hex");
}

function repoSkillsDir(ctx: ModuleContext): string {
  return path.join(ctx.repoDir, "skills");
}

export const skillsModule: SyncModule = {
  name: "skills",

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const managed = new Set(listSkillDirs(repoSkillsDir(ctx)));
    // name -> set of {root, hash}
    const found = new Map<string, { roots: string[]; hashes: Set<string> }>();
    for (const { id, dir } of scanRoots(ctx)) {
      for (const name of listSkillDirs(dir)) {
        if (managed.has(name)) continue;
        const entry = found.get(name) ?? { roots: [], hashes: new Set() };
        entry.roots.push(id);
        entry.hashes.add(hashSkillDir(path.join(dir, name)));
        found.set(name, entry);
      }
    }
    const out: Candidate[] = [];
    for (const [name, e] of found) {
      const conflict = e.hashes.size > 1;
      out.push({
        id: name,
        path: name,
        category: "skills",
        recommendation: "track",
        note: conflict ? `conflict: differing content across ${e.roots.join(", ")}` : `found in ${e.roots.join(", ")}`,
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  },

  async index(ctx: ModuleContext): Promise<ModuleIndex> {
    const managed = listSkillDirs(repoSkillsDir(ctx)).length;
    return { available: true, managed };
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const names = sel.modules.skills ?? [];
    const written: string[] = [];
    const blocked: string[] = [];
    for (const name of names) {
      // find the first source root that has this skill
      const root = scanRoots(ctx).map((r) => path.join(r.dir, name)).find((p) => fs.existsSync(p));
      if (!root) { blocked.push(name); continue; }
      const findings = scanPathForSecrets(root);
      if (findings.length > 0) { blocked.push(name); continue; } // I6 hard gate
      const dest = path.join(repoSkillsDir(ctx), name);
      if (!ctx.dryRun) {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(root, dest, { recursive: true });
      }
      written.push(name);
    }
    return { module: "skills", written, encrypted: [], blocked };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const names = sel.modules.skills ?? [];
    const items: DriftItem[] = names.map((name) => {
      const repoH = hashSkillDir(path.join(repoSkillsDir(ctx), name));
      const cfg = loadSkillsConfig(ctx.repoDir);
      const srcH = hashSkillDir(path.join(expandHome(ctx.home, cfg.sourceDir), name));
      if (!repoH) return { id: name, state: "untracked" };
      return { id: name, state: repoH === srcH ? "synced" : "drift" };
    });
    return { module: "skills", items };
  },

  async diff(ctx: ModuleContext, sel: Selection): Promise<string> {
    const rep = await this.status(ctx, sel);
    return rep.items.map((i) => `${i.state.padEnd(9)} ${i.id}`).join("\n");
  },

  // Task 5 fills this in (materialize + reconcile links).
  async apply(_ctx: ModuleContext, _plan: ApplyPlan): Promise<ApplyResult> {
    return { module: "skills", applied: [], backedUp: [], skipped: [] };
  },

  async unmanage(_ctx: ModuleContext, _sel: Selection): Promise<ApplyResult> {
    // Task 5 removes Roost-owned links here; for now no-op shell.
    return { module: "skills", applied: [], backedUp: [], skipped: [] };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const cfg = loadSkillsConfig(ctx.repoDir);
    const src = expandHome(ctx.home, cfg.sourceDir);
    const out: Health[] = [{ name: "skills:source", ok: true, detail: src }];
    // dangling links recorded by Roost
    for (const l of loadSkillLinks(ctx.repoDir)) {
      const broken = l.kind === "symlink" && (() => { try { fs.statSync(l.path); return false; } catch { return true; } })();
      if (broken) out.push({ name: `skills:dangling:${l.skill}@${l.target}`, ok: false, detail: l.path });
    }
    return out;
  },
};
```

IMPORTANT: verify the actual exported name of the bounded secret scanner in `dotfiles.ts` (the spec calls it `scanPathForSecrets`). If the real export differs or it takes an options arg, adjust the import + call accordingly. If it isn't exported, either export it minimally or import the underlying `scanForSecrets` from `secrets/scanner.ts` and walk files yourself with a small bounded helper — keep it simple and note the choice.

- [ ] **Step 4: Run, verify PASS** + `pnpm --filter @roost/core typecheck`. Fix until green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/skills.ts packages/core/src/modules/skills.test.ts
git commit -m "feat(core): skills module read ops (discover/capture/status/diff/index/doctor)"
```

---

## Task 5: `skills.ts` apply — materialize + reconcile links + register (TDD, real symlink)

**Files:**
- Modify: `packages/core/src/modules/skills.ts` (fill `apply` + `unmanage`)
- Modify: `packages/core/src/modules/skills.test.ts` (apply/reconcile/idempotent/real-symlink)
- Modify: `packages/core/src/orchestrate.ts` (register `skillsModule`)
- Modify: `packages/core/src/index.ts` (export public symbols)

- [ ] **Step 1: Write the failing tests** (append to `skills.test.ts`)

```ts
import { skillsModule as M } from "./skills.js";
import { saveSkillsConfig, loadSkillLinks, DEFAULT_SKILLS_CONFIG } from "../skills-config.js";

function plan() { return { module: "skills", actions: [] as never[] }; }

describe("skills apply + reconcile", () => {
  it("apply materializes repo -> sourceDir and symlinks into enabled targets", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    // selection drives which skills are materialized
    const res = await M.apply({ ...ctx(), dryRun: false }, plan() as never);
    // source materialized
    expect(fs.readFileSync(path.join(home, ".agents/skills/foo/SKILL.md"), "utf8")).toBe("# foo");
    // claude target is a symlink to source
    const link = path.join(home, ".claude/skills/foo");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(home, ".agents/skills/foo")));
    expect(res.applied).toContain("foo@claude");
    expect(loadSkillLinks(repo).some((l) => l.skill === "foo" && l.target === "claude")).toBe(true);
  });

  it("dry-run makes no changes", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    await M.apply({ ...ctx(), dryRun: true }, plan() as never);
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(false);
    expect(loadSkillLinks(repo)).toEqual([]);
  });

  it("is idempotent: second apply does not error and keeps one link", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    await M.apply({ ...ctx() }, plan() as never);
    await M.apply({ ...ctx() }, plan() as never);
    expect(loadSkillLinks(repo).filter((l) => l.skill === "foo" && l.target === "claude").length).toBe(1);
  });

  it("disabling a skill removes its Roost-owned link on next apply", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    const base = { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"] };
    saveSkillsConfig(repo, { ...base, skills: { foo: { enabled: true } } });
    await M.apply({ ...ctx() }, plan() as never);
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(true);
    saveSkillsConfig(repo, { ...base, skills: { foo: { enabled: false } } });
    await M.apply({ ...ctx() }, plan() as never);
    expect(fs.existsSync(path.join(home, ".claude/skills/foo"))).toBe(false);
    expect(loadSkillLinks(repo).some((l) => l.skill === "foo")).toBe(false);
  });

  it("does not overwrite a real (non-Roost) directory at the target; marks skipped", async () => {
    mkSkill(path.join(repo, "skills"), "foo", "# foo");
    mkSkill(path.join(home, ".claude/skills"), "foo", "# user's own foo"); // real dir
    saveSkillsConfig(repo, { ...DEFAULT_SKILLS_CONFIG, sourceDir: path.join(home, ".agents/skills"), targets: ["claude"], skills: { foo: {} } });
    const res = await M.apply({ ...ctx() }, plan() as never);
    expect(fs.lstatSync(path.join(home, ".claude/skills/foo")).isSymbolicLink()).toBe(false); // untouched
    expect(res.skipped.some((s) => s.includes("foo@claude"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm exec vitest run packages/core/src/modules/skills.test.ts`

- [ ] **Step 3: Implement `apply` + `unmanage`** in `skills.ts`. Replace the stubbed `apply` and `unmanage` with:

```ts
  async apply(ctx: ModuleContext, _plan: ApplyPlan): Promise<ApplyResult> {
    const cfg = loadSkillsConfig(ctx.repoDir);
    const targets = loadSkillsTargets(ctx.repoDir);
    const targetById = new Map(targets.map((t) => [t.id, t]));
    const sourceRoot = expandHome(ctx.home, cfg.sourceDir);
    const repoDirSkills = repoSkillsDir(ctx);
    const managed = listSkillDirs(repoDirSkills);

    const applied: string[] = [];
    const backedUp: string[] = [];
    const skipped: string[] = [];
    let links = loadSkillLinks(ctx.repoDir);

    const ts = "backup"; // dryRun: no ts dir created; real ts derived below only when writing
    const backupBase = path.join(ctx.home, ".roost-backups", "skills");

    // Desired set: enabled skill × its targets.
    const desired = new Set<string>(); // key `${skill}@${targetId}`
    for (const name of managed) {
      // 1) materialize repo -> sourceDir
      const src = path.join(sourceRoot, name);
      if (!ctx.dryRun) {
        fs.mkdirSync(sourceRoot, { recursive: true });
        fs.rmSync(src, { recursive: true, force: true });
        fs.cpSync(path.join(repoDirSkills, name), src, { recursive: true });
      }
      const eff = effectiveSkill(cfg, name);
      if (!eff.enabled) continue;
      // 2) distribute to each enabled target
      for (const tid of eff.targets) {
        const t = targetById.get(tid);
        if (!t) { skipped.push(`${name}@${tid} (unknown target)`); continue; }
        desired.add(`${name}@${tid}`);
        const targetDir = path.join(ctx.home, t.path);
        const dest = path.join(targetDir, name);
        const ownsExisting = links.some((l) => l.skill === name && l.target === tid && l.path === dest);
        let existsKind: "none" | "link" | "real" = "none";
        try {
          const st = fs.lstatSync(dest);
          existsKind = st.isSymbolicLink() ? "link" : "real";
        } catch { existsKind = "none"; }

        if (existsKind === "real" && !ownsExisting) { skipped.push(`${name}@${tid} (conflict: real dir)`); continue; }

        if (ctx.dryRun) { applied.push(`${name}@${tid}`); continue; }

        fs.mkdirSync(targetDir, { recursive: true });
        if (existsKind !== "none") {
          // back up before replacing (real backup dir created lazily)
          const stamp = path.join(backupBase, String(Date.now()), tid);
          fs.mkdirSync(stamp, { recursive: true });
          fs.cpSync(dest, path.join(stamp, name), { recursive: true });
          backedUp.push(dest);
          fs.rmSync(dest, { recursive: true, force: true });
        }
        if (eff.method === "copy") fs.cpSync(src, dest, { recursive: true });
        else fs.symlinkSync(src, dest);
        links = links.filter((l) => !(l.skill === name && l.target === tid));
        links.push({ skill: name, target: tid, path: dest, kind: eff.method });
        applied.push(`${name}@${tid}`);
      }
    }

    // 3) reconcile: remove Roost-owned links no longer desired
    const keep: typeof links = [];
    for (const l of links) {
      if (desired.has(`${l.skill}@${l.target}`)) { keep.push(l); continue; }
      if (ctx.dryRun) { keep.push(l); continue; }
      try { fs.rmSync(l.path, { recursive: true, force: true }); } catch { /* already gone */ }
      applied.push(`unlink ${l.skill}@${l.target}`);
    }
    if (!ctx.dryRun) saveSkillLinks(ctx.repoDir, keep);
    void ts;
    return { module: "skills", applied, backedUp, skipped };
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const names = new Set(sel.modules.skills ?? []);
    let links = loadSkillLinks(ctx.repoDir);
    const applied: string[] = [];
    const kept: typeof links = [];
    for (const l of links) {
      if (!names.has(l.skill)) { kept.push(l); continue; }
      if (!ctx.dryRun) { try { fs.rmSync(l.path, { recursive: true, force: true }); } catch { /* gone */ } }
      applied.push(`unlink ${l.skill}@${l.target}`);
    }
    if (!ctx.dryRun) saveSkillLinks(ctx.repoDir, kept);
    return { module: "skills", applied, backedUp: [], skipped: [] };
  },
```

Notes for the implementer:
- `apply` ignores `_plan.actions` and drives off `managed` skills + recipe (the generic orchestrator only passes selection ids as actions; the module owns the link logic). This matches how the spec defines it.
- Keep the existing imports; you already import `loadSkillLinks`; add `saveSkillLinks`, `effectiveSkill`, `loadSkillsTargets` to the imports if not present.

- [ ] **Step 4: Register + export.** In `packages/core/src/orchestrate.ts`, import and register:
```ts
import { skillsModule } from "./modules/skills.js";
// inside defaultRegistry(), after reg.register(envModule);
reg.register(skillsModule);
```
In `packages/core/src/index.ts`, add exports (match the file's existing export style):
```ts
export { DEFAULT_SKILLS_TARGETS, loadSkillsTargets } from "./skills-catalog.js";
export { DEFAULT_SKILLS_CONFIG, loadSkillsConfig, saveSkillsConfig, effectiveSkill, loadSkillLinks, saveSkillLinks } from "./skills-config.js";
export type { SkillTarget } from "./skills-catalog.js";
export type { SkillsConfig, SkillEntry, EffectiveSkill, SkillLink, SkillMethod } from "./skills-config.js";
export { skillsModule } from "./modules/skills.js";
```

- [ ] **Step 5: Run all core tests + typecheck**
- `pnpm exec vitest run packages/core/src/modules/skills.test.ts` (all pass)
- `pnpm test` (whole core/cli suite still green — the new module is now in defaultRegistry, so existing orchestrate tests run it; fix any fallout)
- `pnpm --filter @roost/core typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/skills.ts packages/core/src/modules/skills.test.ts packages/core/src/orchestrate.ts packages/core/src/index.ts
git commit -m "feat(core): skills apply with materialize + idempotent link reconcile; register module"
```

---

## Task 6: CLI — `skills` command group (link/unlink/enable/disable)

**Files:**
- Create: `packages/cli/src/commands/skills.ts`
- Modify: `packages/cli/src/index.ts`

The generic `discover/capture/load/status/diff/unmanage skills` already work via the registry. This task adds the symlink-specific + toggle convenience commands that edit `roost/skills.yaml` then reconcile.

Read `packages/cli/src/commands/select.ts` (or any small command) for the `buildCtx`/run-function pattern, and how `index.ts` registers subcommands + how `load` runs apply.

- [ ] **Step 1: Implement `packages/cli/src/commands/skills.ts`**

```ts
import { loadSkillsConfig, saveSkillsConfig, skillsModule } from "@roost/core";
import type { ModuleContext } from "@roost/shared";

export async function runSkillsLink(ctx: ModuleContext, opts: { copy?: boolean; targets?: string[] }): Promise<void> {
  if (opts.copy || opts.targets) {
    const cfg = loadSkillsConfig(ctx.repoDir);
    if (opts.copy) cfg.method = "copy";
    if (opts.targets?.length) cfg.targets = opts.targets;
    saveSkillsConfig(ctx.repoDir, cfg);
  }
  const res = await skillsModule.apply(ctx, { module: "skills", actions: [] });
  ctx.log.info(`linked: ${res.applied.join(", ") || "(none)"}`);
  if (res.skipped.length) ctx.log.warn(`skipped: ${res.skipped.join(", ")}`);
}

export async function runSkillsUnlink(ctx: ModuleContext): Promise<void> {
  // Disable distribution entirely for this run by emptying enabled targets, then reconcile.
  const cfg = loadSkillsConfig(ctx.repoDir);
  const saved = { ...cfg };
  saveSkillsConfig(ctx.repoDir, { ...cfg, targets: [], skills: Object.fromEntries(Object.entries(cfg.skills).map(([k, v]) => [k, { ...v, enabled: false }])) });
  const res = await skillsModule.apply(ctx, { module: "skills", actions: [] });
  saveSkillsConfig(ctx.repoDir, saved); // restore recipe; links already removed
  ctx.log.info(`unlinked: ${res.applied.filter((a) => a.startsWith("unlink")).join(", ") || "(none)"}`);
}

export function runSkillsToggle(ctx: ModuleContext, skill: string, enabled: boolean, target?: string): void {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const entry = cfg.skills[skill] ?? {};
  if (target) {
    const base = entry.targets ?? cfg.targets;
    const set = new Set(base);
    if (enabled) set.add(target); else set.delete(target);
    entry.targets = [...set];
  } else {
    entry.enabled = enabled;
  }
  cfg.skills[skill] = entry;
  saveSkillsConfig(ctx.repoDir, cfg);
  ctx.log.info(`${enabled ? "enabled" : "disabled"} ${skill}${target ? "@" + target : ""}; run 'roost skills link' to apply`);
}
```

- [ ] **Step 2: Wire commands in `index.ts`.** Add a `skills` command group near the other groups (mirror the `key`/`app` group style). `buildCtx()` returns `{ repoDir }`; build a full `ModuleContext` the same way `runServe`/other commands do (createExec/createLogger/createT). If there's an existing helper that builds a `ModuleContext` for commands, reuse it; otherwise construct inline like `runGui` does.

```ts
import { runSkillsLink, runSkillsUnlink, runSkillsToggle } from "./commands/skills.js";
// ...
const skillsCmd = program.command("skills").description("Manage cross-IDE skills distribution");
skillsCmd.command("link")
  .option("--copy", "Use copy instead of symlink")
  .option("--target <id...>", "Only these IDE targets")
  .action(async (o: { copy?: boolean; target?: string[] }) => { await runSkillsLink(makeModuleCtx(false), { copy: o.copy, targets: o.target }); });
skillsCmd.command("unlink")
  .action(async () => { await runSkillsUnlink(makeModuleCtx(false)); });
skillsCmd.command("enable <skill>")
  .option("--target <id>", "Only this IDE target")
  .action((skill: string, o: { target?: string }) => { runSkillsToggle(makeModuleCtx(false), skill, true, o.target); });
skillsCmd.command("disable <skill>")
  .option("--target <id>", "Only this IDE target")
  .action((skill: string, o: { target?: string }) => { runSkillsToggle(makeModuleCtx(false), skill, false, o.target); });
```
Where `makeModuleCtx(dryRun)` builds a `ModuleContext` (repoDir from buildCtx, home=os.homedir(), profile "base", exec/log/t via createExec/createLogger/createT). If such a helper already exists in index.ts, use it; if not, add a tiny local one (DRY: a single helper used by all four actions).

- [ ] **Step 3: Build + manual verify**
```
pnpm --filter @roost/core build && pnpm --filter @roost/cli build
node packages/cli/dist/index.js skills --help          # lists link/unlink/enable/disable
```
Then a real round-trip in a temp HOME if practical, or against the real repo with `--help` only to avoid mutating real config. At minimum confirm the group + subcommands register and `enable/disable` writes `roost/skills.yaml` (test on a throwaway repo dir via env if the CLI supports `--repo`).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/skills.ts packages/cli/src/index.ts
git commit -m "feat(cli): roost skills link/unlink/enable/disable"
```

---

## Task 7: Server — `/api/skills*` endpoints (TDD via inject)

**Files:**
- Modify: `packages/cli/src/server.ts`
- Modify: `packages/cli/src/server.test.ts`

Read the existing `/api/appconfig` + `/api/capture` + `/api/discover` routes in server.ts to match the exact pattern (cache usage, makeCtx, registry.get).

- [ ] **Step 1: Write failing tests** (append to server.test.ts) — at minimum:

```ts
describe("skills api", () => {
  it("GET /api/skills returns managed + config", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-skapi-"));
    fs.mkdirSync(path.join(tmp, "skills", "foo"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "skills", "foo", "SKILL.md"), "# foo");
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "GET", url: "/api/skills" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.config.method).toBe("symlink");
    expect(Array.isArray(body.targets)).toBe(true);
    await server.close();
  });

  it("POST /api/skills/toggle persists per-skill enabled", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sktog-"));
    const server = buildServer({ repoDir: tmp, registry: defaultRegistry(), makeCtx: (d) => makeRealCtx(tmp, d) });
    const res = await server.inject({ method: "POST", url: "/api/skills/toggle", payload: { skill: "foo", enabled: false } });
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(tmp, "roost", "skills.yaml"), "utf8")).toMatch(/foo/);
    await server.close();
  });
});
```
(Use the file's existing `makeRealCtx` helper; confirm its name/signature at the top of server.test.ts and adjust.)

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement endpoints** in `server.ts` (add imports from `@roost/core`: `loadSkillsConfig, saveSkillsConfig, loadSkillsTargets, effectiveSkill, loadSkillLinks`). Add routes mirroring existing style:

```ts
  // ── /api/skills ────────────────────────────────────────────────────────────
  server.get("/api/skills", async (_req, reply) => {
    const cfg = loadSkillsConfig(repoDir);
    const targets = loadSkillsTargets(repoDir);
    const dir = path.join(repoDir, "skills");
    let managed: string[] = [];
    try { managed = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { managed = []; }
    const links = loadSkillLinks(repoDir);
    const skills = managed.map((name) => ({ name, effective: effectiveSkill(cfg, name), links: links.filter((l) => l.skill === name) }));
    return reply.send({ config: cfg, targets, skills });
  });

  server.get("/api/skills/discover", async (_req, reply) => {
    const mod = registry.get("skills");
    if (!mod) return reply.code(404).send({ error: "skills module missing" });
    return reply.send({ candidates: await mod.discover(makeCtx(true)) });
  });

  server.post("/api/skills/capture", async (req, reply) => {
    const body = (req.body ?? {}) as { names?: string[] };
    const mod = registry.get("skills");
    if (!mod) return reply.code(404).send({ error: "skills module missing" });
    const cs = await mod.capture(makeCtx(false), { modules: { skills: body.names ?? [] } });
    cache.clear();
    return reply.send(cs);
  });

  server.post("/api/skills/toggle", async (req, reply) => {
    const b = (req.body ?? {}) as { skill?: string; target?: string; enabled?: boolean };
    if (!b.skill || typeof b.enabled !== "boolean") return reply.code(400).send({ error: "skill + enabled required" });
    const cfg = loadSkillsConfig(repoDir);
    const e = cfg.skills[b.skill] ?? {};
    if (b.target) {
      const base = e.targets ?? cfg.targets;
      const set = new Set(base);
      if (b.enabled) set.add(b.target); else set.delete(b.target);
      e.targets = [...set];
    } else { e.enabled = b.enabled; }
    cfg.skills[b.skill] = e;
    saveSkillsConfig(repoDir, cfg);
    return reply.send({ ok: true, config: cfg });
  });

  server.post("/api/skills/link", async (req, reply) => {
    const b = (req.body ?? {}) as { copy?: boolean; targets?: string[] };
    if (b.copy || b.targets) {
      const cfg = loadSkillsConfig(repoDir);
      if (b.copy) cfg.method = "copy";
      if (b.targets) cfg.targets = b.targets;
      saveSkillsConfig(repoDir, cfg);
    }
    const mod = registry.get("skills");
    if (!mod) return reply.code(404).send({ error: "skills module missing" });
    const res = await mod.apply(makeCtx(false), { module: "skills", actions: [] });
    cache.clear();
    return reply.send(res);
  });

  server.post("/api/skills/config", async (req, reply) => {
    const cfg = req.body as ReturnType<typeof loadSkillsConfig>;
    saveSkillsConfig(repoDir, cfg);
    return reply.send({ ok: true });
  });
```
Confirm `fs`/`path` are imported in server.ts (they are). Ensure `cache` is the same TTL cache variable used elsewhere.

- [ ] **Step 4: Run server tests + typecheck**
- `pnpm exec vitest run packages/cli/src/server.test.ts`
- `pnpm --filter @roost/cli typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(cli): /api/skills endpoints (list/discover/capture/toggle/link/config)"
```

---

## Task 8: Web — api client + i18n strings

**Files:**
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/i18n/strings.ts`

- [ ] **Step 1: Add API types + functions to `api.ts`** (mirror existing function style; read the file's `apiFetch` helper and an existing module's functions first):

```ts
export type SkillMethod = "symlink" | "copy";
export interface SkillTarget { id: string; path: string; label: string; }
export interface EffectiveSkill { enabled: boolean; targets: string[]; method: SkillMethod; }
export interface SkillLink { skill: string; target: string; path: string; kind: SkillMethod; }
export interface SkillsConfig { sourceDir: string; method: SkillMethod; targets: string[]; skills: Record<string, { enabled?: boolean; targets?: string[]; method?: SkillMethod }>; }
export interface SkillsView { config: SkillsConfig; targets: SkillTarget[]; skills: { name: string; effective: EffectiveSkill; links: SkillLink[] }[]; }

export function getSkills(): Promise<SkillsView> { return apiFetch<SkillsView>("/api/skills"); }
export function discoverSkills(): Promise<{ candidates: { id: string; note?: string }[] }> { return apiFetch("/api/skills/discover"); }
export function captureSkills(names: string[]): Promise<{ written: string[]; blocked?: string[] }> { return apiFetch("/api/skills/capture", { method: "POST", body: JSON.stringify({ names }) }); }
export function toggleSkill(skill: string, enabled: boolean, target?: string): Promise<{ ok: boolean }> { return apiFetch("/api/skills/toggle", { method: "POST", body: JSON.stringify({ skill, enabled, target }) }); }
export function linkSkills(opts?: { copy?: boolean; targets?: string[] }): Promise<{ applied: string[]; skipped: string[] }> { return apiFetch("/api/skills/link", { method: "POST", body: JSON.stringify(opts ?? {}) }); }
export function saveSkillsConfig(config: SkillsConfig): Promise<{ ok: boolean }> { return apiFetch("/api/skills/config", { method: "POST", body: JSON.stringify(config) }); }
```
Match the exact `apiFetch` call convention used by existing POST helpers (some may pass an object body differently — mirror, e.g., `installPackages`/`captureSelection`).

- [ ] **Step 2: Add i18n keys** to `strings.ts` under both `en` and `zh` (match the file's key style — flat dotted `{en, zh}`):
```
skills.title:            "Skills" / "Skills"
skills.tab.discovered:   "Discovered" / "发现"
skills.tab.selected:     "Managed" / "已管理"
skills.method.symlink:   "Symlink" / "软链"
skills.method.copy:      "Copy" / "拷贝"
skills.enable:           "Enabled" / "启用"
skills.conflict:         "Conflict" / "冲突"
skills.dangling:         "Broken link" / "断链"
skills.link:             "Apply links" / "应用软链"
skills.capture:          "Back up selected" / "备份所选"
skills.sourceDir:        "Canonical source" / "规范源目录"
```

- [ ] **Step 3: Typecheck** — `pnpm --filter @roost/web typecheck`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/i18n/strings.ts
git commit -m "feat(web): skills api client + i18n strings"
```

---

## Task 9: Web — Skills page (skill × IDE matrix) + nav + test + browser verify

**Files:**
- Create: `packages/web/src/views/Skills.tsx`
- Create: `packages/web/src/Skills.test.tsx`
- Modify: `packages/web/src/App.tsx`

Read an existing tabbed view (`packages/web/src/views/AppConfig.tsx`) and `components/TabSwitch.tsx` to reuse the Selected/Discovered tab pattern, and read `App.tsx` to see how views are registered in the nav/router.

- [ ] **Step 1: Write the failing test** `packages/web/src/Skills.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Skills } from "./views/Skills";

vi.mock("./api", () => ({
  getSkills: vi.fn().mockResolvedValue({
    config: { sourceDir: "~/.agents/skills", method: "symlink", targets: ["claude", "codex"], skills: { foo: {} } },
    targets: [{ id: "claude", path: ".claude/skills", label: "Claude Code" }, { id: "codex", path: ".codex/skills", label: "Codex" }],
    skills: [{ name: "foo", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [{ skill: "foo", target: "claude", path: "/h/.claude/skills/foo", kind: "symlink" }] }],
  }),
  discoverSkills: vi.fn().mockResolvedValue({ candidates: [] }),
  captureSkills: vi.fn(), toggleSkill: vi.fn().mockResolvedValue({ ok: true }),
  linkSkills: vi.fn().mockResolvedValue({ applied: [], skipped: [] }),
  saveSkillsConfig: vi.fn(),
}));

describe("Skills view", () => {
  it("renders the managed skill row with an IDE matrix", async () => {
    render(<Skills />);
    expect(await screen.findByText("foo")).toBeInTheDocument();
    // a column header per target
    await waitFor(() => expect(screen.getByText(/Claude Code/)).toBeInTheDocument());
    expect(screen.getByText(/Codex/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @roost/web test -- Skills`

- [ ] **Step 3: Implement `Skills.tsx`** — a tabbed view (Managed / Discovered) following AppConfig.tsx conventions. Managed tab renders a table: one row per skill with (a) a master enable toggle calling `toggleSkill(name, !enabled)`, (b) one checkbox per target calling `toggleSkill(name, true/false, targetId)` with a status badge from `links`/effective, (c) a method select (symlink/copy) persisted via `saveSkillsConfig`. A top recipe bar shows `sourceDir`, default method, default targets. Discovered tab lists `discoverSkills()` candidates (showing `note`/conflict) with checkboxes → `captureSkills(selected)`. An "Apply links" button calls `linkSkills()` then refetches `getSkills()`. Use `t()` for labels, Phosphor icons, no emoji, coral accent — match the existing views' styling utilities/classes. Keep the file focused; if it grows past the size of AppConfig.tsx, extract the matrix row into a small sub-component in the same file.

Provide a working first implementation (the test only requires the managed row + target column headers to render from `getSkills()` on mount). Build the rest to spec.

- [ ] **Step 4: Wire nav/route in `App.tsx`** — add a "Skills" entry alongside Dotfiles/Packages/AppConfig/Projects, importing `Skills` and adding it to whatever nav list + view-switch the file uses. Use a Phosphor icon consistent with the others.

- [ ] **Step 5: Run web tests + typecheck**
- `pnpm --filter @roost/web test` (whole suite green, incl. new Skills test)
- `pnpm --filter @roost/web typecheck`

- [ ] **Step 6: Browser verify** — build web + serve via cli, screenshot the Skills page:
```
pnpm --filter @roost/web build
node packages/cli/dist/index.js serve --web packages/web/dist --port 4321 &
```
Use the preview tooling (mcp__Claude_Preview) to open `http://127.0.0.1:4321`, navigate to Skills, and confirm: the page renders, the Managed/Discovered tabs work, the skill×IDE matrix shows, toggling a checkbox calls the API (network tab). Capture a screenshot. Kill the server after.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/views/Skills.tsx packages/web/src/Skills.test.tsx packages/web/src/App.tsx
git commit -m "feat(web): Skills page with skill x IDE enable matrix"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 selection key (Tasks 4/7 use `modules.skills`); §3.2 catalog + override (Task 2); §3.3 recipe + three layers + effective resolution (Task 3); §3.4 link state under state/ (Task 3); §4 all eight ops (Tasks 4–5); §5 reversibility/conflict/only-own-links (Task 5 apply/unmanage + tests); §6 CLI (Task 6); §7 web + endpoints (Tasks 7–9); §8 secrets (Task 4 capture gate); §9 ADR (Task 1); §10 test matrix — unit (Tasks 2–4), dry-run + idempotent + reconcile + real-symlink (Task 5). All covered.
- **Symbol consistency:** `DEFAULT_SKILLS_TARGETS`/`loadSkillsTargets`/`SkillTarget` (Task 2) ↔ used Tasks 4,5,7,8. `SkillsConfig`/`loadSkillsConfig`/`saveSkillsConfig`/`effectiveSkill`/`EffectiveSkill`/`SkillEntry`/`SkillMethod`/`loadSkillLinks`/`saveSkillLinks`/`SkillLink` (Task 3) ↔ used Tasks 5,6,7,8. `skillsModule` (Task 4) ↔ registered Task 5, used Tasks 6,7. API names `getSkills/discoverSkills/captureSkills/toggleSkill/linkSkills/saveSkillsConfig` (Task 8) ↔ Task 9. Apply result id convention `"<skill>@<target>"` consistent (Tasks 5 tests + 5 impl).
- **Known verification points flagged inline:** exact secret-scanner export name (Task 4 Step 3 note), `makeRealCtx`/`makeCtx` helper names in tests (Tasks 5/7), and whether index.ts already has a ModuleContext builder (Task 6). Each task tells the implementer to confirm against the real file before coding.
- **Idempotency/reconcile** is the riskiest logic — covered by 5 explicit tests in Task 5 (materialize+link, dry-run no-op, idempotent single link, disable removes link, conflict skip).
