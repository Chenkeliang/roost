# Roost 设计文档（Design Spec）

- **状态**: Draft（待用户评审）
- **日期**: 2026-05-30
- **一句话定位**: Roost 是一个开源的 macOS 配置备份与迁移工具——在主力机上**自选**要纳管的 dotfiles / 软件 / 应用配置 / 项目 / 密钥，安全存进你自己的 git 仓库，再在从机上一键**加载还原**，并提供**可视化管理**。
- **关键词**: 通用产品（非个人脚本）、选择式、单一 git 事实源、age 加密、可视化、可扩展。

---

## 1. 产品定位与目标用户

### 1.1 目标
- 面向**任意 macOS 用户**（开发者优先），把"换机/配双机"从几天的手工折腾,变成"主力机选 → 从机一键加载"。
- 用户**完全自主选择**备份什么（类别 / 具体文件 / app / 偏好域 / 项目），并能**可视化查看与管理**已备份内容。
- 数据主权在用户:配置存进**用户自己的私有 git 仓库**,密钥用**用户自己的 age key**,Roost **绝不回传任何数据**。

### 1.2 非目标（Non-goals）
- 不做云端托管/账号体系(无服务器,无 Roost 云)。
- 不做实时双向同步(本产品是"主力→从机"单向加载模型,见 §2)。
- 不做 Linux/Windows(v1 仅 macOS;架构不阻断未来扩展但不为此买单)。
- 不替用户保管密钥(只提供加密与注入机制)。

### 1.3 与同类的差异(护城河)
2025–2026 调研结论:无任何工具同时具备「macOS 场景」+「Web 可视化」+「跨机漂移」+「快照时间线回滚」。chezmoi 是 CLI 之王但永不 Web-first;mackup 注册表不全且踩 Sonoma symlink 坑。Roost 的差异化见 §11。

### 1.4 设计原则(贯穿全程,优先级高于任何单个功能)
1. **薄编排,不重造轮子**:能交给 chezmoi/brew/age/mise 的绝不自己实现;Roost 只做选择、编排、可视化。
2. **轻量优先,不过度设计**:只做已确认需求,不加投机特性、不为单次使用造抽象;每多一个组件都先问"能不能更薄"。
3. **安全默认**:load 默认 dry-run、覆盖前先备份、明文密钥零泄露。
4. **零个人硬编码**:已知数据以可覆盖的数据文件随产品发布。
5. **每期可独立交付且可验证**。

---

## 2. 核心概念与术语

| 概念 | 定义 |
|---|---|
| **产品(Roost)** | 通用引擎 + CLI + Web 仪表盘。出厂**零个人数据**,任何人安装即用。 |
| **配置仓库(Config Repo)** | 用户自己的私有 git 仓库 = 单一事实源 = chezmoi 源目录。存 dotfiles/清单/加密密钥。**不属于产品**。 |
| **主力机(Primary)** | 用户日常使用、做选择与 capture 的机器。 |
| **从机(Follower)** | 执行 load/apply、被还原成主力机状态的机器。 |
| **模块(Module)** | 一类可纳管对象的处理单元(dotfiles/packages/appconfig/projects/secrets),实现统一 `SyncModule` 接口。 |
| **Profile** | 机器画像(如 `base`→`personal`→`primary`/`follower`),用于跨机差异化。 |
| **拓扑** | 单一事实源、主力→从机单向加载(git-backed),几乎无冲突。 |

> 类比:**Roost 之于配置仓库 = git 之于代码仓库**。我们造工具,用户拥有数据。**产品代码内不得有任何用户专属硬编码**(路径/应用名/仓库地址一律运行时发现 + 用户选择)。

---

## 3. 关键设计决策

| 维度 | 决定 | 理由 |
|---|---|---|
| 底座 | **chezmoi** | 最成熟(19.9k★、高频发版);git 原生、age 加密、跨机模板皆原生。 |
| 加密 | **age + sops**;age 私钥**托管在密码管理器**(1Password / Bitwarden-rbw),bootstrap 时取出 | 消除"手工带私钥"的脆弱单点;免费用户用 rbw。 |
| 拓扑 | 单一 git 源、主力→从机单向 | 简单可靠、几乎无冲突。 |
| 语言 | **TypeScript**(Node LTS) | 团队熟悉;前后端共享类型;web 仪表盘生态成熟。 |
| per-project env | **mise**(`.mise.toml` 入库 + `.mise.local.toml` 本地机密) | 一工具统管版本/env/任务;内建 sops/age;社区主流。 |
| 幂等执行 | 委托 chezmoi `run_onchange_` 脚本(内容哈希) | 不在 TS 重造幂等;Brewfile/defaults 变更才重跑。 |
| 可视化 | CLI 选择向导 + 已备份清单(P1) → 富 Web 仪表盘(P3) | 选择与可见性第一天就在;大件后置。 |
| 开源 | 从 P1 即公开产品化(MIT) | "让每个人都能用"。MIT 最大化采纳;需专利条款则 Apache-2.0。 |

不变项已锁定,后续不再回头。

---

## 4. 系统架构

```
┌───────────────────────────────────────────────────────────────┐
│ 接口层   CLI(commander)  ·  Web 仪表盘(Fastify + React/Vite)    │
│          选择向导 / 已备份清单 / 状态 / 漂移 / 时间线           │
├───────────────────────────────────────────────────────────────┤
│ 编排核心 ModuleRegistry · 选择模型(Selection) · 计划器(plan)    │
│          · 状态&漂移(drift) · 快照(git 封装)                    │
├───────────────────────────────────────────────────────────────┤
│ 模块层   dotfiles │ packages │ appconfig │ projects │ secrets   │ ← 可插拔
├───────────────────────────────────────────────────────────────┤
│ 适配器层 chezmoi · brew/mas · git · age/sops · defaults/plutil  │
│          · mise · 密码管理器(op/rbw)            (统一 exec 封装) │
├───────────────────────────────────────────────────────────────┤
│ 数据     用户配置仓库(chezmoi 源)= dotfiles + 清单 + 加密密钥   │
└───────────────────────────────────────────────────────────────┘
```
产品只做**编排 + 选择 + 可视化**;脏活交给成熟 OSS(chezmoi/brew/age/mise),不重造轮子。

---

## 5. 组件与目录布局

### 5.1 工具(pnpm monorepo)
```
~/MacMove/
  packages/
    core/      # ModuleRegistry、Selection、计划器、适配器、SyncModule 接口
    cli/       # commander 命令 + 选择向导(TUI)
    web/       # React+Vite 仪表盘(由 core 的 Fastify 静态托管)
    shared/    # 前后端共享 TS 类型(端到端类型安全)
  docs/        # 设计/使用文档(本文件在此)
  inventory/   # 首个真实用户(开发者本机)盘点 = 测试夹具,不进产品逻辑
```

### 5.2 配置仓库布局(产品为用户初始化的结构)
```
<config-repo>/        # = chezmoi 源目录,用户私有 git
  home/               # chezmoi 管理的 dotfiles(dot_zshrc 等)
  encrypted/          # age 加密的密钥
  roost/
    selection.yaml    # 用户的“纳管选择”(类别/文件/app/域/项目)——可视化管理的真相源
    Brewfile          # 软件清单
    projects.yaml     # 项目仓库清单(repo→路径 + envTool)
    appconfig.yaml    # 已确认纳管的 app 偏好域(P2)
    profiles.yaml     # base/personal/primary/follower 差异
  .chezmoi.toml.tmpl  # age recipient、profile 变量
  run_onchange_*.sh.tmpl  # 幂等安装脚本(brew bundle / defaults / mise)
```
`selection.yaml` 是核心:它就是“用户选了什么备份”的声明,CLI 向导与 Web 清单视图都读写它。

### 5.3 核心组件(core 内,各自职责单一、可独立测试、均为薄封装)
- **Discovery Engine**:扫描器 + 分类器 + 噪音过滤/体积守卫/bundle-id 解析/密钥探测。上轮 inventory 的产品化,各模块 `discover()` 共用。
- **Selection Store**:`selection.yaml` 读写校验 =“已备份内容”真相源。
- **Secret Pipeline + Scanner**:分类→加密→注入,带提交前明文拦截。
- **Snapshot/State Service**:`state/<host>.json` + git 快照封装(喂时间线/跨机漂移)。
- **Profile Resolver**:base + 机器画像覆盖解析。
- **Preset Catalog / Importer Framework / Plugin Loader / Machine Registry**:见名知义。
- **exec adapter**:所有外部命令唯一出口(便于 mock/日志/dry-run)。

---

## 6. 模块系统与扩展（"如何扩展"）

每个模块实现统一接口;`ModuleRegistry` 注册即生效。第三方可发 `roost-module-*` npm 包扩展,**无需改核心**。

```ts
interface SyncModule {
  name: string;                               // 'dotfiles' | 'packages' | ...
  discover(ctx): Promise<Candidate[]>;        // 扫描本机,产出“可纳管候选”给用户勾选
  status(ctx, sel): Promise<DriftReport>;     // 机器 vs 仓库(纵向)；跨机(横向)
  capture(ctx, sel): Promise<ChangeSet>;      // 主力:把选中项写入仓库(敏感项 age 加密)
  apply(ctx, plan): Promise<Result>;          // 从机:把仓库状态加载到机器(支持 dryRun)
  diff(ctx, sel): Promise<Diff>;
  unmanage(ctx, sel): Promise<Result>;        // 停止纳管,可选还原为未管理态
  doctor(ctx): Promise<Health[]>;             // 依赖/前置体检
}
```
- `discover` 是产品化关键:让全新用户看到"本机有什么可备份",再勾选——而非预设。
- 内置模块:`dotfiles`、`packages`、`appconfig`、`projects`、`secrets`。
- 扩展 = 实现接口 + 注册;插件 API 与版本契约见 §13。

---

## 7. 核心工作流（功能）

1. **`roost init`**:初始化/连接用户的配置仓库;引导设置 age key(从密码管理器或新建);写 `.chezmoi.toml`。
2. **选择向导 `roost select`**(P1 核心):各模块 `discover` → TUI 勾选框,用户选**类别 → 具体文件/app/域/项目** → 落 `selection.yaml`。可反复增删。首次可选**预设(Recipes,如“开发者必备”)**避免从零勾选。
3. **`roost capture`**(主力):按 `selection.yaml` 把选中项写入仓库(文本入 git、敏感走 age)→ **提交前明文密钥扫描(疑似未加密即拦截)** → `git commit && push`。
4. **`roost load`/`sync`**(从机):`git pull` → 各模块 `apply`(chezmoi apply / brew bundle / clone 项目 / defaults import)→ 报告。**默认 dry-run 预览;覆盖前检测从机本地改动并先备份(可逆),支持逐项选择性 apply**。
5. **已备份清单 `roost list`**(P1):文本化展示当前纳管了什么、状态如何、可增删——"可视化管理已备份内容"的 P1 形态。
6. **`roost status` / `diff`**:纵向(机器 vs 仓库)+ 横向(主力 vs 从机)漂移。
7. **`roost serve`**(P3):Web 仪表盘(漂移/时间线/可视增删,见 §11)。
8. **`bootstrap.sh`**(新机一行,纯 bash 先于 Node):装 Homebrew → `brew install chezmoi age node mise` → 取 age key → clone 仓库 → `roost load`。
9. **`roost unmanage <项>`**:停止纳管某项,可选还原为未管理态。
10. **`roost import`**(P2):从已有 dotfiles 仓库 / mackup 迁入。

---

## 8. 数据流

- **主力**:`select`(选)→ `capture`(机器→仓库,加密)→ push。
- **从机**:`load`(pull → 仓库→机器,解密 → 幂等 apply)。
- **可见性**:每台机 `capture`/`load` 时写 `state/<hostname>.json`(已装包/文件 hash/域/项目状态)进仓库;仪表盘读两台机 state 算横向漂移,读本机实际 vs 仓库算纵向漂移。

---

## 9. 安全与隐私模型

- **两层密钥**:层1 密码管理器(1Password/rbw,生物解锁)托管 **age 私钥**;层2 sops+age 加密仓库内所有密钥/token/per-project 机密。
- **bootstrap**:`op read`/`rbw get` 取出 age 私钥到 `~/.config/sops/age/keys.txt`(chmod 600),随后 `chezmoi apply` 解密全部。用户只需记住一个主密码。
- **数据主权**:配置仓库是用户自己的(自托管 GitHub/GitLab 私有库均可);Roost 无服务器、无遥测、不回传。
- **防误提交**:`.gitignore` 双保险;capture 对敏感路径强制走加密通道;明文密钥进库直接拒绝。
- **密钥扫描**:capture/提交前 gitleaks 式扫描,拦截明文密钥误入库。
- **恢复与轮换**:age key 设恢复码并提示离线备份(P1);`roost key rotate` 一键 re-encrypt 轮换(P2)。

---

## 10. macOS 适配要点（调研挖出的 5 个硬坑,必须遵守）

| 坑 | 事实 | 对策 |
|---|---|---|
| Sonoma+ 禁 symlink 偏好 | 14+ 对 `~/Library/Preferences` symlink 不再透明,mackup link mode **静默损坏** | **绝不 symlink plist**;一律 `defaults export`→文本→git |
| cfprefsd 内存缓存 | 直接 cp/rsync 覆盖 .plist 会被缓存覆盖回去 | apply 走 `defaults import`/`write`(经 IPC) |
| bootstrap vs 运行时 | 新机 app 未运行可直拷;运行时不行 | apply 分两路:bootstrap 直拷 / 运行时 import 前先退该 app |
| mas 登录已死 | `mas signin` 永久失效,只能装"已购买" | Brewfile 增"需手动安装"标注;mas 仅装已购 |
| 默认 app 弹窗 | macOS 26.4+ 改默认 app 触发确认 | 默认 app 列为"建议项需确认",不全自动 |

---

## 11. 两个差异化特色功能

### 11.1 招牌:跨机漂移仪表盘 + 快照时间线回滚（P3）
- **跨机漂移**:左栏主力、右栏从机、中列文件级/值级 diff(内嵌 Monaco diff editor),数据来自仓库内两台机的 `state/<host>.json`。
- **时间线回滚**:配置仓库每次 sync 一个 git commit = 一个快照节点;点击 preview(chezmoi diff @rev)或一键 rollback(`git revert` + 重新 apply,带 dry-run 模态);可选 AI 单句摘要。
- UX 借鉴 Plakar(备份 Web UI)、FlowFuse(版本时间线 + 一键回滚)。

### 11.2 解"清单不全":App 配置录制模式 Learn Mode（P2）
- `roost app learn`:先快照全部 `defaults domains` → 提示用户去 GUI 改设置 → re-snapshot diff 出**变更的 domain/key** → `defaults export` 文本入库,用户确认命名。
- 纯 `defaults` CLI,不依赖固定注册表 → **任意 app(含小众/自研)都能纳管**;覆盖 `~/Library/Preferences`、`Containers/*/Data/.../Preferences`、`Group Containers/*`,按 bundle id 关联。

---

## 12. 语言 / 技术栈 / 工程规范

- **语言**:TypeScript(strict);Node LTS;包管理 **pnpm**(monorepo workspace)。
- **CLI**:commander;选择向导 TUI 用 `@clack/prompts` 或等价(勾选框/多选)。
- **Web**:后端 Fastify(API + 托管静态前端);前端 React + Vite(轻量,Monaco diff)。
- **构建/测试**:tsup/esbuild;vitest。
- **规范**:ESLint(typescript-eslint)+ Prettier;**Conventional Commits**;分支 `feat_*`(禁止直接提交 `main`/共享分支);**所有外部命令经统一 `exec` 适配器**(便于 mock/测试/日志/dry-run)。
- **分发**:`npm i -g roost`;Homebrew tap `roost/tap`;可选 `bun build --compile` 出单二进制。

---

## 13. 开源就绪（从 P1）

- **License**:MIT(默认;需专利条款则 Apache-2.0)。
- **README**:面向陌生人的"它是什么 / 装 / 30 秒上手 / 安全模型 / 隐私承诺"。
- **打包分发**:npm + Homebrew tap;`bootstrap.sh` 一行装。
- **贡献**:`CONTRIBUTING.md`、`SyncModule` 插件 API 文档 + 示例模块、SemVer、CHANGELOG、CI(lint/test/typecheck)。
- **扩展位**:模块插件 `roost-module-*`、密钥后端插件、导入器、预设包、capture/apply 前后 **hooks**;加载契约 = npm 包名约定 + 注册清单。
- **零个人硬编码**:任何 curated 数据(如已知 app 路径表)以**数据文件**形式随产品发布且用户可覆盖,绝不写死某用户。

---

## 14. 功能范围与分期（每期可用 + 验收标准）

- **P1 核心(公开产品化)**:`init` + **选择向导 `select`(含预设)** + dotfiles/packages/projects/secrets + age 密钥(密码管理器托管 + 恢复码)+ `capture`(提交前密钥扫描)/`load`(**覆盖前备份 + 本地改动检测 + 逐项 dry-run**)/`status`/`diff`/`unmanage`/`doctor` + **已备份清单 `list`** + **Profiles(base + 机器画像)** + `bootstrap.sh` + 开源骨架(MIT/README/打包/CI)。
  - ✅验收:**一个全新用户**(非作者)在主力机选若干项 → push;从机一行 bootstrap 从零到可用,敏感项加密往返正确;`list` 能看到并增删纳管项;全程明文密钥零泄露;load 覆盖前有备份可回退。
- **P2 App 配置 + 迁入**:通用发现 + Learn Mode 录制 + cfprefsd 安全 apply;**导入器(dotfiles/mackup)、密钥轮换 `key rotate`、审计视图**。
  - ✅验收:纳管一个 mackup **不认识**的本地 app 并在另一台还原。
- **P3 Web 仪表盘**:跨机漂移 + 快照时间线回滚 + dry-run 预览 + **可视化增删管理** + Doctor 视图 + profile badge。
  - ✅验收:全程不碰命令行完成一次"选择→capture→从机 load"。

---

## 15. 测试策略
- vitest 单测(模块逻辑、适配器全部 mock)。
- `--dry-run` 集成冒烟(从机空跑不改系统)。
- 临时 HOME 沙箱验证 capture→apply 幂等往返。
- `inventory/` 作为"真实脏机器"夹具,验证 `discover` 不崩、能正确分类(track/encrypt/exclude)。
- CI:lint + typecheck + test。

---

## 16. 风险与诚实边界
- 任意 app 配置**不保证 100% 可移植**(机器相关路径/许可证/窗口态);appconfig 是"尽力而为 + 人工确认"。
- mas 限制:需先 GUI 登录 Apple ID,只能装已购应用;部分 GUI 应用无 cask,需手动安装(产品如实标注)。
- 无 remote 的本地仓库无法靠清单还原,需用户单独备份(产品会检测并告警)。
- age 私钥仍是根信任:密码管理器丢失/锁死则全部加密项不可解(文档强提示备份恢复码)。

---

## 17. 使用说明速览（"项目说明使用"）

```
roost init           # 连接/初始化你的配置仓库 + 设置 age key
roost select         # 选择向导:勾选要备份的类别/文件/app/域/项目
roost capture        # 主力:把选中项写入仓库并 push
roost list           # 查看/增删当前已备份内容
roost status|diff    # 看漂移(机器 vs 仓库 / 主力 vs 从机)
roost load           # 从机:拉取并加载(默认 dry-run 预览)
roost app learn      # (P2) 录制模式:抓某 app 的配置
roost serve          # (P3) 打开 Web 仪表盘
roost doctor         # 体检依赖与前置
# 新机:curl -fsSL <bootstrap-url> | bash
```
README 将含:双仓库模型图、安全模型、隐私承诺、30 秒上手、常见 app 支持说明、插件开发指南。

---

## 18. 附录:与 `inventory/` 的关系
`inventory/`(INVENTORY.md / Brewfile.draft / projects.draft.yaml)是**首个真实用户(开发者本机)**的盘点,用途:① 验证发现引擎能在"很乱的真机"跑通;② P1 的测试夹具。**它是数据,不进产品逻辑,产品出厂不含它。**
