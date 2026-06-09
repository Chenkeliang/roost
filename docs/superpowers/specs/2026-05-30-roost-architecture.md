# Roost 架构与规则(LOCKED 基线)

- **状态**: LOCKED · 2026-05-30。本文件是**约束性基线**。对 §1–§12 的任何变更必须走 §13 变更控制(ADR),**禁止临时随意增改**。
- **配套**: `2026-05-30-roost-design.md`(产品/功能/分期)、`2026-05-30-roost-frontend.md`(视觉系统)。

## 1. 架构不变量(Invariants,最高约束,任何代码不得违反)
- **I1 薄编排**:core 绝不重实现 chezmoi/brew/age/mise 已有能力,只做选择、编排、可视化。
- **I2 单一事实源 + 无后端**:数据存用户自有 git 仓库;无服务器、无遥测、无云;数据不出本机/用户仓库。
- **I3 唯一外部出口**:所有外部命令经 `exec` 适配器;其它任何文件禁止直接 spawn/exec/联网。
- **I4 模块是唯一扩展点**:core 不含领域逻辑;新增能力 = 新模块,**不准往 core 加 if-else**。
- **I5 selection.yaml 唯一真相源**:"被管什么"只由它定义。
- **I6 密钥三禁**:不明文入库、不在 UI 显形、不进日志。
- **I7 可逆 apply**:覆盖前必先备份 + 默认 dry-run。
- **I8 零个人硬编码**:策展数据 = 可覆盖的数据文件,产品出厂不含任何用户私有数据。
- **I9 v1 仅 macOS**:不为跨平台预埋分支。
- **I10 失败安全**:任何写操作失败可回滚到操作前状态。

## 2. 分层与依赖方向(单向,禁跨层)
```
UI(cli / web)  →  core(编排)  →  adapters(exec 封装)  →  external(chezmoi/brew/age/mise/git/defaults)
```
- UI 不得直接触达 adapters/external,必须经 core。
- adapters 只翻译命令,不含业务决策。
- 依赖只能自上而下,禁反向、禁跨层。

## 3. 包边界(pnpm monorepo)
| 包 | 职责 | 依赖规则 |
|---|---|---|
| `core` | ModuleRegistry、Planner、组件、适配器、SyncModule 接口 | 不依赖 cli/web |
| `cli` | 命令 + 选择向导(TUI)+ 命令面板 | 依赖 core |
| `web` | 仪表盘 UI(React);P3 打包为 Tauri 桌面应用,Node 引擎作 sidecar(见 ADR-0002) | 依赖 core |
| `shared` | **纯类型**,无逻辑 | 谁都可依赖 |
规则:**无物依赖 cli/web**;第三方插件只依赖 core 公共 API,禁 import core 内部。

## 4. 模块契约 SyncModule(扩展的核心约定)
```ts
interface SyncModule {
  name: string;
  discover(ctx): Promise<Candidate[]>;     // 扫描本机,产候选给用户勾选
  status(ctx, sel): Promise<DriftReport>;  // 机器 vs 仓库(纵向)+ 跨机(横向)
  capture(ctx, sel): Promise<ChangeSet>;   // 主力:选中项写入仓库(敏感走 Secret Pipeline)
  apply(ctx, plan): Promise<Result>;       // 从机:仓库→机器(必须支持 dryRun)
  diff(ctx, sel): Promise<Diff>;
  unmanage(ctx, sel): Promise<Result>;     // 停止纳管,可选还原
  doctor(ctx): Promise<Health[]>;          // 声明依赖/版本/前置
}
```
**模块必须遵守(违反即不合规)**:
- **M1** `apply` 幂等:重复执行无副作用。
- **M2** 必须支持 `dryRun`:dryRun 下零写入,只产计划。
- **M3** 不得自行碰密钥:敏感数据一律交 Secret Pipeline。
- **M4** `discover` 必须过滤噪音 + 体积守卫:不得吐缓存/超大目录/state。
- **M5** `doctor` 必须声明依赖与版本要求。
- **M6** 不得绕过 `exec` 适配器、不得直接联网。
- **M7** `capture` 写库前必经 Secret Scanner。

## 5. core 组件职责(单一职责 + 边界)
| 组件 | 是什么 | 禁什么 |
|---|---|---|
| Discovery Engine | 扫描+分类+噪音/体积/bundle-id/密钥探测 | 不写盘 |
| Selection Store | `selection.yaml` 读写校验 | 不做发现 |
| Secret Pipeline + Scanner | 分类→加密→注入 + 明文拦截 | 不显/不记密钥值 |
| Snapshot & State | `state/<host>.json` + git 快照封装 | 不改业务文件 |
| Profile Resolver | base + 机器画像覆盖解析 | 无副作用 |
| Preset Catalog | 预设(数据)加载 | 不硬编码个人数据 |
| Importer Framework | 统一导入接口 | 不绕 Selection Store |
| Plugin Loader | 发现/校验/注册 `roost-*` 插件 | 不授越权能力 |
| Machine Registry | 机器与角色登记 | 不联网 |
| Planner | 把 selection+状态算成可执行/可预览计划 | 不直接执行 |
| exec adapter | 唯一外部命令出口(mock/日志/dryRun) | 不做业务决策 |

## 6. 数据契约(仓库文件 = 模块间唯一耦合面)
| 文件 | 拥有者 | 作用 | 备注 |
|---|---|---|---|
| `roost/selection.yaml` | Selection Store | 被管对象(类别/文件/app/域/项目) | 真相源 |
| `roost/Brewfile` | packages | 软件清单 | `brew bundle` |
| `roost/projects.yaml` | projects | 仓库清单 + envTool | — |
| `roost/appconfig.yaml` | appconfig | 已纳管偏好域 | P2 |
| `roost/profiles.yaml` | Profile Resolver | base/personal/primary/follower 差异 | — |
| `state/<host>.json` | Snapshot&State | 各机状态快照(喂漂移/时间线) | 每机一份 |
规则:**文件即契约**;每个文件带 `schemaVersion`;schema 变更须 ADR。

## 7. 扩展规则(六类扩展点 + 契约 = "扩展规范")
| 扩展点 | 命名 | 契约 |
|---|---|---|
| 模块插件 | `roost-module-<name>` | 导出实现 `SyncModule` 的工厂 + manifest(name/version/deps/schemaVersion);经 Plugin Loader 注册 |
| 密钥后端 | `roost-secret-<name>` | 实现 `SecretBackend`(get/list,只读注入) |
| 导入器 | `roost-import-<name>` | 实现 `Importer`(detect → 产 selection) |
| 预设包 | `roost-preset-<name>` | **纯数据**(selection 片段),无代码 |
| 发现源 | `roost-discover-<name>` | 向 Discovery 追加候选 |
| Hooks | 仓库内 `hooks/{pre,post}-{capture,apply}` | 经 exec 适配器跑,沙箱化,默认不注入密钥环境 |
通用:SemVer;声明兼容的 core API 版本 + schemaVersion;**插件只走公共 API,不得越权**(不能绕 exec/Secret Pipeline)。

## 8. 工程规则(binding)
TS strict;ESLint + Prettier;Conventional Commits;分支 `feat_*`(禁直推 `main`/共享分支);**每模块必须有 单元 + dryRun + 幂等 三类测试**;core 禁联网;统一错误约定;日志脱敏(I6);外部命令一律经 exec 适配器(便于 mock)。

## 9. 安全规则(binding)
密钥两层(密码管理器托管 age key + sops/age 加密入库);**Secret Scanner 是 capture 硬门**,检出明文即阻断;age key 设恢复码、提示离线备份;无遥测;最小权限;UI/日志永不显密钥值。

## 10. macOS 规则(binding,5 条硬约束)
1. 绝不 symlink plist。2. 偏好用 `defaults export/import`(非拷文件)。3. apply 区分 bootstrap(可直拷)/ runtime(先退 app 再 import)。4. mas 仅装"已购",CLI 装不了的标"需手动"。5. 改默认 app(UTI)需用户确认,不静默。

## 11. 范围冻结(Frozen Scope)
- **IN**:`design.md §14` 的 P1/P2/P3 全部已列功能。
- **OUT(明确不做,除非 ADR 解冻)**:多仓库/团队多租户、云账号/同步服务、非 git 传输(S3/Syncthing)、Linux/Windows、core 内置定时器(改用文档化 launchd 配方)、文件内子片段 diff、移动端、营销级动效/自定义鼠标。
- 规则:**未列入 IN 的一律视为 OUT**。

## 12. 变更控制(防"随意改动"的机制)
- 对 §1–§11 / 范围 / schema 的任何变更,**必须新增 ADR**:`docs/adr/NNNN-标题.md`,写明:背景、决定、触及的不变量、影响、替代方案。
- **无 ADR 不改架构**;新功能必须落到某模块或经 §7 扩展点新增模块,**不准改 core 加分支**。
- 纯实现细节(不触 §1–§11)无需 ADR。
- 本基线一经接受即冻结;助手在后续会**主动质疑/拒绝**任何绕过本规则的临时增改。

### ADR 模板
```
# ADR-NNNN: <标题>
- 状态: 提议 / 接受 / 替代
- 日期:
- 背景: 为什么需要这个变更
- 决定: 具体改什么
- 触及不变量: I? / 范围 / schema
- 影响: 对模块/数据/UI 的连锁
- 替代方案: 考虑过什么、为何不选
```

## 13. 锁定决策表(= ADR-0001 接受)
| 决策 | 选定 | 理由 |
|---|---|---|
| 底座 | chezmoi | 最成熟,git/age/模板原生 |
| 密钥 | age + sops,key 托管 1Password/rbw | 消除手工带 key 的单点 |
| 拓扑 | 单一 git 源,主力→从机 | 简单、几乎无冲突 |
| 语言 | TypeScript + pnpm | 团队熟、前后端共享类型 |
| CLI | commander | 引擎核心,可脚本化/无头/bootstrap |
| GUI(P3) | Tauri 桌面应用 + Node 引擎 sidecar(React+Vite UI);`roost serve` 浏览器模式为回退 | 原生 Mac 体感 + 复用 TS/React;见 ADR-0002 |
| per-project env | mise | 一工具统管版本/env/任务 |
| 幂等 | chezmoi `run_onchange_` | 不在 TS 重造 |
| 强调色 / 字体 | Raycast 珊瑚红 / Geist(SF Pro 可选) | 用户偏好 Raycast 语言 |
| 图标 | Phosphor + 圆角方形彩色 tile | 贴 Raycast |
| 动效基调 | 克制 snappy(Variance3/Motion4/Density5) | 安全工具,不浮夸 |
| License | MIT | 最大化采纳 |
