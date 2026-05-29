# Roost P0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Roost 的工程地基:pnpm monorepo + 共享类型与 `SyncModule` 接口 + 唯一外部出口 `exec` 适配器 + 模块注册表 + 脱敏日志 + i18n + CLI 骨架 + CI(含 macOS runner)+ OSS 骨架。

**Architecture:** 严格单向分层 UI(cli)→ core → adapters → external(architecture.md §2)。core 不含领域逻辑;能力以 `SyncModule` 插入(I4)。所有外部命令经 `exec` 适配器(I3)。本阶段不实现任何真实模块,只用一个 no-op 示例模块验证装配。

**Tech Stack:** TypeScript(strict)· pnpm workspace · tsup(build)· vitest(test)· ESLint(typescript-eslint)+ Prettier · execa(进程)· commander(CLI)。Node LTS。

**约束**:不得偏离 `docs/superpowers/specs/2026-05-30-roost-architecture.md`(LOCKED)。偏离须开 ADR。

---

### Task 1: 仓库与 pnpm workspace 初始化

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.editorconfig`, `.nvmrc`

- [ ] **Step 1: 初始化 git 与分支(若尚未)**

```bash
cd ~/MacMove
git rev-parse --is-inside-work-tree 2>/dev/null || git init
git checkout -b feat_p0_foundation 2>/dev/null || git switch feat_p0_foundation
```

- [ ] **Step 2: 写 `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: 写根 `package.json`**

```json
{
  "name": "roost",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "eslint": "^9.12.0",
    "prettier": "^3.3.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.8.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: 写 `.nvmrc`、`.editorconfig`、`.gitignore`**

`.nvmrc`:
```
20
```
`.editorconfig`:
```
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
insert_final_newline = true
trim_trailing_whitespace = true
```
`.gitignore`:
```
node_modules/
dist/
coverage/
*.log
.DS_Store
.env
*.age
keys.txt
```

- [ ] **Step 5: 安装并验证**

Run: `pnpm install`
Expected: 成功生成 `pnpm-lock.yaml`,无错误。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: init pnpm monorepo workspace"
```

---

### Task 2: 根 TypeScript / ESLint / Prettier / Vitest 配置

**Files:**
- Create: `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`

- [ ] **Step 1: 写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 2: 写根 `tsconfig.json`(项目引用占位)**

```json
{ "files": [], "references": [{ "path": "packages/shared" }, { "path": "packages/core" }, { "path": "packages/cli" }] }
```

- [ ] **Step 3: 写 `eslint.config.js`(flat config)**

```js
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "error" } }
);
```

- [ ] **Step 4: 写 `.prettierrc.json` 与 `vitest.config.ts`**

`.prettierrc.json`:
```json
{ "printWidth": 100, "singleQuote": false, "trailingComma": "all" }
```
`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["packages/**/*.test.ts"] } });
```

- [ ] **Step 5: 验证空跑**

Run: `pnpm lint && pnpm test`
Expected: lint 通过;vitest 报 "no test files found"(此时无测试,属正常)。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: add ts/eslint/prettier/vitest config"
```

---

### Task 3: `shared` 包 — 领域类型与 `SyncModule` 接口

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/types.ts`
- Test: `packages/shared/src/types.test.ts`

- [ ] **Step 1: 写 `packages/shared/package.json` 与 `tsconfig.json`**

`package.json`:
```json
{
  "name": "@roost/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsup src/index.ts --format esm --dts" }
}
```
`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "composite": true, "rootDir": "src" }, "include": ["src"] }
```

- [ ] **Step 2: 写失败测试 `types.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { RECOMMENDATIONS, isRecommendation } from "./index.js";

describe("shared types", () => {
  it("exposes recommendation kinds", () => {
    expect(RECOMMENDATIONS).toEqual(["track", "encrypt", "exclude"]);
  });
  it("validates recommendation", () => {
    expect(isRecommendation("track")).toBe(true);
    expect(isRecommendation("nope")).toBe(false);
  });
});
```

- [ ] **Step 2b: 运行,确认失败**

Run: `pnpm vitest run packages/shared`
Expected: FAIL（`./index.js` 未导出）。

- [ ] **Step 3: 写 `types.ts`（接口与运行时常量）**

```ts
// 与 architecture.md §4 的 SyncModule 契约保持一致。
export const RECOMMENDATIONS = ["track", "encrypt", "exclude"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export function isRecommendation(v: string): v is Recommendation {
  return (RECOMMENDATIONS as readonly string[]).includes(v);
}

export interface Logger { info(msg: string): void; warn(msg: string): void; error(msg: string): void; }
export interface ExecResult { code: number; stdout: string; stderr: string; }
export interface Exec { run(cmd: string, args: string[], opts?: { cwd?: string }): Promise<ExecResult>; }
export type Translate = (key: string, vars?: Record<string, string>) => string;

export interface ModuleContext {
  repoDir: string; home: string; profile: string; dryRun: boolean;
  log: Logger; exec: Exec; t: Translate;
}
export interface Selection { modules: Record<string, string[]>; } // module -> selected item ids

export interface Candidate {
  id: string; path: string; category: string; sizeBytes?: number;
  recommendation: Recommendation; note?: string;
}
export type DriftState = "synced" | "drift" | "conflict" | "untracked";
export interface DriftItem { id: string; state: DriftState; detail?: string; }
export interface DriftReport { module: string; items: DriftItem[]; }
export interface ChangeSet { module: string; written: string[]; encrypted: string[]; }
export type ApplyKind = "create" | "update" | "delete" | "skip";
export interface ApplyAction { id: string; kind: ApplyKind; target: string; backup?: string; }
export interface ApplyPlan { module: string; actions: ApplyAction[]; }
export interface ApplyResult { module: string; applied: string[]; backedUp: string[]; skipped: string[]; }
export interface Health { name: string; ok: boolean; detail?: string; }

export interface SyncModule {
  name: string;
  discover(ctx: ModuleContext): Promise<Candidate[]>;
  status(ctx: ModuleContext, sel: Selection): Promise<DriftReport>;
  capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet>;
  apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult>;
  diff(ctx: ModuleContext, sel: Selection): Promise<string>;
  unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult>;
  doctor(ctx: ModuleContext): Promise<Health[]>;
}
```

- [ ] **Step 4: 写 `index.ts`**

```ts
export * from "./types.js";
```

- [ ] **Step 5: 运行测试 + 构建**

Run: `pnpm vitest run packages/shared && pnpm --filter @roost/shared build`
Expected: PASS;`dist/` 产出 `.js` + `.d.ts`。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(shared): domain types and SyncModule contract"
```

---

### Task 4: `core` — exec 适配器(唯一外部命令出口,I3)

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/exec.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/exec.test.ts`

- [ ] **Step 1: 写 `core` 的 `package.json` / `tsconfig.json`**

`package.json`:
```json
{
  "name": "@roost/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": { "@roost/shared": "workspace:*", "execa": "^9.4.0" },
  "scripts": { "build": "tsup src/index.ts --format esm --dts" }
}
```
`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "composite": true, "rootDir": "src" }, "references": [{ "path": "../shared" }], "include": ["src"] }
```
然后 `pnpm install`。

- [ ] **Step 2: 写失败测试 `exec.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createExec } from "./exec.js";

describe("exec adapter", () => {
  it("runs a command and captures stdout/code", async () => {
    const exec = createExec();
    const r = await exec.run("printf", ["hi"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("hi");
  });
  it("captures non-zero exit without throwing", async () => {
    const exec = createExec();
    const r = await exec.run("bash", ["-c", "exit 3"]);
    expect(r.code).toBe(3);
  });
});
```

- [ ] **Step 2b: 运行确认失败**

Run: `pnpm vitest run packages/core`
Expected: FAIL（`createExec` 未定义）。

- [ ] **Step 3: 写 `exec.ts`**

```ts
import { execa } from "execa";
import type { Exec, ExecResult } from "@roost/shared";

export function createExec(): Exec {
  return {
    async run(cmd, args, opts): Promise<ExecResult> {
      const r = await execa(cmd, args, { cwd: opts?.cwd, reject: false });
      return { code: r.exitCode ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}
```

- [ ] **Step 4: 写 `index.ts` 并导出**

```ts
export { createExec } from "./exec.js";
```

- [ ] **Step 5: 运行测试**

Run: `pnpm vitest run packages/core`
Expected: PASS（两个用例)。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): exec adapter as sole external command gateway"
```

---

### Task 5: `core` — 脱敏日志(I6)

**Files:**
- Create: `packages/core/src/logger.ts`
- Test: `packages/core/src/logger.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试 `logger.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { createLogger } from "./logger.js";

describe("redacting logger", () => {
  it("masks token-like and key=value secrets", () => {
    const sink = vi.fn();
    const log = createLogger(sink);
    log.info("token=ghp_ABCDEF123456 done");
    log.info("Authorization: Bearer sk-supersecretvalue");
    expect(sink).toHaveBeenCalledWith("info", "token=*** done");
    expect(sink).toHaveBeenCalledWith("info", "Authorization: Bearer ***");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run packages/core`
Expected: FAIL（`createLogger` 未定义）。

- [ ] **Step 3: 写 `logger.ts`**

```ts
import type { Logger } from "@roost/shared";
type Sink = (level: "info" | "warn" | "error", msg: string) => void;

const PATTERNS: RegExp[] = [
  /([A-Za-z0-9_-]*(?:token|secret|key|passwd|password)\s*[=:]\s*)\S+/gi,
  /(Bearer\s+)\S+/gi,
  /(ghp_|sk-|xox[baprs]-)[A-Za-z0-9-]+/g,
];
export function redact(s: string): string {
  return PATTERNS.reduce((acc, re) => acc.replace(re, (_m, p1 = "") => `${p1}***`), s);
}
export function createLogger(sink: Sink = (l, m) => console[l === "info" ? "log" : l](m)): Logger {
  const emit = (lvl: "info" | "warn" | "error") => (msg: string) => sink(lvl, redact(msg));
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}
```

- [ ] **Step 4: 导出 + 运行测试**

在 `index.ts` 增 `export { createLogger, redact } from "./logger.js";`
Run: `pnpm vitest run packages/core`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): redacting logger (never log secret values)"
```

---

### Task 6: `core` — i18n(英文为主 + 中文)

**Files:**
- Create: `packages/core/src/i18n/index.ts`, `packages/core/src/i18n/en.ts`, `packages/core/src/i18n/zh.ts`
- Test: `packages/core/src/i18n/i18n.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试 `i18n.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createT } from "./index.js";

describe("i18n", () => {
  it("returns english by default and interpolates", () => {
    const t = createT("en");
    expect(t("captured", { n: "12" })).toBe("Captured 12 items");
  });
  it("falls back to key when missing", () => {
    const t = createT("zh");
    expect(t("nonexistent_key")).toBe("nonexistent_key");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run packages/core`
Expected: FAIL。

- [ ] **Step 3: 写 catalog 与 `createT`**

`en.ts`:
```ts
export const en: Record<string, string> = { captured: "Captured {n} items", doctor_ok: "All checks passed" };
```
`zh.ts`:
```ts
export const zh: Record<string, string> = { captured: "已备份 {n} 项", doctor_ok: "全部检查通过" };
```
`index.ts`:
```ts
import type { Translate } from "@roost/shared";
import { en } from "./en.js";
import { zh } from "./zh.js";
const CATALOGS: Record<string, Record<string, string>> = { en, zh };
export function createT(locale: string): Translate {
  const cat = CATALOGS[locale] ?? en;
  return (key, vars) => {
    const tmpl = cat[key] ?? en[key] ?? key;
    return tmpl.replace(/\{(\w+)\}/g, (_m, k) => vars?.[k] ?? `{${k}}`);
  };
}
```

- [ ] **Step 4: 导出 + 测试**

`packages/core/src/index.ts` 增 `export { createT } from "./i18n/index.js";`
Run: `pnpm vitest run packages/core`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): i18n with en default + zh"
```

---

### Task 7: `core` — ModuleRegistry + no-op 示例模块

**Files:**
- Create: `packages/core/src/registry.ts`, `packages/core/src/modules/example.ts`
- Test: `packages/core/src/registry.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试 `registry.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ModuleRegistry } from "./registry.js";
import { exampleModule } from "./modules/example.js";

describe("ModuleRegistry", () => {
  it("registers and lists modules; rejects duplicates", () => {
    const r = new ModuleRegistry();
    r.register(exampleModule);
    expect(r.list().map((m) => m.name)).toEqual(["example"]);
    expect(() => r.register(exampleModule)).toThrow(/already registered/);
  });
  it("get returns the module or undefined", () => {
    const r = new ModuleRegistry();
    r.register(exampleModule);
    expect(r.get("example")?.name).toBe("example");
    expect(r.get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run packages/core`
Expected: FAIL。

- [ ] **Step 3: 写 `registry.ts` 与 `modules/example.ts`**

`registry.ts`:
```ts
import type { SyncModule } from "@roost/shared";
export class ModuleRegistry {
  private mods = new Map<string, SyncModule>();
  register(m: SyncModule): void {
    if (this.mods.has(m.name)) throw new Error(`module already registered: ${m.name}`);
    this.mods.set(m.name, m);
  }
  get(name: string): SyncModule | undefined { return this.mods.get(name); }
  list(): SyncModule[] { return [...this.mods.values()]; }
}
```
`modules/example.ts`(验证接口装配,不做真实工作):
```ts
import type { SyncModule } from "@roost/shared";
export const exampleModule: SyncModule = {
  name: "example",
  async discover() { return []; },
  async status() { return { module: "example", items: [] }; },
  async capture() { return { module: "example", written: [], encrypted: [] }; },
  async apply() { return { module: "example", applied: [], backedUp: [], skipped: [] }; },
  async diff() { return ""; },
  async unmanage() { return { module: "example", applied: [], backedUp: [], skipped: [] }; },
  async doctor() { return [{ name: "example", ok: true }]; },
};
```

- [ ] **Step 4: 导出 + 测试**

`index.ts` 增:`export { ModuleRegistry } from "./registry.js"; export { exampleModule } from "./modules/example.js";`
Run: `pnpm vitest run packages/core && pnpm --filter @roost/core build`
Expected: PASS;构建产出 dist。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): module registry + no-op example module"
```

---

### Task 8: `cli` — commander 骨架(`--version` / `doctor`)

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/src/index.ts`, `packages/cli/src/doctor.ts`
- Test: `packages/cli/src/doctor.test.ts`

- [ ] **Step 1: 写 `cli` 的 `package.json` / `tsconfig.json`**

`package.json`:
```json
{
  "name": "@roost/cli",
  "version": "0.0.0",
  "type": "module",
  "bin": { "roost": "./dist/index.js" },
  "dependencies": { "@roost/core": "workspace:*", "@roost/shared": "workspace:*", "commander": "^12.1.0" },
  "scripts": { "build": "tsup src/index.ts --format esm" }
}
```
`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "composite": true, "rootDir": "src" }, "references": [{ "path": "../shared" }, { "path": "../core" }], "include": ["src"] }
```
然后 `pnpm install`。

- [ ] **Step 2: 写失败测试 `doctor.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { runDoctor } from "./doctor.js";
import { ModuleRegistry, exampleModule, createExec, createLogger, createT } from "@roost/core";

describe("doctor", () => {
  it("aggregates health from registered modules", async () => {
    const reg = new ModuleRegistry();
    reg.register(exampleModule);
    const ctx = { repoDir: "/tmp", home: "/tmp", profile: "base", dryRun: true, exec: createExec(), log: createLogger(() => {}), t: createT("en") };
    const health = await runDoctor(reg, ctx);
    expect(health).toEqual([{ name: "example", ok: true }]);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm vitest run packages/cli`
Expected: FAIL（`runDoctor` 未定义)。

- [ ] **Step 4: 写 `doctor.ts` 与 `index.ts`**

`doctor.ts`:
```ts
import type { ModuleContext, Health } from "@roost/shared";
import type { ModuleRegistry } from "@roost/core";
export async function runDoctor(reg: ModuleRegistry, ctx: ModuleContext): Promise<Health[]> {
  const out: Health[] = [];
  for (const m of reg.list()) out.push(...(await m.doctor(ctx)));
  return out;
}
```
`index.ts`:
```ts
#!/usr/bin/env node
import { Command } from "commander";
import { ModuleRegistry, exampleModule, createExec, createLogger, createT } from "@roost/core";
import { runDoctor } from "./doctor.js";

const program = new Command();
program.name("roost").description("Back up and migrate your Mac setup").version("0.0.0");
program.command("doctor").description("Check dependencies and module health").action(async () => {
  const reg = new ModuleRegistry();
  reg.register(exampleModule);
  const ctx = { repoDir: process.cwd(), home: process.env.HOME ?? "", profile: "base", dryRun: true, exec: createExec(), log: createLogger(), t: createT(process.env.ROOST_LOCALE ?? "en") };
  for (const h of await runDoctor(reg, ctx)) console.log(`${h.ok ? "ok " : "FAIL"} ${h.name}${h.detail ? " — " + h.detail : ""}`);
});
program.parseAsync();
```

- [ ] **Step 5: 测试 + 端到端冒烟**

Run: `pnpm vitest run packages/cli && pnpm -r build && node packages/cli/dist/index.js doctor`
Expected: 测试 PASS;命令打印 `ok example`。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(cli): commander skeleton with version and doctor"
```

---

### Task 9: CI(GitHub Actions,含 macOS runner)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 写 `ci.yml`**

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm -r build
      - run: pnpm test
```

- [ ] **Step 2: 本地预跑同等命令**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm -r build && pnpm test`
Expected: 全部通过(本地等价 CI)。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: lint/typecheck/build/test on ubuntu + macos"
```

---

### Task 10: OSS 骨架(LICENSE / README / SECURITY / CONTRIBUTING)

**Files:**
- Create: `LICENSE`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`

- [ ] **Step 1: 写 `LICENSE`(MIT)** — 标准 MIT 文本,年份 2026,作者占位 `Roost contributors`。

- [ ] **Step 2: 写 `README.md`(面向陌生人,精简)**

包含:一句话定位、安全/隐私承诺(数据只在你自己的私有 git 仓库、age 加密、无遥测)、`双仓库模型`一图、`brew`/`npm` 安装占位、`roost doctor` 上手、指向 `docs/`。

- [ ] **Step 3: 写 `SECURITY.md`** — 负责任披露邮箱/Issue 流程占位;声明 age key 为信任根、插件以完整权限运行(安装前需用户确认)。

- [ ] **Step 4: 写 `CONTRIBUTING.md`** — Conventional Commits、`feat_*` 分支、每模块三类测试(单元/dryRun/幂等)、改架构须 ADR(指向 `docs/adr/`)。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: OSS scaffolding (license, readme, security, contributing)"
```

---

### Task 11: P0 收尾验证

- [ ] **Step 1: 全量验证**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm -r build && pnpm test && node packages/cli/dist/index.js doctor`
Expected: 全绿;`doctor` 输出 `ok example`。

- [ ] **Step 2: 打 P0 里程碑标签**

```bash
git tag p0-foundation && git log --oneline | head
```

**P0 验收标准(全部满足才算完成):**
- `pnpm install && pnpm -r build && pnpm test` 在本地与 CI(ubuntu+macos)均通过。
- `roost doctor` 可运行并经 ModuleRegistry 聚合模块健康。
- 所有外部命令仅经 `exec` 适配器;日志对密钥脱敏;面向用户文案经 `t()`。
- 分层与包依赖方向符合 architecture.md §2–§3;无领域逻辑进 core。
