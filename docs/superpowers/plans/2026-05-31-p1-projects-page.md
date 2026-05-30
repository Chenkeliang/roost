# P1 — Projects Rich Page (vertical slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a content-first **Projects** page — managed projects + on-demand discovery grouped by remote host, with per-row Test/Save/Clone — and introduce the ADR-0006 `index()` contract on the `projects` module.

**Architecture:** New optional `SyncModule.index()` (cheap, reads repo) + keep `discover()` for on-demand full scans. `projects` implements both: `index()` reads `roost/projects.yaml`; `discover()` enriches each found repo with remote URL/host/protocol parsed from `.git/config` (no per-repo git). Project paths stored **home-relative** for portability. cli adds `/api/index`, `/api/discover?module=`, `/api/projects/test`. Web adds a Projects page. Thin orchestration (I1), single exec adapter (I3), modules-only extension (I4), no credential management (I6).

**Tech Stack:** TypeScript (strict), pnpm monorepo, vitest, Fastify, React. Branch: `feat_p1_mvp`.

**Every commit** ends with:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
**Gate (green before each push):** `pnpm lint && pnpm -r build && pnpm -r typecheck && pnpm test && pnpm --filter @roost/web test`. Build core before cli/their tests.

## File map
- `docs/adr/0006-tiered-on-demand-discovery.md` — flip to ACCEPTED (Task 1).
- `packages/shared/src/types.ts` — `ModuleIndex`, `SyncModule.index?`, `Candidate.remote/host/protocol` (Task 1).
- `packages/core/src/modules/projects.ts` — host/proto parse, home-relative paths, `index()`, discover enrichment, `testRemote`, apply resolve (Tasks 2–6).
- `packages/core/src/orchestrate.ts` — `indexAll` (Task 7).
- `packages/cli/src/server.ts` — `/api/index`, `/api/discover?module=`, `/api/projects/test` (Tasks 8–10).
- `packages/web/src/api.ts` — `getIndex`, `getDiscoverModule`, `testProjectRemote` (Task 11).
- `packages/web/src/views/Projects.tsx` (new) + `packages/web/src/App.tsx` (nav) + `packages/web/src/Projects.test.tsx` (new) (Task 12).

---

### Task 1: Accept ADR-0006 + shared types

**Files:**
- Modify: `docs/adr/0006-tiered-on-demand-discovery.md` (status line)
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Flip ADR status.** In `docs/adr/0006-tiered-on-demand-discovery.md`, change the status line to:
```markdown
- **状态**: 接受(ACCEPTED · 2026-05-31)。配套设计:`docs/superpowers/specs/2026-05-31-dashboard-redesign-design.md`。
```

- [ ] **Step 2: Add types.** In `packages/shared/src/types.ts`, add after the `Candidate` interface (line ~22):
```ts
export interface ModuleIndex {
  available: boolean;
  reason?: string;
  managed: number;
  summary?: Record<string, number | string>;
}
```
Extend `Candidate` (line 19–22) with three optional fields:
```ts
export interface Candidate {
  id: string; path: string; category: string; sizeBytes?: number;
  recommendation: Recommendation; note?: string;
  remote?: string; host?: string; protocol?: "ssh" | "https" | "other";
}
```
Add `index?` to the `SyncModule` interface (find `interface SyncModule { … }`), as a new optional method alongside `discover`:
```ts
  index?(ctx: ModuleContext): Promise<ModuleIndex>;
```

- [ ] **Step 3: Build shared + typecheck.**

Run: `pnpm --filter @roost/shared build && pnpm -r typecheck`
Expected: PASS (additive, backward-compatible).

- [ ] **Step 4: Commit.**
```bash
git add docs/adr/0006-tiered-on-demand-discovery.md packages/shared/src/types.ts
git commit -m "feat(shared): ModuleIndex + SyncModule.index() + Candidate remote/host/protocol (ADR-0006 accepted)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Remote host/protocol parsing helpers

**Files:**
- Modify: `packages/core/src/modules/projects.ts` (add exported helpers near top, after imports)
- Test: `packages/core/src/modules/projects.test.ts`

- [ ] **Step 1: Write failing tests.** Add to `packages/core/src/modules/projects.test.ts`:
```ts
import { parseRemoteHost, parseRemoteProtocol } from "./projects.js"; // add to existing import line

describe("parseRemoteHost / parseRemoteProtocol", () => {
  it("parses ssh git@host:path", () => {
    expect(parseRemoteHost("git@github.com:u/r.git")).toBe("github.com");
    expect(parseRemoteProtocol("git@github.com:u/r.git")).toBe("ssh");
  });
  it("parses https", () => {
    expect(parseRemoteHost("https://gitlab.luojilab.com/g/r.git")).toBe("gitlab.luojilab.com");
    expect(parseRemoteProtocol("https://gitlab.luojilab.com/g/r.git")).toBe("https");
  });
  it("parses ssh:// url", () => {
    expect(parseRemoteHost("ssh://git@code.qschou.com:22/g/r.git")).toBe("code.qschou.com");
    expect(parseRemoteProtocol("ssh://git@code.qschou.com/g/r.git")).toBe("ssh");
  });
  it("handles null / unknown", () => {
    expect(parseRemoteHost(null)).toBeNull();
    expect(parseRemoteProtocol(null)).toBe("other");
  });
});
```

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: FAIL — `parseRemoteHost` not exported.

- [ ] **Step 3: Implement.** In `packages/core/src/modules/projects.ts`, add exported helpers after the imports:
```ts
export function parseRemoteHost(url: string | null): string | null {
  if (!url) return null;
  let m = url.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/:]+)/i); // scheme://[user@]host
  if (m) return m[1]!;
  m = url.match(/^[^@\s]+@([^:]+):/); // git@host:path
  if (m) return m[1]!;
  return "other";
}

export function parseRemoteProtocol(url: string | null): "ssh" | "https" | "other" {
  if (!url) return "other";
  if (/^https?:\/\//i.test(url)) return "https";
  if (/^ssh:\/\//i.test(url) || /^[^@\s]+@[^:]+:/.test(url)) return "ssh";
  return "other";
}
```

- [ ] **Step 4: Run, verify pass.**
Run: `pnpm --filter @roost/core build && pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/core/src/modules/projects.ts packages/core/src/modules/projects.test.ts
git commit -m "feat(core): projects remote host/protocol parsers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Home-relative path helpers

**Files:**
- Modify: `packages/core/src/modules/projects.ts` (exported helpers)
- Test: `packages/core/src/modules/projects.test.ts`

- [ ] **Step 1: Write failing tests.**
```ts
import { toHomeRelative, fromHomeRelative } from "./projects.js"; // add to import

describe("home-relative paths", () => {
  it("stores under home as ~/…", () => {
    expect(toHomeRelative("/Users/keliang/go/src/x", "/Users/keliang")).toBe("~/go/src/x");
  });
  it("leaves outside-home paths absolute", () => {
    expect(toHomeRelative("/Volumes/Work/x", "/Users/keliang")).toBe("/Volumes/Work/x");
  });
  it("resolves ~/… against home", () => {
    expect(fromHomeRelative("~/go/src/x", "/Users/bob")).toBe("/Users/bob/go/src/x");
  });
  it("passes through absolute on resolve", () => {
    expect(fromHomeRelative("/Volumes/Work/x", "/Users/bob")).toBe("/Volumes/Work/x");
  });
});
```

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement.** Add to `packages/core/src/modules/projects.ts`:
```ts
export function toHomeRelative(absPath: string, home: string): string {
  const prefix = home.endsWith("/") ? home : home + "/";
  return absPath === home ? "~" : absPath.startsWith(prefix) ? "~/" + absPath.slice(prefix.length) : absPath;
}

export function fromHomeRelative(stored: string, home: string): string {
  if (stored === "~") return home;
  return stored.startsWith("~/") ? path.join(home, stored.slice(2)) : stored;
}
```
(`path` is already imported in projects.ts.)

- [ ] **Step 4: Run, verify pass.**
Run: `pnpm --filter @roost/core build && pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/core/src/modules/projects.ts packages/core/src/modules/projects.test.ts
git commit -m "feat(core): home-relative path helpers for projects portability

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `projects.index()` (cheap)

**Files:**
- Modify: `packages/core/src/modules/projects.ts` (add `index` method to `projectsModule`)
- Test: `packages/core/src/modules/projects.test.ts`

- [ ] **Step 1: Write failing test.**
```ts
describe("projectsModule.index", () => {
  it("is cheap: reports git availability + managed count, never scans/loops git", async () => {
    // Throwing exec for any per-repo git would fail; index may call `git --version` only.
    const calls: string[][] = [];
    const exec = {
      run: async (_cmd: string, args: string[]) => {
        calls.push(args);
        return { code: 0, stdout: "git version 2.x", stderr: "" };
      },
    } as unknown as import("@roost/shared").Exec;
    // repoDir with one managed project
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-idx-"));
    fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "roost", "projects.yaml"),
      "schemaVersion: 1\nprojects:\n  - path: ~/go/src/x\n    repo: git@github.com:u/x.git\n    envTool: none\n",
    );
    const ctx = makeCtx({ exec, repoDir, home: "/tmp/home" });
    const idx = await projectsModule.index!(ctx);
    expect(idx.available).toBe(true);
    expect(idx.managed).toBe(1);
    // No `ls-remote` / `status` / `remote` (no per-repo git in index)
    expect(calls.every((a) => !a.includes("ls-remote") && !a.includes("status") && !a.includes("remote"))).toBe(true);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: FAIL — `projectsModule.index` is undefined.

- [ ] **Step 3: Implement.** Add an `index` method to `projectsModule` in `packages/core/src/modules/projects.ts` (before `discover`):
```ts
  async index(ctx: ModuleContext): Promise<import("@roost/shared").ModuleIndex> {
    const git = await ctx.exec.run("git", ["--version"]);
    const doc = loadProjects(ctx.repoDir);
    return {
      available: git.code === 0,
      reason: git.code === 0 ? undefined : "git not found",
      managed: doc.projects.length,
    };
  },
```

- [ ] **Step 4: Run, verify pass.**
Run: `pnpm --filter @roost/core build && pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/core/src/modules/projects.ts packages/core/src/modules/projects.test.ts
git commit -m "feat(core): projects.index() — cheap availability + managed count (ADR-0006)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Enrich `projects.discover` with remote/host/protocol + home-relative ids; capture stores home-relative

**Files:**
- Modify: `packages/core/src/modules/projects.ts` (`discover` reads `.git/config` for remote; `capture` stores home-relative path)
- Test: `packages/core/src/modules/projects.test.ts`

- [ ] **Step 1: Write failing test.** (discover should attach remote/host/protocol read from `.git/config`, NOT via git subprocess):
```ts
describe("projectsModule.discover enrichment", () => {
  it("attaches remote/host/protocol from .git/config without per-repo git", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-disc-home-"));
    const repo = path.join(home, "work", "app");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".git", "config"),
      '[remote "origin"]\n\turl = git@gitlab.luojilab.com:team/app.git\n',
    );
    // exec that throws if any git per-repo command runs (discover must read the file, not call git)
    const exec = {
      run: async () => { throw new Error("discover must not call git per repo"); },
    } as unknown as import("@roost/shared").Exec;
    const ctx = makeCtx({ exec, home, repoDir: home });
    const cands = await projectsModule.discover(ctx);
    const c = cands.find((x) => x.path.endsWith("work/app"));
    expect(c).toBeDefined();
    expect(c!.remote).toBe("git@gitlab.luojilab.com:team/app.git");
    expect(c!.host).toBe("gitlab.luojilab.com");
    expect(c!.protocol).toBe("ssh");
    expect(c!.recommendation).toBe("track");
    fs.rmSync(home, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: FAIL — discover currently calls `git remote get-url` (throws) and doesn't set host/protocol.

- [ ] **Step 3: Implement.** In `packages/core/src/modules/projects.ts`:

(a) Add a file-based remote reader near the other helpers:
```ts
export function readOriginUrl(repoDir: string): string | null {
  try {
    const cfg = fs.readFileSync(path.join(repoDir, ".git", "config"), "utf8");
    const m = cfg.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/);
    if (m) return m[1]!.trim();
    const any = cfg.match(/url\s*=\s*(.+)/);
    return any ? any[1]!.trim() : null;
  } catch {
    return null;
  }
}
```
(b) Replace the `discover` body to read remotes from disk (no per-repo git subprocess):
```ts
  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const roots = candidateRoots(ctx.home);
    const capped = findGitRepos(roots).slice(0, 100);
    return capped.map((repoPath) => {
      const remote = readOriginUrl(repoPath);
      const hasRemote = remote !== null && remote.length > 0;
      const cand: Candidate = {
        id: repoPath,
        path: repoPath,
        category: "projects",
        recommendation: hasRemote ? "track" : "exclude",
        note: hasRemote ? undefined : "no remote — cannot restore from manifest",
      };
      if (hasRemote) {
        cand.remote = remote!;
        const h = parseRemoteHost(remote);
        if (h) cand.host = h;
        cand.protocol = parseRemoteProtocol(remote);
      }
      return cand;
    });
  },
```
(This removes the previous parallel `git remote get-url` probe — reading `.git/config` is cheaper and gives the URL for host grouping. The old `mapLimit` helper may now be unused; if ESLint flags it as unused, delete `mapLimit`.)
(c) In `capture`, store the path home-relative. Change the entry construction:
```ts
      const entry = {
        path: toHomeRelative(repoPath, ctx.home),
        repo: info.remote,
        envTool: (info.hasMise ? "mise" : "none") as "mise" | "none",
      };
```
and match existing entries by resolved path:
```ts
      const existing = doc.projects.findIndex((e) => fromHomeRelative(e.path, ctx.home) === repoPath);
```

- [ ] **Step 4: Run, verify pass** (and update any existing discover test that asserted `git remote get-url` calls — those should now assert `.git/config`-based behavior; the earlier "emits track candidate"/"no remote" tests need a real `.git/config` written, or assert via `readOriginUrl`. Update them to create a `.git/config` with/without a remote and drop the fake-exec remote responses).
Run: `pnpm --filter @roost/core build && pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/core/src/modules/projects.ts packages/core/src/modules/projects.test.ts
git commit -m "feat(core): projects.discover reads remote/host/protocol from .git/config; capture stores home-relative paths

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `testRemote` (git ls-remote) + apply resolves home-relative paths

**Files:**
- Modify: `packages/core/src/modules/projects.ts` (`testRemote` export; `apply` resolves `fromHomeRelative`)
- Test: `packages/core/src/modules/projects.test.ts`

- [ ] **Step 1: Write failing tests.**
```ts
import { testRemote } from "./projects.js"; // add to import

describe("testRemote", () => {
  it("reachable when git ls-remote exits 0", async () => {
    const exec = { run: async () => ({ code: 0, stdout: "ref\tHEAD", stderr: "" }) } as unknown as import("@roost/shared").Exec;
    const r = await testRemote(exec, "git@github.com:u/r.git");
    expect(r.reachable).toBe(true);
  });
  it("unreachable when git ls-remote fails (no credentials in message)", async () => {
    const exec = { run: async () => ({ code: 128, stdout: "", stderr: "fatal: Could not read from remote repository" }) } as unknown as import("@roost/shared").Exec;
    const r = await testRemote(exec, "git@gitlab.luojilab.com:t/p.git");
    expect(r.reachable).toBe(false);
    expect(r.message).toMatch(/unreachable|denied|remote/i);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: FAIL — `testRemote` not exported.

- [ ] **Step 3: Implement.** Add to `packages/core/src/modules/projects.ts`:
```ts
export async function testRemote(
  exec: Exec,
  remoteUrl: string,
): Promise<{ reachable: boolean; message: string }> {
  const r = await exec.run("git", ["ls-remote", "--heads", remoteUrl]);
  // Never surface credentials; map to a short status only.
  if (r.code === 0) return { reachable: true, message: "reachable" };
  return { reachable: false, message: "unreachable (network, VPN, or access denied)" };
}
```
Then in `apply`, resolve the stored path before use. At the top of the per-action loop, where `const targetPath = action.id;`, replace with:
```ts
      const targetPath = fromHomeRelative(action.id, ctx.home);
```
and resolve the `entryMap` lookup keys to absolute:
```ts
    const entryMap = new Map(doc.projects.map((e) => [fromHomeRelative(e.path, ctx.home), e]));
```

- [ ] **Step 4: Run, verify pass.**
Run: `pnpm --filter @roost/core build && pnpm exec vitest run packages/core/src/modules/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/core/src/modules/projects.ts packages/core/src/modules/projects.test.ts
git commit -m "feat(core): testRemote (git ls-remote) + apply resolves home-relative project paths

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `indexAll` orchestration

**Files:**
- Modify: `packages/core/src/orchestrate.ts`
- Test: `packages/core/src/orchestrate.test.ts`

- [ ] **Step 1: Write failing test.** Add to `packages/core/src/orchestrate.test.ts`:
```ts
import { indexAll } from "./orchestrate.js"; // add to import

it("indexAll returns a ModuleIndex per module that implements index()", async () => {
  const reg = defaultRegistry();
  const ctx = makeCtx(); // use the file's existing ctx helper / pattern
  const result = await indexAll(reg, ctx);
  // projects implements index() → present and shaped
  expect(result["projects"]).toBeDefined();
  expect(typeof result["projects"]!.managed).toBe("number");
  expect(typeof result["projects"]!.available).toBe("boolean");
});
```
(Use the same `ctx`/`makeCtx`/registry construction the existing `orchestrate.test.ts` tests use — read the top of that file.)

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm exec vitest run packages/core/src/orchestrate.test.ts`
Expected: FAIL — `indexAll` not exported.

- [ ] **Step 3: Implement.** Add to `packages/core/src/orchestrate.ts`:
```ts
import type { ModuleIndex } from "@roost/shared"; // ensure imported (type-only)

export async function indexAll(
  reg: ModuleRegistry,
  ctx: ModuleContext,
): Promise<Record<string, ModuleIndex>> {
  const out: Record<string, ModuleIndex> = {};
  for (const m of reg.list()) {
    if (typeof m.index === "function") {
      out[m.name] = await m.index(ctx);
    }
  }
  return out;
}
```
Export it from `packages/core/src/index.ts` (add `indexAll` to the orchestrate re-export list).

- [ ] **Step 4: Run, verify pass.**
Run: `pnpm --filter @roost/core build && pnpm exec vitest run packages/core/src/orchestrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/core/src/orchestrate.ts packages/core/src/orchestrate.test.ts packages/core/src/index.ts
git commit -m "feat(core): indexAll — aggregate ModuleIndex across modules

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `GET /api/index`

**Files:**
- Modify: `packages/cli/src/server.ts` (new route; import `indexAll`)
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Write failing test.** Add to `packages/cli/src/server.test.ts`:
```ts
  it("GET /api/index → 200 { index: { <module>: ModuleIndex } }", async () => {
    const reg = defaultRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/index" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { index: Record<string, { managed: number; available: boolean }> };
    expect(body.index.projects).toBeDefined();
    expect(typeof body.index.projects.managed).toBe("number");
    await server.close();
  });
```
(Use `defaultRegistry` import that the test file already has, or add it.)

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm exec vitest run packages/cli/src/server.test.ts`
Expected: FAIL — 404 (no route).

- [ ] **Step 3: Implement.** In `packages/cli/src/server.ts`, add `indexAll` to the `@roost/core` import, and add a route near `/api/status`:
```ts
  server.get("/api/index", async (_req, reply) => {
    try {
      const index = await cache.getOrCompute("index", () => indexAll(registry, makeCtx(true)));
      return reply.send({ index });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });
```

- [ ] **Step 4: Run, verify pass.**
Run: `pnpm --filter @roost/core build && pnpm --filter @roost/cli build && pnpm exec vitest run packages/cli/src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(cli): GET /api/index (cheap per-module index, cached)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `GET /api/discover?module=` (on-demand single module)

**Files:**
- Modify: `packages/cli/src/server.ts` (the existing `/api/discover` handler)
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Write failing test.**
```ts
  it("GET /api/discover?module=projects → only the projects key", async () => {
    const reg = defaultRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const res = await server.inject({ method: "GET", url: "/api/discover?module=projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { candidates: Record<string, unknown[]> };
    expect(Object.keys(body.candidates)).toEqual(["projects"]);
    await server.close();
  });
```

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm exec vitest run packages/cli/src/server.test.ts`
Expected: FAIL — returns all modules, not just projects.

- [ ] **Step 3: Implement.** Replace the `/api/discover` handler in `packages/cli/src/server.ts`:
```ts
  server.get("/api/discover", async (req, reply) => {
    try {
      const moduleName = (req.query as { module?: string } | undefined)?.module;
      if (moduleName) {
        const mod = registry.list().find((m) => m.name === moduleName);
        if (!mod) return reply.status(404).send({ error: `unknown module: ${moduleName}` });
        const candidates = await cache.getOrCompute(`discover:${moduleName}`, async () => ({
          [moduleName]: await mod.discover(makeCtx(true)),
        }));
        return reply.send({ candidates });
      }
      const candidates = await cache.getOrCompute("discover", () =>
        discoverAll(registry, makeCtx(true)),
      );
      return reply.send({ candidates });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });
```

- [ ] **Step 4: Run, verify pass.**
Run: `pnpm --filter @roost/cli build && pnpm exec vitest run packages/cli/src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(cli): GET /api/discover?module= for on-demand single-module discovery

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `POST /api/projects/test`

**Files:**
- Modify: `packages/cli/src/server.ts` (new route; import `testRemote` via `@roost/core`)
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Ensure `testRemote` is exported from core.** In `packages/core/src/index.ts`, add `testRemote` to the projects re-export (the line exporting projects-module symbols).

- [ ] **Step 2: Write failing test.**
```ts
  it("POST /api/projects/test → { reachable, message } (400 on missing remote)", async () => {
    const reg = defaultRegistry();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => makeCtx(tmpDir, d) });
    const bad = await server.inject({ method: "POST", url: "/api/projects/test", payload: {} });
    expect(bad.statusCode).toBe(400);
    const ok = await server.inject({ method: "POST", url: "/api/projects/test", payload: { remote: "git@github.com:u/r.git" } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { reachable: boolean; message: string };
    expect(typeof body.reachable).toBe("boolean");
    await server.close();
  });
```
(`makeCtx(tmpDir, false)` provides a real exec; `git ls-remote` on a real network may be slow/offline — if flaky, the test can stub by injecting a fake exec via the test's `makeCtx`. Use the test file's existing `makeCtx` which builds the ctx/exec; if it uses the real exec and network is unavailable, assert only on shape + statusCode, not on `reachable` truthiness.)

- [ ] **Step 3: Run, verify fail.**
Run: `pnpm exec vitest run packages/cli/src/server.test.ts`
Expected: FAIL — 404.

- [ ] **Step 4: Implement.** Add `testRemote` to the `@roost/core` import in `server.ts`, and add the route:
```ts
  server.post<{ Body: { remote?: string } }>("/api/projects/test", async (req, reply) => {
    const remote = req.body?.remote;
    if (typeof remote !== "string" || remote.length === 0) {
      return reply.status(400).send({ error: "remote is required" });
    }
    const result = await testRemote(makeCtx(true).exec, remote);
    return reply.send(result);
  });
```

- [ ] **Step 5: Run, verify pass.**
Run: `pnpm --filter @roost/core build && pnpm --filter @roost/cli build && pnpm exec vitest run packages/cli/src/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/core/src/index.ts packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(cli): POST /api/projects/test (git ls-remote reachability)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: web api client — `getIndex`, `getDiscoverModule`, `testProjectRemote`

**Files:**
- Modify: `packages/web/src/api.ts`
- Test: covered by the Projects component test (Task 12) which mocks these.

- [ ] **Step 1: Implement** (add to `packages/web/src/api.ts`, reusing the existing `apiFetch` helper + the `Candidate` re-export):
```ts
export interface ModuleIndex {
  available: boolean;
  reason?: string;
  managed: number;
  summary?: Record<string, number | string>;
}
export interface IndexResponse { index: Record<string, ModuleIndex>; }

export function getIndex(): Promise<IndexResponse> {
  return apiFetch<IndexResponse>("/api/index");
}
export function getDiscoverModule(module: string): Promise<DiscoverResponse> {
  return apiFetch<DiscoverResponse>(`/api/discover?module=${encodeURIComponent(module)}`);
}
export function testProjectRemote(remote: string): Promise<{ reachable: boolean; message: string }> {
  return apiFetch("/api/projects/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remote }),
  });
}
```

- [ ] **Step 2: Build + typecheck.**
Run: `pnpm --filter @roost/web build`
Expected: PASS.

- [ ] **Step 3: Commit.**
```bash
git add packages/web/src/api.ts
git commit -m "feat(web): api client for index / per-module discover / project remote test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: web Projects page + nav entry

**Files:**
- Create: `packages/web/src/views/Projects.tsx`
- Modify: `packages/web/src/App.tsx` (add the `projects` tab between `manage` and `env`)
- Test: Create `packages/web/src/Projects.test.tsx`

- [ ] **Step 1: Write the failing test** — `packages/web/src/Projects.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { Projects } from "./views/Projects";

vi.mock("./api", () => ({
  getIndex: vi.fn().mockResolvedValue({ index: { projects: { available: true, managed: 0 } } }),
  getDiscoverModule: vi.fn().mockResolvedValue({
    candidates: {
      projects: [
        { id: "/Users/k/work/a", path: "/Users/k/work/a", category: "projects", recommendation: "track", remote: "git@github.com:u/a.git", host: "github.com", protocol: "ssh" },
        { id: "/Users/k/work/b", path: "/Users/k/work/b", category: "projects", recommendation: "track", remote: "git@gitlab.luojilab.com:t/b.git", host: "gitlab.luojilab.com", protocol: "ssh" },
      ],
    },
  }),
  testProjectRemote: vi.fn().mockResolvedValue({ reachable: true, message: "reachable" }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { projects: ["/Users/k/work/a"] } }),
}));

describe("Projects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scans on demand and groups discovered repos by host", async () => {
    await act(async () => { render(<Projects showHud={vi.fn()} />); });
    // Scan is on-demand: nothing scanned until clicked.
    const scan = await screen.findByRole("button", { name: /scan/i });
    await act(async () => { fireEvent.click(scan); });
    await waitFor(() => expect(screen.getByText("github.com")).toBeInTheDocument());
    expect(screen.getByText("gitlab.luojilab.com")).toBeInTheDocument();
    // host filter chip narrows
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^github\.com/ })); });
    expect(screen.queryByText(/work\/b/)).not.toBeInTheDocument();
  });

  it("tests a remote and saves a project", async () => {
    const api = await import("./api");
    await act(async () => { render(<Projects showHud={vi.fn()} />); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /scan/i })); });
    await waitFor(() => screen.getByText(/work\/a/));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /test/i })[0]); });
    await waitFor(() => expect(api.testProjectRemote).toHaveBeenCalledWith("git@github.com:u/a.git"));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /save/i })[0]); });
    await waitFor(() => expect(api.addSelection).toHaveBeenCalledWith("projects", "/Users/k/work/a"));
  });
});
```

- [ ] **Step 2: Run, verify fail.**
Run: `pnpm --filter @roost/web test -- Projects`
Expected: FAIL — `./views/Projects` does not exist.

- [ ] **Step 3: Implement** — create `packages/web/src/views/Projects.tsx` (mirror the styling tokens/patterns used in `AliasesEnv.tsx`/`Manage.tsx`):
```tsx
import { useState, useEffect, useCallback } from "react";
import { GitBranch, MagnifyingGlass, ArrowsClockwise, FloppyDisk, CheckCircle, XCircle } from "@phosphor-icons/react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { getIndex, getDiscoverModule, testProjectRemote, addSelection } from "../api";

interface ProjectsProps { showHud?: (m: HudMessage) => void; }
type TestState = Record<string, "ok" | "fail" | "testing">;

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 11, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

export function Projects({ showHud }: ProjectsProps) {
  const [managed, setManaged] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string | undefined>();
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [host, setHost] = useState<string>("all");
  const [tested, setTested] = useState<TestState>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { index } = await getIndex();
        const p = index.projects;
        setManaged(p?.managed ?? 0);
        setAvailable(p?.available ?? true);
        setReason(p?.reason);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const { candidates } = await getDiscoverModule("projects");
      setCands(candidates.projects ?? []);
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Scan failed", type: "error" });
    } finally {
      setScanning(false);
    }
  }, [showHud]);

  const test = useCallback(async (c: Candidate) => {
    if (!c.remote) return;
    setTested((t) => ({ ...t, [c.id]: "testing" }));
    try {
      const r = await testProjectRemote(c.remote);
      setTested((t) => ({ ...t, [c.id]: r.reachable ? "ok" : "fail" }));
      showHud?.({ text: `${c.host}: ${r.message}`, type: r.reachable ? "success" : "error" });
    } catch {
      setTested((t) => ({ ...t, [c.id]: "fail" }));
    }
  }, [showHud]);

  const save = useCallback(async (c: Candidate) => {
    try {
      await addSelection("projects", c.id);
      setManaged((m) => (m ?? 0) + 1);
      showHud?.({ text: `Saved ${c.path}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Save failed", type: "error" });
    }
  }, [showHud]);

  const hosts = cands ? [...new Set(cands.map((c) => c.host ?? "no-remote"))].sort() : [];
  const shown = (cands ?? []).filter((c) => host === "all" || (c.host ?? "no-remote") === host);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        Git projects Roost can re-clone on a new Mac. Managed: {loading ? "…" : managed} · scanning your disk is on-demand.
      </p>

      {!available && (
        <div role="alert" style={{ padding: "10px 14px", background: "rgba(242,85,90,.1)", border: "1px solid var(--red)", borderRadius: "var(--rr)", color: "var(--red)", fontSize: 13, marginBottom: 14 }}>
          {reason ?? "git not available"}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button onClick={() => void scan()} disabled={scanning || !available} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 13 }}>
          {scanning ? <ArrowsClockwise size={14} /> : <MagnifyingGlass size={14} />}
          {scanning ? "Scanning…" : "Scan for git projects"}
        </button>
      </div>

      {cands && cands.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {["all", ...hosts].map((h) => (
            <button key={h} onClick={() => setHost(h)} style={{ ...ic, borderRadius: 999, ...(host === h ? { background: "rgba(255,99,99,.13)", borderColor: "var(--accent)", color: "var(--accent)" } : {}) }}>
              {h}{h !== "all" ? ` (${cands.filter((c) => (c.host ?? "no-remote") === h).length})` : ` (${cands.length})`}
            </button>
          ))}
        </div>
      )}

      {scanning ? (
        <div style={card}>{[1, 2, 3].map((i) => <div key={i} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}><Skeleton width={300} height={14} /></div>)}</div>
      ) : cands === null ? (
        <EmptyState icon={<GitBranch size={24} />} title="No scan yet" subtitle="Click “Scan for git projects” to find repositories on this Mac." />
      ) : shown.length === 0 ? (
        <EmptyState icon={<GitBranch size={24} />} title="Nothing here" subtitle="No repositories match this host filter." />
      ) : (
        <div style={card}>
          {shown.map((c) => (
            <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
              <span style={{ color: "var(--muted)", fontSize: 11, minWidth: 150, fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.remote ?? "no remote"}</span>
              {tested[c.id] === "ok" && <CheckCircle size={14} weight="fill" style={{ color: "var(--green)" }} />}
              {tested[c.id] === "fail" && <XCircle size={14} weight="fill" style={{ color: "var(--red)" }} />}
              <button onClick={() => void test(c)} disabled={!c.remote || tested[c.id] === "testing"} style={ic} aria-label={`test ${c.path}`}>Test</button>
              <button onClick={() => void save(c)} style={{ ...ic, color: "var(--accent)" }} aria-label={`save ${c.path}`}><FloppyDisk size={11} />Save</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the nav** — in `packages/web/src/App.tsx`:
(a) add the import: `import { Projects } from "./views/Projects";`
(b) add `"projects"` to the `Tab` union type;
(c) add `{ id: "projects", label: "Projects" }` to `TABS` (after the `manage` entry);
(d) add the render line in `<main>`: `{activeTab === "projects" && <Projects showHud={showHud} />}`.

- [ ] **Step 5: Run, verify pass.**
Run: `pnpm --filter @roost/web build && pnpm --filter @roost/web test -- Projects`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/web/src/views/Projects.tsx packages/web/src/App.tsx packages/web/src/Projects.test.tsx
git commit -m "feat(web): Projects page — on-demand scan, host grouping, test/save (P1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Full gate + push

- [ ] **Step 1: Full gate.**
Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm -r build && pnpm -r typecheck && pnpm test && pnpm --filter @roost/web test`
Expected: ALL GREEN.

- [ ] **Step 2: Push, confirm CI green (ubuntu + macOS).**
```bash
git push
```

---

## Verification matrix (spec coverage)

| Spec item | Task |
|---|---|
| ADR-0006 accepted; `index()` contract (§4) | 1, 4, 7 |
| Discover host/protocol grouping (§5.4) | 2, 5, 12 |
| Home-relative path portability (§7A) | 3, 5, 6 |
| `git ls-remote` Test, Clone via apply (§5.4) | 6, 12 |
| `/api/index`, `/api/discover?module=`, `/api/projects/test` (§8) | 8, 9, 10 |
| Projects rich page: managed + on-demand scan + host chips + Test/Save (§5.4) | 11, 12 |
| Nav entry for Projects | 12 |

## Out of scope (later P1 / P2)
- Full left-sidebar IA; Packages/Dotfiles/AppConfig rich pages.
- Clone button UI for managed-but-missing repos (apply already supports clone; surface in a follow-up).
- Real per-host machine state, profiles/overrides (P2, ADR-0005).
