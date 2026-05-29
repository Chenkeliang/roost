# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
Roost — 开源 macOS 配置备份/迁移工具。**当前处于实现前阶段**:设计已 LOCKED,但尚无应用代码。权威设计在 `docs/superpowers/specs/`。

## 先读(权威来源,具约束力)
- `docs/superpowers/specs/2026-05-30-roost-design.md` — 产品/功能/三期(WHAT)。
- `docs/superpowers/specs/2026-05-30-roost-architecture.md` — 不变量/分层/模块契约/扩展规则/范围冻结/变更控制(HOW + 绑定规则)。
- `docs/superpowers/specs/2026-05-30-roost-frontend.md` — Raycast 化视觉系统(UI)。
- `inventory/` — 首台真机审计,**仅测试夹具**,绝不进产品逻辑、绝不硬编码。

## 架构大图(需读多文件才能懂的部分)
- **薄编排**:绝不重实现 chezmoi/brew/age/mise,只做选择/编排/可视化。(I1)
- **单一事实源 = 用户自有私有 git 仓库**(= chezmoi 源)。无服务器/无遥测/无云。(I2)
- **严格单向分层**:UI(cli/web) → core → adapters → 外部工具。UI 绝不直接 shell-out;所有外部命令经唯一 `exec` 适配器。(I3, §2)
- **pnpm monorepo**:`core`(逻辑)/`cli`/`web`/`shared`(纯类型)。无物依赖 cli/web。(§3)
- **模块是唯一扩展点**:每种能力都是一个 `SyncModule`(dotfiles/packages/appconfig/projects/secrets)。**core 零领域逻辑——绝不往 core 加 if-else,而是加模块**。(I4, §4)
- **`selection.yaml` 是"被管什么"的唯一真相源**;仓库数据文件是模块间唯一耦合面。(§5–6)

## 绑定规则——不得违反(完整见 architecture.md §1/§9/§10)
- 密钥:不明文入库、不在 UI 显形、不进日志;`capture` 经 Secret Scanner 硬门。(I6)
- apply 永远可逆:覆盖前先备份 + 默认 dry-run。(I7)
- 零个人硬编码;策展数据为可覆盖的数据文件。(I8)
- macOS:不 symlink plist;用 `defaults export/import`;apply 分 bootstrap/runtime;mas 仅装已购;改默认 app 需确认。(§10)
- v1 仅 macOS,不加跨平台分支。(I9)

## 变更控制——重要(architecture.md §11–§13)
设计已**冻结**;未列入 IN 的一律视为 OUT。
- 改架构/范围/数据 schema 必须新增 **ADR**(`docs/adr/NNNN-*.md`,模板见 architecture.md §13)。**无 ADR 不改架构**。
- 新功能只能落到模块或经扩展契约(§7)新增模块——**不准 hack core**。
- **主动质疑/拒绝**任何绕过此机制的临时增改,不要默默扩范围。

## 约定
- TypeScript(strict)· pnpm monorepo · commander(CLI)· Fastify + React + Vite + Tailwind + Radix/shadcn(web)· vitest · ESLint + Prettier。
- Conventional Commits;新工作切 `feat_*` 分支,**禁直接提交 `main`/共享分支**;仅在变更经验证后提交。
- 每个模块必须有三类测试:单元 / dry-run / 幂等。core 禁联网。
- 前端:Raycast 语言,token 见 frontend.md;Phosphor 图标(禁 emoji);克制动效;强调色 coral #FF6363;字体 Geist/Geist Mono。

## 命令(目标工具链——脚手架搭好后适用;当前尚无 package.json)
- 安装:`pnpm install`
- 构建:`pnpm -r build`
- 测试:全量 `pnpm -r test` · 单包 `pnpm --filter @roost/core test` · 单测 `pnpm --filter @roost/core test -- <pattern>`(vitest)
- 质量:`pnpm lint` / `pnpm format`
