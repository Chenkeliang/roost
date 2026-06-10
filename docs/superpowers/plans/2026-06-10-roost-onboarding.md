# Roost First-Run Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guided first-run experience that detects "no usable config repo" and walks the user through creating/connecting a repo → env check → selecting modules → capture → push, plus a blocking age-key backup confirmation and a remote-not-configured banner.

**Architecture:** Web-layer feature. Three thin Fastify endpoints (`/api/init`, `/api/clone`, `/api/git/remote`) delegate to existing helpers (`runInit`, `ensureGitRepo`, `cloneRepo`). The UI is an inline stepper that owns the Overview surface when `git/status.isRepo === false`. No core domain logic, no schema change, no ADR.

**Tech Stack:** TypeScript (strict), Fastify, React + Vite, vitest (jsdom for web), Phosphor icons. pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-06-10-roost-onboarding-design.md`

**Conventions (all tasks):**
- Branch `feat_onboarding` (already cut off `origin/main`). Stage files explicitly (`git add <paths>`), one commit per task. Do NOT push.
- TS strict; no `any` (eslint `no-explicit-any`). Phosphor icons, **no emoji** in new code. Coral (`var(--accent)`) for the primary action only.
- Web tests: `.test.tsx` files live in `packages/web/src/` (NOT under `views/`), run via `pnpm --filter @roost/web test -- <pattern>` (jsdom). Views render English **without** a LocaleProvider, so test `t` is passed as `(k) => k` for leaf components, and api-mocked integration tests match the literal key strings.
- Server/core tests: `npx vitest run <path>` from repo root.
- Build: `pnpm -r build`. Lint: `pnpm lint`.
- i18n: add flat dotted keys `{ en, zh }` to `packages/web/src/i18n/strings.ts`.

---

## Shared contracts (consistent across all tasks)

**Server responses:**
- `POST /api/init` `{ remoteUrl?: string }` → `{ created: string[]; isRepo: true; remote: string | null }`
- `POST /api/clone` `{ url: string }` → `{ ok: boolean; error?: string }`
- `POST /api/git/remote` `{ url: string }` → `{ ok: boolean; remote: string }`

**Web api.ts additions:**
- `interface InitResult { created: string[]; isRepo: boolean; remote: string | null }` · `postInit(remoteUrl?: string)`
- `interface CloneResult { ok: boolean; error?: string }` · `postClone(url: string)`
- `interface RemoteResult { ok: boolean; remote: string }` · `setGitRemote(url: string)`

**Component props:**
- `KeyBackupConfirm({ recipient: string | null; keyPath: string; t; onConfirm: () => void })`
- `RemoteWarningBanner({ t; onConfigured: () => void })`
- `StepRepo({ t; showHud?; onDone: () => void })`
- `StepSelect({ t; showHud?; onDone: () => void })`
- `StepCapture({ t; showHud?; onDone: () => void })`
- `Onboarding({ t; showHud?; onComplete: () => void })`
- `Setup({ onOpenSettings?; embedded?: boolean; onReady?: (ready: boolean) => void })` (extended)

**`SECRET_MODULES = new Set(["env"])`** — the module whose capture encrypts secrets (has the `age-key` doctor gate at `packages/core/src/modules/env.ts:831`). Selecting it is the lazy-keygen trigger. (dotfiles can also encrypt per-file via chezmoi; that path's key need is covered by the Settings keygen guardrail + preflight.)

## File structure

**New:**
- `packages/web/src/components/KeyBackupConfirm.tsx` — blocking backup-confirm modal (reused by Settings).
- `packages/web/src/components/RemoteWarningBanner.tsx` — Overview banner when local-only.
- `packages/web/src/views/onboarding/StepRepo.tsx` — step 1 (create / clone fork).
- `packages/web/src/views/onboarding/StepSelect.tsx` — step 3 (discover + pre-select).
- `packages/web/src/views/onboarding/StepCapture.tsx` — step 4 (capture + lazy keygen).
- `packages/web/src/views/onboarding/Onboarding.tsx` — the 5-step shell.
- Tests in `packages/web/src/`: `KeyBackupConfirm.test.tsx`, `RemoteWarningBanner.test.tsx`, `Setup.test.tsx`, `StepRepo.test.tsx`, `StepSelect.test.tsx`, `StepCapture.test.tsx`, `Onboarding.test.tsx`, `OnboardingGate.test.tsx`.

**Modified:**
- `packages/cli/src/server.ts` — 3 endpoints + `setOrigin` helper + imports.
- `packages/cli/src/server.test.ts` — endpoint tests + `makeGitFake`.
- `packages/web/src/api.ts` — 3 wrappers + 3 types.
- `packages/web/src/views/Setup.tsx` — `embedded` + `onReady` props.
- `packages/web/src/views/Overview.tsx` — gate on `git/status`, render Onboarding/banner.
- `packages/web/src/views/Settings.tsx` — KeyBackupConfirm after generate/rotate.
- `packages/web/src/i18n/strings.ts` — `onboard.*` namespace.

---

### Task 1: Server — `POST /api/init` + `POST /api/git/remote` + `setOrigin` helper

**Files:**
- Modify: `packages/cli/src/server.ts` (imports near top; helper near `classifyGitError` ~line 96; routes after `/api/git/pull` ~line 626)
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Add the `makeGitFake` helper to the test file** (top of file, after `makeFakeExec`, ~line 40)

```ts
// A stateful git fake: tracks origin + repo state so init/remote round-trips are testable.
function makeGitFake(opts?: { isRepo?: boolean; origin?: string; cloneFails?: boolean }): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  let origin: string | null = opts?.origin ?? null;
  let isRepo = opts?.isRepo ?? false;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push([cmd, ...args]);
      const a = args.join(" ");
      if (cmd !== "git") return { code: 0, stdout: "", stderr: "" };
      if (a.includes("rev-parse --is-inside-work-tree")) return { code: isRepo ? 0 : 1, stdout: isRepo ? "true" : "", stderr: "" };
      if (a.includes("init -b main")) { isRepo = true; return { code: 0, stdout: "", stderr: "" }; }
      if (a.includes("rev-parse --verify HEAD")) return { code: 0, stdout: "abc123", stderr: "" };
      if (a.includes("remote get-url origin")) return origin ? { code: 0, stdout: origin, stderr: "" } : { code: 1, stdout: "", stderr: "no origin" };
      if (a.includes("remote add origin")) { origin = args[args.length - 1] ?? null; return { code: 0, stdout: "", stderr: "" }; }
      if (a.includes("remote set-url origin")) { origin = args[args.length - 1] ?? null; return { code: 0, stdout: "", stderr: "" }; }
      if (a.startsWith("clone")) return opts?.cloneFails ? { code: 1, stdout: "", stderr: "fatal: destination path already exists" } : { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { exec, calls };
}
```

- [ ] **Step 2: Write failing tests** (new `describe` block in `server.test.ts`)

```ts
describe("onboarding endpoints", () => {
  it("POST /api/init scaffolds the repo and reports isRepo:true, remote:null when no url", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/init", payload: {}, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: string[]; isRepo: boolean; remote: string | null };
    expect(body.isRepo).toBe(true);
    expect(body.remote).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, "roost", "selection.yaml"))).toBe(true);
    await server.close();
  });

  it("POST /api/init with remoteUrl sets origin and echoes it back", async () => {
    const reg = new ModuleRegistry();
    const { exec, calls } = makeGitFake();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/init", payload: { remoteUrl: "git@github.com:me/dot.git" }, headers: { "content-type": "application/json" } });
    const body = res.json() as { remote: string | null };
    expect(body.remote).toBe("git@github.com:me/dot.git");
    expect(calls.some((c) => c.join(" ").includes("remote add origin git@github.com:me/dot.git"))).toBe(true);
    await server.close();
  });

  it("POST /api/git/remote sets origin and returns it", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake({ isRepo: true });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/git/remote", payload: { url: "git@github.com:me/dot.git" }, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { remote: string }).remote).toBe("git@github.com:me/dot.git");
    await server.close();
  });

  it("POST /api/git/remote 400 when url missing", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake({ isRepo: true });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/git/remote", payload: {}, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run packages/cli/src/server.test.ts -t "onboarding endpoints"`
Expected: FAIL (routes return 404 / handler undefined).

- [ ] **Step 4: Add imports** to `packages/cli/src/server.ts`

Add `Exec` to the shared type import (line ~8):
```ts
import type { ModuleContext, EnvData, Exec } from "@roost/shared";
```
Add `cloneRepo` to the `@roost/core` import block (alongside `testRemote`):
```ts
  cloneRepo,
```
Add two new local imports (after line 66, the `finalizeCapture` import):
```ts
import { runInit } from "./init.js";
import { ensureGitRepo } from "./gitRepo.js";
```

- [ ] **Step 5: Add the `setOrigin` helper** (module scope, right after `classifyGitError`, ~line 119)

```ts
// Add or update the `origin` remote idempotently.
async function setOrigin(exec: Exec, repoDir: string, url: string): Promise<void> {
  const existing = await exec.run("git", ["-C", repoDir, "remote", "get-url", "origin"]);
  const sub = existing.code === 0 ? "set-url" : "add";
  await exec.run("git", ["-C", repoDir, "remote", sub, "origin", url]);
}
```

- [ ] **Step 6: Add the routes** (after the `/api/git/pull` handler, ~line 626)

```ts
  // ── POST /api/init ────────────────────────────────────────────────────────────
  // Scaffold a fresh config repo (idempotent) + git init + first commit; optionally
  // wire an origin remote. Delegates to existing helpers; no shell-out from the UI.
  server.post<{ Body: { remoteUrl?: string } }>("/api/init", async (req, reply) => {
    try {
      cache.invalidateAll();
      const exec = makeCtx(false).exec;
      const { created } = await runInit({ repoDir });
      await ensureGitRepo(exec, repoDir);
      const remoteUrl = req.body?.remoteUrl?.trim();
      if (remoteUrl) await setOrigin(exec, repoDir, remoteUrl);
      const r = await exec.run("git", ["-C", repoDir, "remote", "get-url", "origin"]);
      const remote = r.code === 0 ? r.stdout.trim() || null : null;
      return reply.send({ created, isRepo: true, remote });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── POST /api/git/remote ──────────────────────────────────────────────────────
  server.post<{ Body: { url?: string } }>("/api/git/remote", async (req, reply) => {
    cache.invalidateAll();
    const url = req.body?.url?.trim();
    if (!url) return reply.status(400).send({ error: "url is required" });
    const exec = makeCtx(false).exec;
    await setOrigin(exec, repoDir, url);
    return reply.send({ ok: true, remote: url });
  });
```

- [ ] **Step 7: Run tests, verify pass**

Run: `npx vitest run packages/cli/src/server.test.ts -t "onboarding endpoints"`
Expected: 3 of the 4 new tests pass (clone is Task 2).

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(server): POST /api/init and /api/git/remote for onboarding"
```

---

### Task 2: Server — `POST /api/clone`

**Files:**
- Modify: `packages/cli/src/server.ts`
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Write failing tests** (add to the `onboarding endpoints` describe block)

```ts
  it("POST /api/clone returns {ok:true} on success", async () => {
    const reg = new ModuleRegistry();
    const { exec, calls } = makeGitFake();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/clone", payload: { url: "git@github.com:me/dot.git" }, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
    expect(calls.some((c) => c[0] === "git" && c[1] === "clone")).toBe(true);
    await server.close();
  });

  it("POST /api/clone surfaces {ok:false,error} on failure", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake({ cloneFails: true });
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/clone", payload: { url: "git@github.com:me/dot.git" }, headers: { "content-type": "application/json" } });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/destination path already exists/);
    await server.close();
  });

  it("POST /api/clone 400 when url missing", async () => {
    const reg = new ModuleRegistry();
    const { exec } = makeGitFake();
    const server = buildServer({ repoDir: tmpDir, registry: reg, makeCtx: (d) => ({ ...makeCtx(tmpDir, d), exec }) });
    const res = await server.inject({ method: "POST", url: "/api/clone", payload: {}, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run packages/cli/src/server.test.ts -t "api/clone"` → FAIL (404).

- [ ] **Step 3: Add the route** (right after `/api/init`, before `/api/git/remote`)

```ts
  // ── POST /api/clone ───────────────────────────────────────────────────────────
  // Clone an existing config repo into the (boot-resolved) repoDir — the second-machine path.
  server.post<{ Body: { url?: string } }>("/api/clone", async (req, reply) => {
    cache.invalidateAll();
    const url = req.body?.url?.trim();
    if (!url) return reply.status(400).send({ error: "url is required" });
    const exec = makeCtx(false).exec;
    const result = await cloneRepo(exec, url, repoDir);
    return reply.send(result);
  });
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run packages/cli/src/server.test.ts -t "onboarding endpoints"` → all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(server): POST /api/clone for onboarding second-machine path"
```

---

### Task 3: Web api.ts — `postInit` / `postClone` / `setGitRemote`

**Files:**
- Modify: `packages/web/src/api.ts` (in the `// ── Git remote & sync ──` section, after `getGitStatus`/`gitPush`/`gitPull`)

No dedicated test — these mirror existing untested thin `apiFetch` wrappers (e.g. `addSelection`, `testProjectRemote`); they are exercised by the component tests that mock `./api`.

- [ ] **Step 1: Add types + wrappers**

```ts
// ── First-run onboarding (init / clone / set remote) ──────────────────────────
export interface InitResult { created: string[]; isRepo: boolean; remote: string | null; }
export interface CloneResult { ok: boolean; error?: string; }
export interface RemoteResult { ok: boolean; remote: string; }

export function postInit(remoteUrl?: string): Promise<InitResult> {
  return apiFetch<InitResult>("/api/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(remoteUrl ? { remoteUrl } : {}),
  });
}

export function postClone(url: string): Promise<CloneResult> {
  return apiFetch<CloneResult>("/api/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function setGitRemote(url: string): Promise<RemoteResult> {
  return apiFetch<RemoteResult>("/api/git/remote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @roost/web build` (or `pnpm -r build`). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api.ts
git commit -m "feat(web): api wrappers postInit/postClone/setGitRemote"
```

---

### Task 4: i18n — `onboard.*` namespace

**Files:**
- Modify: `packages/web/src/i18n/strings.ts` (append a new block before the closing `};`)

- [ ] **Step 1: Add the strings**

```ts
  // ── First-run onboarding ─────────────────────────────────────────────────
  "onboard.title": { en: "Set up Roost", zh: "设置 Roost" },
  "onboard.step.repo": { en: "Repo", zh: "仓库" },
  "onboard.step.check": { en: "Check", zh: "检查" },
  "onboard.step.select": { en: "Select", zh: "选择" },
  "onboard.step.capture": { en: "Capture", zh: "备份" },
  "onboard.step.push": { en: "Push", zh: "推送" },
  "onboard.next": { en: "Next", zh: "下一步" },
  "onboard.repo.heading": { en: "Set up your config repo", zh: "设置你的配置仓库" },
  "onboard.repo.createTab": { en: "Create new", zh: "新建" },
  "onboard.repo.cloneTab": { en: "I already have one", zh: "我已有一个" },
  "onboard.repo.createHelp": { en: "Scaffolds a new repo locally and makes the first commit.", zh: "在本地脚手架一个新仓库并完成首次提交。" },
  "onboard.repo.remoteOptional": { en: "Remote URL (optional) — git@github.com:you/dotfiles.git", zh: "远端 URL(可选)—— git@github.com:you/dotfiles.git" },
  "onboard.repo.githubHint": { en: "Create an empty private repo on GitHub and paste its URL. To create it from the CLI instead: roost init --github", zh: "在 GitHub 上创建一个空的私有仓库并粘贴其 URL。或用命令行创建:roost init --github" },
  "onboard.repo.createBtn": { en: "Create", zh: "创建" },
  "onboard.repo.cloneHelp": { en: "Clone your existing config repo.", zh: "克隆你已有的配置仓库。" },
  "onboard.repo.cloneUrl": { en: "Clone URL — git@github.com:you/dotfiles.git", zh: "克隆 URL —— git@github.com:you/dotfiles.git" },
  "onboard.repo.cloneBtn": { en: "Clone", zh: "克隆" },
  "onboard.repo.errNoUrl": { en: "Enter a clone URL.", zh: "请输入克隆 URL。" },
  "onboard.repo.cloneFailed": { en: "Clone failed.", zh: "克隆失败。" },
  "onboard.repo.created": { en: "Repo created.", zh: "仓库已创建。" },
  "onboard.repo.cloned": { en: "Repo cloned.", zh: "仓库已克隆。" },
  "onboard.select.help": { en: "Pick what to manage. We pre-selected what we found.", zh: "选择要管理的内容。我们已预选发现到的项目。" },
  "onboard.select.loading": { en: "Scanning…", zh: "扫描中…" },
  "onboard.select.found": { en: "found", zh: "项" },
  "onboard.select.secretNote": { en: "off by default · contains secrets", zh: "默认关闭 · 含密钥" },
  "onboard.select.confirm": { en: "Confirm selection", zh: "确认选择" },
  "onboard.select.added": { en: "Selection saved.", zh: "选择已保存。" },
  "onboard.capture.heading": { en: "Capture into your repo", zh: "备份到你的仓库" },
  "onboard.capture.help": { en: "These will be captured into your repo and committed.", zh: "以下内容将被备份到你的仓库并提交。" },
  "onboard.capture.btn": { en: "Capture & commit", zh: "备份并提交" },
  "onboard.capture.done": { en: "Captured.", zh: "已备份。" },
  "onboard.capture.empty": { en: "Nothing selected to capture.", zh: "没有可备份的选择。" },
  "onboard.push.heading": { en: "Push to your remote", zh: "推送到你的远端" },
  "onboard.push.ready": { en: "Ready to push to", zh: "准备推送到" },
  "onboard.push.btn": { en: "Push", zh: "推送" },
  "onboard.push.done": { en: "Pushed. You're all set.", zh: "已推送。设置完成。" },
  "onboard.push.failed": { en: "Push failed.", zh: "推送失败。" },
  "onboard.push.auth": { en: "Push needs credentials — run `git push` once in a terminal to authenticate, then retry.", zh: "推送需要凭据 —— 先在终端运行一次 `git push` 完成认证,再重试。" },
  "onboard.push.localOnly": { en: "You're local-only — add a remote to sync to other machines.", zh: "你目前仅本地 —— 添加远端即可同步到其他机器。" },
  "onboard.finish": { en: "Finish", zh: "完成" },
  "onboard.key.title": { en: "Back up your encryption key", zh: "备份你的加密密钥" },
  "onboard.key.body": { en: "An age key was generated. It is the ONLY thing that can decrypt your secrets — if you lose it, encrypted data is unrecoverable.", zh: "已生成 age 密钥。它是唯一能解密你密钥数据的东西 —— 一旦丢失,加密数据将无法恢复。" },
  "onboard.key.recipient": { en: "Recipient:", zh: "Recipient:" },
  "onboard.key.path": { en: "Key file:", zh: "密钥文件:" },
  "onboard.key.ack": { en: "I have backed up keys.txt offline", zh: "我已离线备份 keys.txt" },
  "onboard.key.continue": { en: "Continue", zh: "继续" },
  "onboard.remote.warning": { en: "Local-only — your backups won't reach another Mac until you set a remote.", zh: "仅本地 —— 在设置远端前,你的备份不会同步到另一台 Mac。" },
  "onboard.remote.set": { en: "Set remote", zh: "设置远端" },
  "onboard.remote.save": { en: "Save", zh: "保存" },
  "onboard.remote.placeholder": { en: "git@github.com:you/dotfiles.git", zh: "git@github.com:you/dotfiles.git" },
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @roost/web build`. Expected: PASS (object literal still valid).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/i18n/strings.ts
git commit -m "feat(web): onboard.* i18n strings (en + zh)"
```

---

### Task 5: `KeyBackupConfirm` modal

**Files:**
- Create: `packages/web/src/components/KeyBackupConfirm.tsx`
- Test: `packages/web/src/KeyBackupConfirm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KeyBackupConfirm } from "./components/KeyBackupConfirm";

const t = (k: string) => k;

describe("KeyBackupConfirm", () => {
  it("disables Continue until the checkbox is ticked, then calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(<KeyBackupConfirm recipient="age1abc" keyPath="/home/u/keys.txt" t={t} onConfirm={onConfirm} />);
    const btn = screen.getByRole("button", { name: "onboard.key.continue" });
    expect(btn).toBeDisabled();
    screen.getByRole("checkbox").click();
    expect(btn).not.toBeDisabled();
    btn.click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows the recipient and key path", () => {
    render(<KeyBackupConfirm recipient="age1xyz" keyPath="/k/keys.txt" t={t} onConfirm={() => {}} />);
    expect(screen.getByText("age1xyz")).toBeInTheDocument();
    expect(screen.getByText("/k/keys.txt")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- KeyBackupConfirm` → FAIL (module not found).

- [ ] **Step 3: Implement the component**

```tsx
import { useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)" };

export function KeyBackupConfirm({ recipient, keyPath, t, onConfirm }: {
  recipient: string | null;
  keyPath: string;
  t: (k: string) => string;
  onConfirm: () => void;
}) {
  const [acked, setAcked] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={t("onboard.key.title")} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div style={{ ...card, maxWidth: 460, width: "100%", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          <ShieldCheck size={18} weight="duotone" style={{ color: "var(--amber)" }} />
          {t("onboard.key.title")}
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 10px" }}>{t("onboard.key.body")}</p>
        <div style={{ fontSize: 12.5, marginBottom: 4 }}>
          <span style={{ color: "var(--muted)" }}>{t("onboard.key.recipient")} </span>
          <span className="mono" style={{ color: "var(--text)" }}>{recipient ?? "—"}</span>
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 12 }}>
          <span style={{ color: "var(--muted)" }}>{t("onboard.key.path")} </span>
          <span className="mono" style={{ color: "var(--text)", wordBreak: "break-all" }}>{keyPath}</span>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 14 }}>
          <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
          {t("onboard.key.ack")}
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onConfirm}
            disabled={!acked}
            style={{ padding: "7px 16px", borderRadius: "var(--rr)", border: 0, fontSize: 14, fontWeight: 560, cursor: acked ? "pointer" : "not-allowed", background: acked ? "var(--accent)" : "var(--raise)", color: acked ? "#0b0b0d" : "var(--muted)", opacity: acked ? 1 : 0.7 }}
          >
            {t("onboard.key.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- KeyBackupConfirm` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/KeyBackupConfirm.tsx packages/web/src/KeyBackupConfirm.test.tsx
git commit -m "feat(web): KeyBackupConfirm blocking modal"
```

---

### Task 6: `RemoteWarningBanner`

**Files:**
- Create: `packages/web/src/components/RemoteWarningBanner.tsx`
- Test: `packages/web/src/RemoteWarningBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RemoteWarningBanner } from "./components/RemoteWarningBanner";
import * as api from "./api";

vi.mock("./api", () => ({ setGitRemote: vi.fn().mockResolvedValue({ ok: true, remote: "git@x:y.git" }) }));
const t = (k: string) => k;

describe("RemoteWarningBanner", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reveals an input on Set, saves, and calls onConfigured", async () => {
    const onConfigured = vi.fn();
    render(<RemoteWarningBanner t={t} onConfigured={onConfigured} />);
    screen.getByRole("button", { name: "onboard.remote.set" }).click();
    const input = await screen.findByPlaceholderText("onboard.remote.placeholder");
    fireEvent.change(input, { target: { value: "git@x:y.git" } });
    screen.getByRole("button", { name: "onboard.remote.save" }).click();
    await waitFor(() => expect(api.setGitRemote).toHaveBeenCalledWith("git@x:y.git"));
    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- RemoteWarningBanner` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useState } from "react";
import { Warning } from "@phosphor-icons/react";
import { setGitRemote } from "../api";

export function RemoteWarningBanner({ t, onConfigured }: { t: (k: string) => string; onConfigured: () => void }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!url.trim()) return;
    setBusy(true); setErr(null);
    try { await setGitRemote(url.trim()); onConfigured(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const cta: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e" };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface)", border: "1px solid #4a3a1e", borderRadius: "var(--rc)", marginBottom: 14, fontSize: 13.5, flexWrap: "wrap" }}>
      <Warning size={16} weight="duotone" style={{ color: "var(--amber)", flexShrink: 0 }} />
      <span>{t("onboard.remote.warning")}</span>
      <span style={{ flex: 1 }} />
      {editing ? (
        <>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("onboard.remote.placeholder")} style={{ minWidth: 240, fontSize: 12.5, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)" }} />
          <button onClick={() => void save()} disabled={busy} style={cta}>{t("onboard.remote.save")}</button>
        </>
      ) : (
        <button onClick={() => setEditing(true)} style={cta}>{t("onboard.remote.set")}</button>
      )}
      {err && <span style={{ color: "var(--accent)", fontSize: 12, width: "100%" }}>{err}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- RemoteWarningBanner` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/RemoteWarningBanner.tsx packages/web/src/RemoteWarningBanner.test.tsx
git commit -m "feat(web): RemoteWarningBanner with inline set-remote"
```

---

### Task 7: Extend `Setup` with `embedded` + `onReady`

**Files:**
- Modify: `packages/web/src/views/Setup.tsx`
- Test: `packages/web/src/Setup.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Setup } from "./views/Setup";
import * as api from "./api";
import type { EnvCheck } from "./api";

vi.mock("./api", () => ({ getEnvironment: vi.fn(), postBrewInstall: vi.fn() }));

describe("Setup onReady", () => {
  beforeEach(() => vi.clearAllMocks());
  it("calls onReady(true) when all required checks pass", async () => {
    const checks: EnvCheck[] = [{ id: "git", ok: true, required: true }, { id: "age-key", ok: false, required: false }];
    vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
    const onReady = vi.fn();
    render(<Setup embedded onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(true));
  });
  it("calls onReady(false) when a required check fails", async () => {
    const checks: EnvCheck[] = [{ id: "git", ok: false, required: true }];
    vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
    const onReady = vi.fn();
    render(<Setup embedded onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(false));
  });
});
```

(If `EnvCheck` requires more fields than `{id, ok, required}`, add them per `api.ts`. Confirm the exact `EnvCheck` shape before writing the literal.)

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- Setup` → FAIL (`onReady` not called).

- [ ] **Step 3: Widen the props + fire `onReady`; gate the title on `embedded`**

Change the signature (line 27):
```tsx
export function Setup({ onOpenSettings, embedded, onReady }: { onOpenSettings?: () => void; embedded?: boolean; onReady?: (ready: boolean) => void } = {}) {
```
In `refresh`'s `.then` (lines 33-37), after `setChecks(d.checks)`:
```tsx
      .then((d) => {
        setChecks(d.checks);
        setError(null);
        onReady?.(d.checks.every((c) => !c.required || c.ok));
      })
```
Wrap the uppercase title block (the first inner `<div>` rendering `{t("setup.title")}`) so it hides when embedded:
```tsx
      {!embedded && (
        <div style={{ fontSize: 12.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600, marginBottom: 14 }}>
          {t("setup.title")}
        </div>
      )}
```
Add `onReady` to the `refresh` `useCallback` dependency array: `}, [onReady]);`

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- Setup` → PASS. Also re-run any existing Setup test if present.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Setup.tsx packages/web/src/Setup.test.tsx
git commit -m "feat(web): Setup embedded + onReady props for wizard reuse"
```

---

### Task 8: `StepRepo` (step 1)

**Files:**
- Create: `packages/web/src/views/onboarding/StepRepo.tsx`
- Test: `packages/web/src/StepRepo.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StepRepo } from "./views/onboarding/StepRepo";
import * as api from "./api";

vi.mock("./api", () => ({
  postInit: vi.fn().mockResolvedValue({ created: ["/r/roost"], isRepo: true, remote: null }),
  postClone: vi.fn().mockResolvedValue({ ok: true }),
}));
const t = (k: string) => k;

describe("StepRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create: calls postInit with the remote URL and advances", async () => {
    const onDone = vi.fn();
    render(<StepRepo t={t} onDone={onDone} />);
    fireEvent.change(screen.getByPlaceholderText("onboard.repo.remoteOptional"), { target: { value: "git@x:y.git" } });
    screen.getByRole("button", { name: "onboard.repo.createBtn" }).click();
    await waitFor(() => expect(api.postInit).toHaveBeenCalledWith("git@x:y.git"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("clone: shows the error and does NOT advance when postClone fails", async () => {
    vi.mocked(api.postClone).mockResolvedValueOnce({ ok: false, error: "destination exists" });
    const onDone = vi.fn();
    render(<StepRepo t={t} onDone={onDone} />);
    screen.getByRole("button", { name: "onboard.repo.cloneTab" }).click();
    fireEvent.change(screen.getByPlaceholderText("onboard.repo.cloneUrl"), { target: { value: "git@x:y.git" } });
    screen.getByRole("button", { name: "onboard.repo.cloneBtn" }).click();
    await waitFor(() => expect(screen.getByText("destination exists")).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- StepRepo` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useState } from "react";
import { postInit, postClone } from "../../api";
import type { HudMessage } from "../../components/Hud";

const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 13, padding: "7px 10px", borderRadius: 8, cursor: "pointer" };
const primary: React.CSSProperties = { ...ic, background: "var(--accent)", color: "#0b0b0d", borderColor: "var(--accent)", fontWeight: 600 };

export function StepRepo({ t, showHud, onDone }: { t: (k: string) => string; showHud?: (m: HudMessage) => void; onDone: () => void }) {
  const [mode, setMode] = useState<"create" | "clone">("create");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setErr(null);
    try { await postInit(remoteUrl.trim() || undefined); showHud?.({ text: t("onboard.repo.created"), type: "success" }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const clone = async () => {
    if (!cloneUrl.trim()) { setErr(t("onboard.repo.errNoUrl")); return; }
    setBusy(true); setErr(null);
    try {
      const r = await postClone(cloneUrl.trim());
      if (r.ok) { showHud?.({ text: t("onboard.repo.cloned"), type: "success" }); onDone(); }
      else setErr(r.error ?? t("onboard.repo.cloneFailed"));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const tab = (active: boolean): React.CSSProperties => ({ ...ic, fontWeight: active ? 600 : 400, borderColor: active ? "var(--accent)" : "var(--border)" });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setMode("create")} aria-pressed={mode === "create"} style={tab(mode === "create")}>{t("onboard.repo.createTab")}</button>
        <button onClick={() => setMode("clone")} aria-pressed={mode === "clone"} style={tab(mode === "clone")}>{t("onboard.repo.cloneTab")}</button>
      </div>

      {mode === "create" ? (
        <div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>{t("onboard.repo.createHelp")}</p>
          <input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder={t("onboard.repo.remoteOptional")} style={{ ...ic, width: "100%", marginBottom: 8 }} />
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 12px" }}>{t("onboard.repo.githubHint")}</p>
          <button onClick={() => void create()} disabled={busy} style={primary}>{busy ? "…" : t("onboard.repo.createBtn")}</button>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>{t("onboard.repo.cloneHelp")}</p>
          <input value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} placeholder={t("onboard.repo.cloneUrl")} style={{ ...ic, width: "100%", marginBottom: 12 }} />
          <button onClick={() => void clone()} disabled={busy} style={primary}>{busy ? "…" : t("onboard.repo.cloneBtn")}</button>
        </div>
      )}
      {err && <div style={{ color: "var(--accent)", fontSize: 12.5, marginTop: 10 }}>{err}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- StepRepo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/onboarding/StepRepo.tsx packages/web/src/StepRepo.test.tsx
git commit -m "feat(web): onboarding StepRepo (create / clone)"
```

---

### Task 9: `StepSelect` (step 3)

**Files:**
- Create: `packages/web/src/views/onboarding/StepSelect.tsx`
- Test: `packages/web/src/StepSelect.test.tsx`

Confirm `getDiscover()` return shape in `api.ts` (`{ candidates: Record<string, Candidate[]> }`) before writing; `Candidate` is re-exported from `./api`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StepSelect } from "./views/onboarding/StepSelect";
import * as api from "./api";

vi.mock("./api", () => ({
  getDiscover: vi.fn().mockResolvedValue({ candidates: {
    dotfiles: [{ id: "a", path: "~/.zshrc" }, { id: "b", path: "~/.vimrc" }],
    env: [{ id: "e1", path: "SECRET" }],
  } }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
}));
const t = (k: string) => k;

describe("StepSelect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pre-selects non-secret modules and adds their candidates on confirm", async () => {
    const onDone = vi.fn();
    render(<StepSelect t={t} onDone={onDone} />);
    await screen.findByText("dotfiles");
    screen.getByRole("button", { name: "onboard.select.confirm" }).click();
    await waitFor(() => {
      expect(api.addSelection).toHaveBeenCalledWith("dotfiles", "a");
      expect(api.addSelection).toHaveBeenCalledWith("dotfiles", "b");
    });
    expect(api.addSelection).not.toHaveBeenCalledWith("env", "e1");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- StepSelect` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from "react";
import { getDiscover, addSelection } from "../../api";
import type { Candidate } from "../../api";
import type { HudMessage } from "../../components/Hud";

const SECRET_MODULES = new Set(["env"]); // off by default; selecting one triggers lazy keygen at capture

export function StepSelect({ t, showHud, onDone }: { t: (k: string) => string; showHud?: (m: HudMessage) => void; onDone: () => void }) {
  const [groups, setGroups] = useState<Record<string, Candidate[]> | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getDiscover()
      .then((d) => {
        setGroups(d.candidates);
        setChosen(new Set(Object.entries(d.candidates).filter(([m, c]) => c.length > 0 && !SECRET_MODULES.has(m)).map(([m]) => m)));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const toggle = (m: string) => setChosen((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  const confirm = async () => {
    if (!groups) return;
    setBusy(true); setErr(null);
    try {
      for (const m of chosen) for (const c of groups[m] ?? []) await addSelection(m, c.id);
      showHud?.({ text: t("onboard.select.added"), type: "success" });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (err && !groups) return <div style={{ color: "var(--accent)", fontSize: 13 }}>{err}</div>;
  if (!groups) return <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("onboard.select.loading")}</div>;

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>{t("onboard.select.help")}</p>
      <div style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden", marginBottom: 12 }}>
        {Object.keys(groups).map((m) => (
          <label key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={chosen.has(m)} onChange={() => toggle(m)} />
            <span style={{ minWidth: 120, textTransform: "capitalize" }}>{m}</span>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{(groups[m] ?? []).length} {t("onboard.select.found")}</span>
            {SECRET_MODULES.has(m) && <span style={{ color: "var(--amber)", fontSize: 12 }}>{t("onboard.select.secretNote")}</span>}
          </label>
        ))}
      </div>
      {err && <div style={{ color: "var(--accent)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <button onClick={() => void confirm()} disabled={busy} style={{ appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: busy ? "default" : "pointer" }}>{busy ? "…" : t("onboard.select.confirm")}</button>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- StepSelect` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/onboarding/StepSelect.tsx packages/web/src/StepSelect.test.tsx
git commit -m "feat(web): onboarding StepSelect (discover + pre-select)"
```

---

### Task 10: `StepCapture` (step 4) — capture + lazy keygen guardrail

**Files:**
- Create: `packages/web/src/views/onboarding/StepCapture.tsx`
- Test: `packages/web/src/StepCapture.test.tsx`

Confirm `getSelection()` returns `{ schemaVersion; modules: Record<string, string[]> }` in `api.ts` before writing.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StepCapture } from "./views/onboarding/StepCapture";
import * as api from "./api";

vi.mock("./api", () => ({
  getSelection: vi.fn(),
  getKey: vi.fn(),
  generateKey: vi.fn(),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
}));
const t = (k: string) => k;

describe("StepCapture", () => {
  beforeEach(() => vi.clearAllMocks());

  it("captures directly when no secret module is selected", async () => {
    vi.mocked(api.getSelection).mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["a"] } });
    const onDone = vi.fn();
    render(<StepCapture t={t} onDone={onDone} />);
    (await screen.findByRole("button", { name: "onboard.capture.btn" })).click();
    await waitFor(() => expect(api.postCapture).toHaveBeenCalled());
    expect(api.generateKey).not.toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("generates a key and forces the backup modal before capturing when env is selected and no key exists", async () => {
    vi.mocked(api.getSelection).mockResolvedValue({ schemaVersion: 1, modules: { env: ["e1"] } });
    vi.mocked(api.getKey).mockResolvedValue({ exists: false, recipient: null, keyPath: "/k/keys.txt", encryptedFiles: 0 });
    vi.mocked(api.generateKey).mockResolvedValue({ created: true, source: "generated", recipient: "age1abc", keyPath: "/k/keys.txt" });
    const onDone = vi.fn();
    render(<StepCapture t={t} onDone={onDone} />);
    (await screen.findByRole("button", { name: "onboard.capture.btn" })).click();
    // backup modal appears; capture is NOT called until acked
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(api.generateKey).toHaveBeenCalled());
    expect(api.postCapture).not.toHaveBeenCalled();
    dialog.querySelector("input[type=checkbox]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    screen.getByRole("button", { name: "onboard.key.continue" }).click();
    await waitFor(() => expect(api.postCapture).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- StepCapture` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from "react";
import { getSelection, getKey, generateKey, postCapture } from "../../api";
import type { HudMessage } from "../../components/Hud";
import { KeyBackupConfirm } from "../../components/KeyBackupConfirm";

const SECRET_MODULES = new Set(["env"]);

export function StepCapture({ t, showHud, onDone }: { t: (k: string) => string; showHud?: (m: HudMessage) => void; onDone: () => void }) {
  const [modules, setModules] = useState<Record<string, string[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [keygen, setKeygen] = useState<{ recipient: string | null; keyPath: string } | null>(null);

  useEffect(() => {
    getSelection().then((s) => setModules(s.modules)).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const doCapture = async () => {
    setBusy(true); setErr(null);
    try {
      await postCapture();
      showHud?.({ text: t("onboard.capture.done"), type: "success" });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const onCaptureClick = async () => {
    const needsSecret = modules ? Object.entries(modules).some(([m, ids]) => SECRET_MODULES.has(m) && ids.length > 0) : false;
    if (needsSecret) {
      setBusy(true);
      try {
        const k = await getKey();
        if (!k.exists) {
          const gen = await generateKey();
          setKeygen({ recipient: gen.recipient, keyPath: gen.keyPath });
          setBusy(false);
          return; // wait for backup ack → doCapture
        }
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); return; }
      setBusy(false);
    }
    await doCapture();
  };

  const summary = modules ? Object.entries(modules).filter(([, ids]) => ids.length > 0) : [];

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>{t("onboard.capture.help")}</p>
      {modules === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>…</div>
      ) : summary.length === 0 ? (
        <div style={{ color: "var(--amber)", fontSize: 13, marginBottom: 12 }}>{t("onboard.capture.empty")}</div>
      ) : (
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden", marginBottom: 12 }}>
          {summary.map(([m, ids]) => (
            <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13.5 }}>
              <span style={{ minWidth: 120, textTransform: "capitalize" }}>{m}</span>
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{ids.length} {t("onboard.select.found")}</span>
            </div>
          ))}
        </div>
      )}
      {err && <div style={{ color: "var(--accent)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <button onClick={() => void onCaptureClick()} disabled={busy || summary.length === 0} style={{ appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: busy ? "default" : "pointer", opacity: summary.length === 0 ? 0.6 : 1 }}>{busy ? "…" : t("onboard.capture.btn")}</button>

      {keygen && (
        <KeyBackupConfirm
          recipient={keygen.recipient}
          keyPath={keygen.keyPath}
          t={t}
          onConfirm={() => { setKeygen(null); void doCapture(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- StepCapture` → PASS. (If the checkbox-click via `dispatchEvent` is flaky, switch the test to `fireEvent.click(dialog.querySelector('input[type=checkbox]')!)`.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/onboarding/StepCapture.tsx packages/web/src/StepCapture.test.tsx
git commit -m "feat(web): onboarding StepCapture with lazy keygen guardrail"
```

---

### Task 11: `Onboarding` shell (step strip + steps 2 & 5 + flow)

**Files:**
- Create: `packages/web/src/views/onboarding/Onboarding.tsx`
- Test: `packages/web/src/Onboarding.test.tsx`

- [ ] **Step 1: Write the failing integration test** (drives the full happy path)

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Onboarding } from "./views/onboarding/Onboarding";
import * as api from "./api";
import type { EnvCheck } from "./api";

vi.mock("./api", () => ({
  getGitStatus: vi.fn().mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true }),
  postInit: vi.fn().mockResolvedValue({ created: [], isRepo: true, remote: "git@x:y.git" }),
  postClone: vi.fn(),
  getEnvironment: vi.fn(),
  postBrewInstall: vi.fn(),
  getDiscover: vi.fn().mockResolvedValue({ candidates: { dotfiles: [{ id: "a", path: "~/.zshrc" }] } }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["a"] } }),
  getKey: vi.fn().mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k", encryptedFiles: 0 }),
  generateKey: vi.fn(),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
  gitPush: vi.fn().mockResolvedValue({ ok: true, output: "" }),
}));
const t = (k: string) => k;

describe("Onboarding flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const checks: EnvCheck[] = [{ id: "git", ok: true, required: true }];
    vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
  });

  it("walks repo → check → select → capture → push → onComplete", async () => {
    const onComplete = vi.fn();
    render(<Onboarding t={t} onComplete={onComplete} />);

    // Step 1 repo
    screen.getByRole("button", { name: "onboard.repo.createBtn" }).click();
    await waitFor(() => expect(api.postInit).toHaveBeenCalled());

    // Step 2 check → Next enabled once env ready
    const next = await screen.findByRole("button", { name: "onboard.next" });
    await waitFor(() => expect(next).not.toBeDisabled());
    next.click();

    // Step 3 select
    (await screen.findByRole("button", { name: "onboard.select.confirm" })).click();
    await waitFor(() => expect(api.addSelection).toHaveBeenCalledWith("dotfiles", "a"));

    // Step 4 capture
    (await screen.findByRole("button", { name: "onboard.capture.btn" })).click();
    await waitFor(() => expect(api.postCapture).toHaveBeenCalled());

    // Step 5 push
    (await screen.findByRole("button", { name: "onboard.push.btn" })).click();
    await waitFor(() => expect(api.gitPush).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- Onboarding` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from "react";
import { getGitStatus, gitPush } from "../../api";
import type { HudMessage } from "../../components/Hud";
import { Setup } from "../Setup";
import { StepRepo } from "./StepRepo";
import { StepSelect } from "./StepSelect";
import { StepCapture } from "./StepCapture";

const STEP_KEYS = ["onboard.step.repo", "onboard.step.check", "onboard.step.select", "onboard.step.capture", "onboard.step.push"];

export function Onboarding({ t, showHud, onComplete }: { t: (k: string) => string; showHud?: (m: HudMessage) => void; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [remote, setRemote] = useState<string | null>(null);
  const [envReady, setEnvReady] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);

  const refreshGit = () => { void getGitStatus().then((s) => setRemote(s.remote)).catch(() => {}); };
  useEffect(() => { refreshGit(); }, []);

  const push = async () => {
    setPushBusy(true); setPushErr(null);
    try {
      const r = await gitPush();
      if (r.ok) { showHud?.({ text: t("onboard.push.done"), type: "success" }); onComplete(); }
      else setPushErr(r.hint === "auth" ? t("onboard.push.auth") : r.output || t("onboard.push.failed"));
    } catch (e) { setPushErr(e instanceof Error ? e.message : String(e)); }
    finally { setPushBusy(false); }
  };

  const primary: React.CSSProperties = { appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ fontSize: 16, fontWeight: 600, margin: "8px 0 14px" }}>{t("onboard.title")}</div>

      {/* Step strip */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {STEP_KEYS.map((k, i) => (
          <span key={k} style={{ fontSize: 11.5, padding: "4px 11px", borderRadius: 20, background: i === step ? "var(--accent)" : i < step ? "var(--green)" : "var(--raise)", color: i === step ? "#fff" : i < step ? "#0b0b0d" : "var(--muted)" }}>
            {i + 1} · {t(k)}
          </span>
        ))}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", padding: 18 }}>
        {step === 0 && <StepRepo t={t} showHud={showHud} onDone={() => { refreshGit(); setStep(1); }} />}
        {step === 1 && (
          <div>
            <Setup embedded onReady={setEnvReady} />
            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setStep(2)} disabled={!envReady} style={{ ...primary, opacity: envReady ? 1 : 0.6, cursor: envReady ? "pointer" : "not-allowed" }}>{t("onboard.next")}</button>
            </div>
          </div>
        )}
        {step === 2 && <StepSelect t={t} showHud={showHud} onDone={() => setStep(3)} />}
        {step === 3 && <StepCapture t={t} showHud={showHud} onDone={() => setStep(4)} />}
        {step === 4 && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("onboard.push.heading")}</div>
            {remote ? (
              <>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>{t("onboard.push.ready")} <span className="mono" style={{ color: "var(--text)" }}>{remote}</span></p>
                <button onClick={() => void push()} disabled={pushBusy} style={primary}>{pushBusy ? "…" : t("onboard.push.btn")}</button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--amber)", margin: "0 0 12px" }}>{t("onboard.push.localOnly")}</p>
                <button onClick={onComplete} style={primary}>{t("onboard.finish")}</button>
              </>
            )}
            {pushErr && <div style={{ color: "var(--accent)", fontSize: 12.5, marginTop: 10 }}>{pushErr}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- Onboarding` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/onboarding/Onboarding.tsx packages/web/src/Onboarding.test.tsx
git commit -m "feat(web): Onboarding shell wiring the 5 steps"
```

---

### Task 12: Overview gate — render Onboarding / RemoteWarningBanner

**Files:**
- Modify: `packages/web/src/views/Overview.tsx`
- Test: `packages/web/src/OnboardingGate.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Overview } from "./views/Overview";
import * as api from "./api";
import type { EnvCheck } from "./api";

const noop = () => {};
function mockApi(git: { isRepo: boolean; remote: string | null }) {
  const checks: EnvCheck[] = [{ id: "git", ok: true, required: true }];
  vi.mocked(api.getGitStatus).mockResolvedValue({ ...git, branch: "main", ahead: 0, behind: 0, clean: true });
  vi.mocked(api.getHealth).mockResolvedValue({ ok: true, name: "mac", repoDir: "/r", ageKey: false });
  vi.mocked(api.getMachines).mockResolvedValue({ hosts: [], states: {} });
  vi.mocked(api.getStatus).mockResolvedValue({ reports: [] });
  vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
  vi.mocked(api.getDiscover).mockResolvedValue({ candidates: {} });
}

vi.mock("./api", () => ({
  getGitStatus: vi.fn(), getHealth: vi.fn(), getMachines: vi.fn(), getStatus: vi.fn(),
  getEnvironment: vi.fn(), getDiscover: vi.fn(), addSelection: vi.fn(), getSelection: vi.fn(),
  getKey: vi.fn(), generateKey: vi.fn(), postCapture: vi.fn(), gitPush: vi.fn(), postInit: vi.fn(),
  postClone: vi.fn(), postBrewInstall: vi.fn(), setGitRemote: vi.fn(),
}));

describe("Overview onboarding gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the onboarding repo step when there is no repo", async () => {
    mockApi({ isRepo: false, remote: null });
    render(<Overview showHud={noop} />);
    expect(await screen.findByRole("button", { name: "onboard.repo.createBtn" })).toBeInTheDocument();
  });

  it("renders the remote warning when repo exists but has no remote", async () => {
    mockApi({ isRepo: true, remote: null });
    render(<Overview showHud={noop} />);
    expect(await screen.findByText("onboard.remote.warning")).toBeInTheDocument();
  });

  it("renders the normal dashboard (capture button) when repo + remote present", async () => {
    mockApi({ isRepo: true, remote: "git@x:y.git" });
    render(<Overview showHud={noop} />);
    expect(await screen.findByText("overview.capture")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- OnboardingGate` → FAIL.

- [ ] **Step 3: Wire the gate into Overview.tsx**

Add imports (top of file):
```tsx
import { getGitStatus } from "../api";
import type { GitStatus } from "../api";
import { Onboarding } from "./onboarding/Onboarding";
import { RemoteWarningBanner } from "../components/RemoteWarningBanner";
```
Add state (with the other `useState`s, ~line 99):
```tsx
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
```
Add `getGitStatus()` to the `Promise.allSettled` in `fetchData` (line 106-111) and handle it:
```tsx
      const [h, m, s, env, git] = await Promise.allSettled([
        getHealth(),
        getMachines(),
        getStatus(),
        getEnvironment(),
        getGitStatus(),
      ]);
      if (h.status === "fulfilled") setHealth(h.value);
      if (m.status === "fulfilled") setMachines(m.value);
      if (s.status === "fulfilled") setStatusData(s.value);
      if (env.status === "fulfilled") {
        setMissingDeps(env.value.checks.filter((c) => c.required && !c.ok).map((c) => c.id));
      }
      if (git.status === "fulfilled") setGitStatus(git.value);
```
At the very top of the `return (` block (line 200), before the existing `<div>`, add the gate (early return for no-repo; banner otherwise). Replace:
```tsx
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
```
with:
```tsx
  if (gitStatus && !gitStatus.isRepo) {
    return <Onboarding t={t} showHud={showHud} onComplete={() => void fetchData()} />;
  }

  const noRemote = !!gitStatus?.isRepo && gitStatus.remote === null;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      {noRemote && <RemoteWarningBanner t={t} onConfigured={() => void fetchData()} />}
```

(`t` and `showHud` are already in scope in Overview — `const { t } = useT();` at line 89 and the `showHud` prop.)

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- OnboardingGate` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Overview.tsx packages/web/src/OnboardingGate.test.tsx
git commit -m "feat(web): Overview gates to Onboarding / remote warning on git status"
```

---

### Task 13: Settings — KeyBackupConfirm after generate / rotate

**Files:**
- Modify: `packages/web/src/views/Settings.tsx`
- Test: `packages/web/src/SettingsKeyBackup.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Settings } from "./views/Settings";
import * as api from "./api";

vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "mac", repoDir: "/r", ageKey: false }),
  getModules: vi.fn().mockResolvedValue({ modules: [] }),
  getGitStatus: vi.fn().mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true }),
  gitPush: vi.fn(), gitPull: vi.fn(),
  getKey: vi.fn().mockResolvedValue({ exists: false, recipient: null, keyPath: "/k/keys.txt", encryptedFiles: 0 }),
  generateKey: vi.fn().mockResolvedValue({ created: true, source: "generated", recipient: "age1abc", keyPath: "/k/keys.txt" }),
  rotateKey: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ maxCaptureMB: 5 }),
  saveSettings: vi.fn(),
}));

describe("Settings key backup", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows the blocking backup modal after generating a key", async () => {
    render(<Settings />);
    (await screen.findByRole("button", { name: "settings.key.generate" })).click();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "onboard.key.continue" })).toBeDisabled();
  });
});
```
(Add `within` to the testing-library import. If the existing `Settings` test file already mocks `./api`, extend it instead of creating a second mock of the same module.)

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @roost/web test -- SettingsKeyBackup` → FAIL.

- [ ] **Step 3: Wire KeyBackupConfirm into Settings.tsx**

Add import:
```tsx
import { KeyBackupConfirm } from "../components/KeyBackupConfirm";
```
Add state (near the key state, line 24-26):
```tsx
  const [keyBackup, setKeyBackup] = useState<{ recipient: string | null; keyPath: string } | null>(null);
```
In `handleGenerateKey`, after a successful `created` generate (inside the `try`, after `setKeyResult(...)`):
```tsx
      if (r.created) setKeyBackup({ recipient: r.recipient, keyPath: r.keyPath });
```
In `handleRotateKey`, after a successful swap (`r.swapped`):
```tsx
      if (r.swapped) setKeyBackup({ recipient: r.recipient, keyPath: keyStatus?.keyPath ?? "" });
```
Render the modal near the end of the returned JSX (e.g. just before the component's closing tag):
```tsx
      {keyBackup && (
        <KeyBackupConfirm
          recipient={keyBackup.recipient}
          keyPath={keyBackup.keyPath}
          t={t}
          onConfirm={() => setKeyBackup(null)}
        />
      )}
```
(`t` is in scope via `const { t } = useT();`. Confirm `KeyRotateResult` has `recipient` — it does.)

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @roost/web test -- SettingsKeyBackup` → PASS. Re-run any existing Settings test to confirm still green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Settings.tsx packages/web/src/SettingsKeyBackup.test.tsx
git commit -m "feat(web): Settings forces key-backup confirm after generate/rotate"
```

---

### Task 14: Full verification + desktop rebuild

**Files:** none (verification only)

- [ ] **Step 1: Full build** — `pnpm -r build`. Expected: all packages build, no TS errors.
- [ ] **Step 2: Lint** — `pnpm lint`. Expected: clean (no `no-explicit-any`, no unused).
- [ ] **Step 3: Full test suite (core/cli/shared)** — `npx vitest run` (from root) or `pnpm test`. Expected: all green, including the new server tests.
- [ ] **Step 4: Full web tests** — `pnpm --filter @roost/web test`. Expected: all green (existing + 8 new test files).
- [ ] **Step 5: Desktop rebuild sanity** — `pnpm build:desktop`. Expected: sidecar + Tauri app build succeed.
- [ ] **Step 6: Commit any incidental fixes** discovered during verification (only if needed).

```bash
# only if Step 6 produced changes:
git add -p
git commit -m "fix: address issues found during onboarding verification"
```

---

## Self-Review

**1. Spec coverage:**
- First-run detection & soft gate → Task 12 (Overview gates on `git/status.isRepo`; renders Onboarding). ✓ (Note: other-tab action-guarding is intentionally minimal — the primary gate is Overview→Onboarding; full per-tab disabling is deferred to keep v1 focused. Flag for review.)
- 5 steps: repo → Task 8; check → Task 7 (+ Task 11 wiring); select → Task 9; capture → Task 10; push → Task 11. ✓
- New endpoints `/api/init`, `/api/clone`, `/api/git/remote` → Tasks 1, 2. ✓
- Age-key backup blocking modal → Task 5, wired in Task 10 (wizard) + Task 13 (Settings). ✓
- Remote-not-configured banner → Task 6, wired in Task 12. ✓
- i18n `onboard.*` → Task 4. ✓
- No core change / no ADR → honored (only server/web touched). ✓
- Testing (server endpoints, web components, i18n) → each task is TDD; Task 14 full-suite. ✓
- Deferred scope (arbitrary local path; web `--github`) → not implemented, consistent with spec. ✓

**2. Placeholder scan:** No "TBD/handle errors/similar to". Three "confirm the exact shape" notes (EnvCheck, getDiscover, getSelection return types) are concrete pre-write verifications against existing `api.ts`, not code placeholders.

**3. Type consistency:** `InitResult/CloneResult/RemoteResult` defined in Task 3 and used in Tasks 8, 11, 6/12. `KeyBackupConfirm` props identical in Tasks 5, 10, 13. `SECRET_MODULES = new Set(["env"])` identical in Tasks 9, 10. `onReady`/`embedded` defined in Task 7 and consumed in Task 11. Step `onDone`/`onComplete` callback names consistent across Tasks 8–12.

**Spec refinement noted:** The spec described step-4 capture as returning a "dry-run preview"; the real `POST /api/capture` writes+commits (capture is the safe machine→repo direction — reversible via git, never touches system state). The plan therefore shows a **selection summary** as the pre-capture preview and an explicit user click to capture+commit, which honors the intent of I7 without inventing an endpoint. This is a faithful refinement, not a scope change.
