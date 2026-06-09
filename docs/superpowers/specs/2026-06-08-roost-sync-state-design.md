# Roost 同步状态 · 多机协作 · 通用冲突解决 — 设计

状态:**草案(待评审)** · 日期:2026-06-08 · 适用:Roost v1(仅 macOS)

> 本文是 WHAT/HOW 的产品+架构设计。绑定规则、范围冻结见
> `2026-05-30-roost-architecture.md`;本设计触及绑定契约与数据 schema,
> 落地前需新增 **3 个 ADR**(0016 / 0017 / 0018,见 §10)。

---

## 1. 问题陈述

对一台**全新的第二台 Mac**,今天的 Roost 只能"半用",且冲突处理**严重不对称**(基于
代码审计,2026-06-08):

- **缺第二台机引导**:`roost load` / `POST /api/load` 存在,但
  - 不会自动 clone 你的 config 仓库 —— 假设 `~/.local/share/chezmoi`(或
    `$ROOST_REPO`)已存在(`init.ts` 只做本地 scaffold,无任何 clone 逻辑)。
  - load 前不自动跑 `doctor`,缺 chezmoi/brew/age/mise 会在中途以难懂方式失败。
  - 不检查仓库可达性、age 私钥是否就位(解密 dotfiles/env 密文必需)。
- **冲突处理只有 skills 做全了**:`skills` 有 `computeConflicts` + "备份后接管" UI;
  其余模块:`dotfiles` 交给 chezmoi 确定性覆盖(apply 前备份,但无选择);
  `packages` brew 静默升级、无备份;`appconfig` `defaults import` **静默覆盖**、
  无备份、无预览;`projects` 有安全闸但无解决 UI;`env/alias` 备份了 env.sh 与 rc,
  但**不检测** rc 里已有的冲突定义,Roost 因 source 顺序靠后而**静默获胜**。
- **没有"机器角色"概念**:每台机同一个 dashboard、同一个主 CTA(capture),
  新机用户一上来面对"备份"而非"恢复",体验断裂。

### 1.1 角色为什么不能写死(健壮性核心)

朴素方案是给机器贴"主力机/第二台机"的永久角色,但用户的机器**角色会翻转**:今天的
备机,明天可能成主力。把角色钉死,将来 P2 双向同步必然打架。

**结论:取消角色概念。** 不变量 I2 已规定唯一事实源是用户的私有 git 仓库,机器只是
客户端。机器在任意时刻**只是处于相对仓库的某个同步状态**——与 git 的 ahead/behind
同构。角色翻转因此零成本:备机变主力时,它的 status 自然报 Ahead,CTA 自然变
Capture,**没有"切换角色"动作,因为系统里没有角色**。

### 1.2 设计总原则:自动优先,例外才问

用户在**两个**地方会陷入"无休止勾选",都要消解:**捕获端**(选什么备份——发现会刷出
几十 dotfile、几百 brew 包、一堆 app 域)与**加载端**(冲突逐个点)。

支撑激进自动化的底气是 **I7(apply 永远可逆:覆盖前必备份 + 默认 dry-run)** —— 因为
可逆,我们敢"先替你做、给你后悔药",而非"先逼你确认每一项"。

**目标:常见路径上用户只做 0~1 个决定。** 凡能自信处理的全自动,只把真正需要人脑的
浮现为"例外"。

---

## 2. 目标 / 非目标

**目标(IN):**

1. **同步状态模型**:用三方基线把每台机相对仓库的状态判为
   Synced / Ahead / Behind / Diverged,据此派生主 CTA 与引导(§3)。
2. **第二台机引导**:从零到可用(clone → doctor 预检硬门 → age 私钥导入 →
   dry-run 预览 → 逐项恢复),且**默认基调按场景预选**(§5)。
3. **通用冲突子系统 + 自动优先**:把 skills 的检测+处置推广到**所有**模块;非冲突
   项自动处理,只把例外浮现为三类,**绝不静默覆盖**(§6)。
4. **多机协作最小集**:机器列表(last-seen/last-synced/各机改了啥)+ 推送安全门
   (检测"别的机在我上次同步后推过 → 先 pull")(§4、§6.4)。

**非目标(OUT,维持范围冻结):**

- 不做自动后台同步 / 守护进程 / 定时推拉(仍是用户显式 capture/load)。
- 不引入服务器、账号、遥测、云(守 I2)。
- 不做真正的双向自动合并引擎(三方仅用于**判方向**与**呈现**;处置是"取一边/受限合并")。
- 不加跨平台分支(守 I9)。不改 `selection.yaml` schema;不改 capture/apply 主骨架。

---

## 3. 核心模型:同步状态(三方基线)

### 3.1 三方与四态

判断"是我改的(Ahead)还是仓库被改的(Behind)",**单比"本地 vs 仓库"不够**——
必须引入第三参照点:**上次成功同步时的基线**。这是三方合并 / git 的标准模型:

| local vs 基线 | repo vs 基线 | 状态 | 派生动作 |
|---|---|---|---|
| 同 | 同 | **Synced** | 无 |
| 变 | 同 | **Ahead** | Capture(我改的) |
| 同 | 变 | **Behind** | Restore(仓库改的) |
| 变 | 变 | **Diverged** | 例外·逐项 Review |

- **基线 = 每模块/每项"上次成功同步时的内容哈希"**。
- **方向从内容算,绝不从 commit 相等性算。** 关键修正:注册表/无关模块的 commit 会
  让"仓库 HEAD 变了"对每台机都成立,若用 commit 级判 Behind 会大面积误报。
  `lastSyncedCommit` **只**服务于 §6.4 推送安全门,**不**参与方向判定。

### 3.2 计算落点

- 编排层新增 `syncStateAll()`(`packages/core/src/sync-state.ts`,纯函数,易测):
  对每模块取 (localHash, repoHash, baselineHash) → 输出 `direction`。
- **core 不加领域 if-else**(守 I4):三方比对是模块无关纯逻辑;各模块只负责
  **吐出三个哈希**,不知道"方向"语义。

---

## 4. 机器身份与注册表(复用现有结构)

**注册表基本已存在,本设计是扩展而非新建。** `packages/core/src/state.ts` 已写
`state/{host}.json`(`MachineState { host, schemaVersion, capturedAt, modules }`,
已 `.chezmoiignore`),`/api/machines` 已能列出主机;`profiles.ts` 已按
`os.hostname()` 匹配。

**改造:**

- **机器身份** = `os.hostname()`(沿用现有约定,不引入随机 id,避免与 profiles 打架)。
  - **已知限制**:两台同名主机撞 key。列为已知限制;可选加用户可改"显示名"消歧,不强制。
- **`MachineState` 扩展**(ADR-0018):
  - `modules: Record<string, ModuleBaseline>` —— 复用现有字段当**基线哈希袋**
    (每模块/每项 baselineHash + 简短摘要)。
  - 新增 `lastSyncedCommit: string`、`lastSeen: string`(capture/load 写入)。
- **注册表视图** = 富化现有 `/api/machines`:每台机的 host、lastSeen、lastSyncedCommit、
  最近 capture 的模块摘要。

> 基线写进仓库(committed,chezmoiignore)而非纯本地:多机可互相看见"谁动了什么",
> 且复用现有 state/ 落盘。每次 capture/load 写 state 产生 commit,但方向判定基于内容
> 不基于 commit 相等(§3.1),churn 不致误报。

---

## 5. 引导流程(状态派生,默认基调预选)

首启探测状态 → 派生**唯一推荐路径**(都走同一引擎,只是 CTA/默认不同):

| 探测到 | 判定 | 引导 |
|---|---|---|
| 无 repo 配置 | 首台机 | **建仓向导**:连接/创建私有 git 仓 → 生成 age 私钥 → 智能预选要管什么 → 首次 capture → push |
| repo 已配,本地整体 Behind / 空 | **新机恢复** | **恢复向导**(下方) |
| 有 repo + 本地有差异 | 日常 | 进同步复核面(§6) |

**恢复向导分步:**

1. **clone** —— `roost clone <repo-url>`(新增)。落到 `~/.local/share/chezmoi`(或 `$ROOST_REPO`)。
2. **doctor 预检硬门** —— 自动跑;缺 chezmoi/brew/age/mise、仓库不可达、age 私钥缺失
   → **挡住并给指引**,不进入 apply。
3. **age 私钥导入** —— 引导从 1Password / rbw / 手动拷贝**导入**(非生成)。
   **私钥绝不经任何远程/聊天通道传输**(守 I6 与安全约束)。
4. **基调预选** —— 进复核面时,顶部呈现一条**已替用户选好、可改**的"基调":
   - 检测到新机 → 默认 **以仓库为准**(覆盖本地,先备份);
   - 日常机(有本地改动)→ 默认 **保守**(仅补缺失,冲突问我)。
   基调不是拦路问句,是预答好的方向盘:用户什么都不动也能继续。
5. **逐项 load** —— 默认"覆盖前备份本地"**开**;按 §6 自动处理 + 例外浮现。

---

## 6. 冲突子系统(自动优先 + 通用处置)

### 6.1 综合自动化模型(预答基调 + 自动托管 + 只露例外)

复核面一屏三段:

1. **基调旋钮(§5 步骤 4)**:它本质就是全局批量动作的**默认值**,按检测场景预选,可改;
   改动则全表实时重算。option"一问定调"与"自动托管"在此**合一**——同一机制两视角。
2. **已自动就绪**:非冲突项(Behind、新机/本地无内容、仓库新增项)按置信度**自动**
   处理并排队备份,**不打扰**;仅给一个可展开摘要。
3. **需你决定**:不能自信处理的浮现为**三类例外**(§6.3),默认动作已按基调给好。

常见路径 = **0~1 次点击**:嫌烦 → 直接"应用";想掌控 → 改基调旋钮;较真 → 只展开
在意的例外项。**没人需要逐个勾几十项。**

### 6.2 处置矩阵(诚实分级,非每种都能合并)

| 模块 | 处置选项 | 备注 |
|---|---|---|
| dotfiles | 取仓库(先备份)/ 保留本地 / 看 diff | 粗粒度,见 §7.1 |
| env · alias | 取仓库 / 保留本地 / **合并**(并集,键冲突用户选哪边赢) | 唯一适合 merge |
| appconfig | 取仓库(先备份)/ 保留本地 | **整域级**;`defaults import` 整域写,逐键看不逐键挑 |
| packages | 升到仓库版 / 保留本地版 | 本地多装的**默认保留**(brew bundle 加法语义) |
| projects | stash 后 pull / 跳过脏树 / 保留本地 | 复用现有安全闸 |
| skills | 备份后接管 / 保留本地 | 复用 `resolveSkillConflict`,纳入统一 UI |

**底线**:每个冲突至少给 `取仓库(先备份)` + `保留本地`;能 diff 的给 diff;
**绝不静默覆盖**。所有"取仓库"覆盖前必备份,复用 `apply.ts:backupFiles` 与 skills
备份模式 → 守 I7。

### 6.3 "需你决定"= 三类例外(都绝不静默)

1. **两边都改了(Diverged)** —— 默认按基调(取仓库),可改(合并/保留本地/diff)。
2. **需先设置(Blocked)** —— 缺 age 私钥 / 工具缺 / 解密失败 → 标"需设置"给修复入口,
   **既不自动也不静默跳过**(否则用户误以为同步全了)。
3. **破坏性(Destructive)** —— 仓库删了某项(取仓库 = 删本地)→ 默认 **保留本地**,
   删除**永不自动,必须显式确认**(即便已备份)。

### 6.4 推送安全门(防静默互覆)

capture push 前,比对"远端 HEAD vs 本机 `lastSyncedCommit`":远端更新(别的机推过)
→ 友好提示「`MacBook-Air` 2 天前改过 env,先合并」,引导先 pull,而非 git 干巴巴的
non-fast-forward 报错。

### 6.5 两条硬规则(让自动激进但不闯祸)

- **破坏性删除永不自动** —— 删除即便可逆也要人点头。
- **前置缺失浮现为"需设置",不静默跳过** —— 守"所见即所得的同步完整性"。

### 6.6 UI 决策(经可视化评审锁定)

- **主视图 = 分组总览**:`Drift` 视图**演进**为同步复核面;所有模块一屏,每模块状态
  药丸 + 计数,有冲突项内联展开就地处置。不另起视图。
- **展开单项 = 两栏并排**:`本地 | 仓库`,基线默认折叠("显示基线 ▸")。
- **默认动作固定锚最右**:每行默认动作(等宽、coral)固定行尾,与底部主按钮"应用"
  右对齐成一条竖线;备选弱化样式排其左 → 视线一扫到底即知"默认会发生什么"。
- **三类例外用颜色+左侧圆点分组**:红=两边都改、紫=需设置、浅红=破坏性。
- **无文本 diff 的模块**降级语义摘要:packages `git 2.39 → 2.45`;skills "已有非
  Roost 目录";**appconfig 逐键展开看清**(`tilesize 48|64`…)但处置整域级。

### 6.7 减少重复打扰

- **智能预选**(捕获):有主见的默认勾选(显式 formulae、常见 dotfile、已知安全 app 域)
  + 自动排除噪声(缓存/密钥/垃圾),用户只做减法,不面对空白长清单。
- **记住决定**:逐项处置策略持久化到该机 state,避免每次同步反复追问同一项。
- **渐进披露**:默认只给摘要("将管理 47 项"),想看才展开,绝不强滚长清单。

---

## 7. 架构落点 / 改造清单

### 7.1 必改(现有文件)

- **`packages/shared/src/types.ts`**(ADR-0017):`SyncModule.status()` 现返回
  `DriftReport`(每项仅 `synced|drift|conflict|untracked`,二态无方向)。
  **追加可选字段**到 `DriftItem`:`localHash? / repoHash? / baselineHash?` 与派生
  `direction?` + 例外类别 `exception?: "diverged"|"blocked"|"destructive"`。
  **纯加法,旧调用不破**;但"status 现在表达方向/例外"是绑定接口的**语义变更** → ADR。
- **`packages/core/src/orchestrate.ts`**:新增 `syncStateAll()`;`loadAll` 接入逐项
  处置(扩 `ApplyPlan.actions` 携带 resolution),并实现"自动托管/例外浮现"分流。
- **`packages/core/src/state.ts`**(ADR-0018):扩 `MachineState`(§4)+ 记住决定。
- **`packages/core/src/modules/{dotfiles,env,appconfig,packages,projects,skills}.ts`**:
  各 `status()` 补三方哈希 + 例外分类。**主要工作量在此。**
- **`packages/cli/src/init.ts`**:新增 clone / 第二台机 bootstrap。
- **`packages/cli/src/server.ts`**:`/api/status`、`/api/diff` 带方向/例外;`/api/machines`
  富化;新增推送安全门端点;通用 `/api/resolve`(泛化 skills 的 resolve)。
- **`packages/cli/src/doctor.ts` + `index.ts`**:doctor 接成 load 前置硬门。
- **`packages/web/src/views/Drift.tsx`**:演进为分组同步复核面(§6.6)。
- **`packages/cli/src/api.ts`**:新增 sync-state / 例外 / 注册表 / 基调的响应类型。

### 7.2 净新增文件

- `packages/core/src/sync-state.ts` —— 三方比对 + 例外分类 + 推送安全检查(纯函数)。
- `packages/cli/src/commands/clone.ts`(或并入 init)。
- `packages/web/src/components/ConflictItem.tsx` —— 两栏/语义摘要/默认锚右的单项组件。
- `packages/web/src/components/SyncPolicyBar.tsx` —— 基调旋钮 + 自动就绪摘要 + 例外分组。

### 7.3 dotfiles 的粗粒度妥协(已知)

`dotfiles.status()` 今天是 `chezmoi verify` 一个布尔,chezmoi 自己掌管比对,Roost 拿
不到逐文件三方哈希。**取舍:dotfiles 退化用 `chezmoi diff` 非空=有变 + `lastSyncedCommit`
判方向,不做逐文件三方。** 明确这是已知粒度妥协,不假装做到了逐文件三方。

---

## 8. 影响与风险

- **不破坏项(范围护栏)**:`selection.yaml` schema 不动;capture/apply 主骨架不动;
  age 加密、Secret Scanner 硬门、apply 可逆、v1 仅 macOS 全部沿用。新冲突处置**复用**
  `backupFiles` 与 skills 备份模式。
- **契约语义变更**:`status` 现表达方向/例外 → ADR-0017;字段加法,运行期向后兼容。
- **state churn**:capture/load 写 `state/{host}.json` 产生 commit;方向判定基于内容
  (§3.1)不致误报,但仓库历史更密 —— 可接受。
- **同名主机**:hostname 撞 key(§4)——已知限制,可选显示名消歧。
- **高风险逻辑**:三方比对 + 例外分类 + 处置 → 必须 TDD(§9)。

---

## 9. 测试策略

沿用"每模块三类测试:单元 / dry-run / 幂等",并新增:

- `sync-state.ts` 纯函数:四态判定 + 三类例外分类(含基线缺失=untracked、删除=
  destructive、缺前置=blocked 等边界)。
- 推送安全门:远端领先/相等/落后三分支。
- 每模块 `status()` 三方输出:构造 local/repo/baseline 三种组合,断言 direction/exception。
- 处置:`取仓库` 必先备份(断言备份文件存在)、`保留本地` 不动盘、`合并`(env)并集与
  键冲突取舍、appconfig 整域写不逐键、**破坏性删除非显式确认不执行**。
- 引导:clone 失败 / doctor 不过 → **不进入 apply**(硬门生效)。
- 自动分流:Behind/新机项自动入计划、Diverged/blocked/destructive 不自动。
- core 禁联网(clone/push 经唯一 exec 适配器,测试用 fake exec)。

---

## 10. 范围与变更控制(必开 ADR)

设计已冻结;本设计经 brainstorming 决策,落地前新增:

- **ADR-0016:同步状态模型 + 三方基线 + 自动优先策略** —— 引入 sync-state、方向判定
  基于内容、`lastSyncedCommit` 仅用于推送门、基调预选与三类例外/两条硬规则。
- **ADR-0017:SyncModule 契约扩展** —— `DriftItem` 携带三方哈希/方向/例外的加法式契约变更。
- **ADR-0018:MachineState 扩展 / 注册表语义** —— `modules` 当基线袋、新增
  `lastSyncedCommit`/`lastSeen`/记住决定、hostname 作 key 的取舍与已知限制。

新能力仅落到**模块**或经既有扩展契约,**不 hack core**。

---

## 11. 全场景覆盖矩阵

**阶段 0 · 接入(进复核屏前,doctor 硬门)**

| 场景 | 处理 |
|---|---|
| 无 repo 配置 | 建仓向导 |
| repo 不可达 / 工具缺(chezmoi/brew/mise) | doctor 门挡 + 安装/获取指引 |
| 有密文但缺 age 私钥 | doctor 门挡 + 导入指引(私钥绝不经远程/聊天) |

**阶段 1 · 复核(逐项方向)**

| 方向 | 处理 |
|---|---|
| Synced | 不显示 |
| Behind / 新机·本地无该项 / 仓库新增项 | **自动**取仓库 + 备份 |
| Ahead | 不在恢复屏 → capture 屏(自动建议备份) |
| Diverged | **例外类1**·默认按基调可改 |
| 缺前置(age/工具/解密) | **例外类2**·需设置 |
| 仓库删除项 vs 本地仍在 | **例外类3**·破坏性,默认保留本地,删除需确认 |

**阶段 2 · 捕获侧**

| 场景 | 处理 |
|---|---|
| 推送前别的机推过 | "先 pull" 安全门 banner |
| Secret Scanner 命中明文密钥 | 阻断,标"先处理密钥" |
| 文件超 maxCaptureMB | 阻断,标"超限:调上限或排除" |
| 本地多装的包 | 默认保留(加法语义) |

**结论:所有场景要么自动、要么落到三类例外之一、要么被前置门挡住。**

---

## 12. 已知限制

1. dotfiles 为粗粒度方向(§7.3),非逐文件三方。
2. 同名主机撞 key(§4)。
3. appconfig 处置整域级,不逐键挑(§6.6)。
4. 非自动同步:推拉仍需用户显式触发(范围冻结)。

## 13. 实现状态(2026-06-08)

在 `feat_sync_state` 分支,全程 TDD。**已实现并测试:**

- 同步状态模型:`classifyDirection` / `classifyException` / `computeSyncState` /
  `classifyPushSafety`(`sync-state.ts`)。
- 三方哈希助手 + 基线读写:`sync-baseline.ts`(`hashContent` /
  `loadModuleBaseline` / `recordModuleBaseline`);`MachineState` v2(`state.ts`)。
- 模块三方 `status`:appconfig、env(env.sh)、packages、projects(后两者纯加法→
  Behind)。**dotfiles / skills 仍走 legacy 安全降级**(方向不可知时浮现为决策)。
- 编排:`syncStateAll`;`loadAll` 真实 apply 后写基线。
- onboarding:`cloneRepo` / `remoteHead` / `checkPushSafety`;`roost clone` 命令。
- 推送安全:`classifyGitError` 把 non-fast-forward 归类为 `pull-first` 提示。
- 预检硬门:`Health.blocking` + `preflight()`;`/api/load apply` 与 `roost load
  --apply` 均被 gate;`GET /api/preflight`。
- API:`GET /api/sync-state`、`POST /api/resolve`(take-repo / keep-local)、
  `GET /api/preflight`。
- Web:`Sync Review` 视图(基调条 + 计数 + 自动就绪 + 三类例外 + 默认锚右 +
  可点 resolve)。

**后续补齐(均已实现):** 两栏 local|repo diff(`/api/item-diff` + 展开面板)、
appconfig 逐键展开(整域处置不变)、基调切换 + 「全部应用基调」批量、blocked
例外的「去设置」跳转 + env 在"有加密密钥但无 age 私钥"时产出 blocked、dotfiles
逐文件方向(`chezmoi status`)、capture 保留基线 + `lastSeen`。

**仍延后(真·可选 / 范围外):** 基于 recorded-head 的推送门变体(现用 non-ff
提示已覆盖 §6.4);skills 逐项三方(skills 自有冲突 UI,ADR-0014);capture 推送
后回写 `lastSyncedCommit`。
