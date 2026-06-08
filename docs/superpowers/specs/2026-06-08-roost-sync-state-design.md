# Roost 同步状态 · 多机协作 · 通用冲突解决 — 设计

状态:**草案(待评审)** · 日期:2026-06-08 · 适用:Roost v1(仅 macOS)

> 本文是 WHAT/HOW 的产品+架构设计。绑定规则、范围冻结见
> `2026-05-30-roost-architecture.md`;本设计触及绑定契约与数据 schema,
> 落地前需新增 **3 个 ADR**(见 §10)。

---

## 1. 问题陈述

对一台**全新的第二台 Mac**,今天的 Roost 只能"半用",且冲突处理**严重不对称**(基于
代码审计,2026-06-08):

- **缺第二台机引导**:`roost load` / `POST /api/load` 存在,但
  - 不会自动 clone 你的 config 仓库 —— 假设 `~/.local/share/chezmoi`(或
    `$ROOST_REPO`)已存在(`init.ts` 只做本地 scaffold,无任何 clone 逻辑)。
  - load 前不自动跑 `doctor`,缺 chezmoi/brew/age/mise 会在中途以难懂方式失败。
  - 不检查仓库可达性、age 私钥是否就位(解密 dotfiles/env 密文必需)。
- **冲突处理只有 skills 做全了**:`skills` 有 `computeConflicts` + "备份后接管" UI
  (`Skills.tsx`、`/api/skills/resolve`);其余模块:
  - `dotfiles` 交给 chezmoi 确定性覆盖(apply 前备份被管文件,但无 Roost 层选择);
  - `packages` brew 静默升级、无备份;
  - `appconfig` `defaults import` **静默覆盖**、无备份、无预览;
  - `projects` 有安全闸(脏树/无 remote 跳过+告警)但无解决 UI;
  - `env/alias`:env.sh 与 rc 文件改动会备份,但**不检测** rc 里已有的冲突
    别名/env 定义,Roost 的定义因 source 顺序靠后而**静默获胜**。
- **没有"机器角色"概念**:每台机同一个 dashboard、同一个主 CTA(capture),
  新机用户一上来面对的是"备份"而非"恢复",体验断裂。

### 1.1 角色为什么不能写死(健壮性核心)

朴素方案是给机器贴"主力机/第二台机"的永久角色,再各给一套引导。但用户的机器
**角色会翻转**:今天的备机,明天可能成为日常主力(旧机退役/换新)。把角色钉死,
将来 P2 双向同步必然打架。

**结论:取消角色概念。** 不变量 I2 已规定唯一事实源是用户的私有 git 仓库,机器只是
客户端。于是机器在任意时刻**只是处于相对仓库的某个同步状态**——和 git 的
ahead/behind 同构。角色翻转因此零成本:备机变主力时,它的 status 自然报 Ahead,
CTA 自然变 Capture,**没有任何"切换角色"动作,因为系统里没有角色**。

---

## 2. 目标 / 非目标

**目标(本设计 IN):**

1. **同步状态模型**:用三方基线把每台机相对仓库的状态判为
   Synced / Ahead / Behind / Diverged,并据此派生主 CTA 与引导。
2. **第二台机引导**:从零到可用的引导(clone → doctor 预检硬门 → age 私钥导入 →
   dry-run 预览 → 逐项恢复)。
3. **通用冲突子系统**:把 skills 的检测+处置模式推广到**所有**模块,逐项处置,
   **绝不静默覆盖**。
4. **多机协作最小集**:机器列表(last-seen/last-synced/各机改了啥)+ 推送安全门
   (检测"别的机在我上次同步后推过 → 先 pull")。

**非目标(OUT,维持范围冻结):**

- 不做自动后台同步 / 守护进程 / 定时推拉(仍是用户显式 capture/load)。
- 不引入服务器、账号、遥测、云(守 I2)。
- 不做真正的双向自动合并引擎(三方仅用于**判方向**与**呈现**,处置仍是
  "取一边 / 受限合并")。
- 不加跨平台分支(守 I9,仍仅 macOS)。
- 不改 `selection.yaml` schema;不改 capture/apply 主流程骨架。

---

## 3. 核心模型:同步状态(三方基线)

### 3.1 三方与四态

判断"是我改的(Ahead)还是仓库被改的(Behind)",**单比"本地 vs 仓库"不够**——
两者不同时分不清谁动了。必须引入第三参照点:**上次成功同步时的基线**。这是
三方合并 / git 的标准模型:

| local vs 基线 | repo vs 基线 | 状态 | 派生动作 |
|---|---|---|---|
| 同 | 同 | **Synced** | 无 |
| 变 | 同 | **Ahead** | Capture(我改的) |
| 同 | 变 | **Behind** | Restore(仓库改的) |
| 变 | 变 | **Diverged** | 逐项 Review |

- **基线 = 每模块/每项"上次成功同步时的内容哈希"**。
- **方向从内容算,绝不从 commit 相等性算。** 这是关键修正:注册表/无关模块的
  commit 会让"仓库 HEAD 变了"对每台机都成立,若用 commit 级判 Behind 会大面积
  误报。`lastSyncedCommit` **只**服务于 §6.2 的推送安全门,**不**参与方向判定。

### 3.2 计算落点

- 在编排层新增 `syncStateAll()`(`packages/core/src/sync-state.ts`,纯函数,易测):
  对每模块取 (localHash, repoHash, baselineHash) → 输出 `direction`。
- **core 不加领域 if-else**(守 I4):三方比对是模块无关的纯逻辑;各模块只负责
  **吐出三个哈希**,不知道"方向"语义。

---

## 4. 机器身份与注册表(复用现有结构)

**重要:注册表基本已存在,本设计是扩展而非新建。**
`packages/core/src/state.ts` 已写 `state/{host}.json`
(`MachineState { host, schemaVersion, capturedAt, modules }`,已 `.chezmoiignore`),
`/api/machines` 已能列出主机。`profiles.ts` 已按 `os.hostname()` 匹配。

**改造:**

- **机器身份** = `os.hostname()`(沿用现有约定,不引入随机 id,避免与 profiles 打架)。
  - **已知限制**:两台同名主机会撞 key。列为已知限制;可选加用户可改的"显示名"
    消歧,但不强制。
- **`MachineState` 扩展**(ADR-③):
  - `modules: Record<string, ModuleBaseline>` —— 复用现有字段当**基线哈希袋**
    (每模块/每项的 baselineHash + 简短摘要)。
  - 新增 `lastSyncedCommit: string`(本机上次成功 load/capture 后的仓库 commit)。
  - 新增 `lastSeen: string`(由 capture/load 写入)。
- **注册表视图** = 富化现有 `/api/machines`:列出每台机的 host、lastSeen、
  lastSyncedCommit、最近 capture 的模块摘要。

> 基线写进仓库(committed,chezmoiignore)而非纯本地:这样多机可互相看见
> "谁动了什么",且复用现有 state/ 落盘。每次 capture/load 写 state 会产生 commit,
> 但因方向判定基于内容、不基于 commit 相等,churn 不致误报(见 §3.1)。

---

## 5. 引导流程(状态派生,非角色)

首启时 Roost 探测状态 → 派生**唯一推荐路径**(都走同一引擎,只是 CTA/默认不同):

| 探测到 | 判定 | 引导 |
|---|---|---|
| 无 repo 配置 | 首台机 | **建仓向导**:连接/创建私有 git 仓 → 生成 age 私钥 → 选要管什么 → 首次 capture → push |
| repo 已配,本地整体 Behind | **新机恢复** | **恢复向导**(下方分步) |
| 有 repo + 本地有差异 | 日常 | 进同步复核面,按 Ahead/Behind/Diverged 给动作 |

**恢复向导分步:**

1. **clone** —— `roost clone <repo-url>`(新增;今天完全没有 clone 逻辑)。
   把仓库落到 `~/.local/share/chezmoi`(或 `$ROOST_REPO`)。
2. **doctor 预检硬门** —— 自动跑 `doctor`;缺 chezmoi/brew/age/mise、仓库不可达、
   age 私钥缺失 → **挡住并给安装/获取指引**,不进入 apply。
3. **age 私钥导入** —— 引导从 1Password / rbw / 手动拷贝**导入**(非生成)。
   **私钥绝不经任何远程/聊天通道传输**(守 I6 与安全约束)。
4. **dry-run 预览** —— 默认 dry-run,逐模块列出将写/将备份/将跳过。
5. **逐项 load** —— 默认"覆盖前备份本地"**开**;有冲突走 §6 复核面。

---

## 6. 冲突子系统(检测 + 处置 + UI)

### 6.1 处置矩阵(诚实分级,非每种都能合并)

| 模块 | 处置选项 | 备注 |
|---|---|---|
| dotfiles | 取仓库(先备份)/ 保留本地(跳过)/ 看 diff | 粗粒度,见 §7.1 |
| env · alias | 取仓库 / 保留本地 / **合并**(并集,键冲突时用户选哪边赢) | 唯一适合 merge |
| appconfig | 取仓库(先备份)/ 保留本地 | **整域级**;`defaults import` 整域写,不做逐键合并 |
| packages | 升到仓库版 / 保留本地版 | 本地多装的**默认保留**(brew bundle 加法语义) |
| projects | stash 后 pull / 跳过脏树 / 保留本地 | 复用现有安全闸 |
| skills | 备份后接管 / 保留本地 | 复用现有 `resolveSkillConflict`,纳入统一 UI |

**底线**:每个冲突至少给 `取仓库(先备份)` + `保留本地`;能 diff 的给 diff;
**绝不静默覆盖**(这正是今日 Q3 的病)。所有"取仓库"覆盖前必备份,复用
`apply.ts:backupFiles` 与 skills 的备份模式 → 守 I7(apply 永远可逆)。

### 6.2 推送安全门(防静默互覆)

capture push 前,比对"远端 HEAD vs 本机 `lastSyncedCommit`":若远端更新
(别的机推过)→ 友好提示「`MacBook-Air` 2 天前改过 env,先合并」,引导先 pull
再推,而非 git 干巴巴的 non-fast-forward 报错。

### 6.3 UI 决策(经可视化评审锁定)

- **主视图 = 分组总览**:Drift 视图**演进**为同步复核面;所有模块一屏,每模块一张
  卡 + 状态药丸(Synced/Ahead/Behind/Diverged + 计数),有冲突的项内联展开就地处置。
  不另起视图。
- **展开单项 = 两栏并排**:`本地 | 仓库`,基线默认折叠("显示基线 ▸")。聚焦二选一,
  窄屏友好。
- **无文本 diff 的模块**降级为**语义摘要**:
  - packages:`git 本地 2.39 → 仓库 2.45`;
  - skills:"目标机已有非 Roost 目录";
  - **appconfig:逐键展开对照**(`tilesize 48|64`…)以**看清**,但处置仍**整域级**
    (整取/整留)——逐键只为看清,不为挑选。

---

## 7. 架构落点 / 改造清单

### 7.1 必改(现有文件)

- **`packages/shared/src/types.ts`**(ADR-②):`SyncModule.status()` 现返回
  `DriftReport`(每项仅 `synced|drift|conflict|untracked`,二态无方向)。
  **追加可选字段**到 `DriftItem`:`localHash? / repoHash? / baselineHash?`
  或派生 `direction?: "ahead"|"behind"|"diverged"`。**纯加法,旧调用不破**;但
  "status 现在表达方向"是绑定接口的**语义变更** → 必须 ADR。
- **`packages/core/src/orchestrate.ts`**:新增 `syncStateAll()`;`loadAll` 接入
  逐项冲突处置(扩 `ApplyPlan.actions` 携带 resolution)。
- **`packages/core/src/state.ts`**(ADR-③):扩 `MachineState`(见 §4)。
- **`packages/core/src/modules/{dotfiles,env,appconfig,packages,projects,skills}.ts`**:
  各 `status()` 补出三方哈希。**主要工作量在此。**
- **`packages/cli/src/init.ts`**:新增 clone / 第二台机 bootstrap。
- **`packages/cli/src/server.ts`**:`/api/status`、`/api/diff` 带方向;`/api/machines`
  富化;新增推送安全门端点;通用 `/api/.../resolve`(泛化 skills 的 resolve)。
- **`packages/cli/src/doctor.ts` + `index.ts`**:doctor 接成 load 前置硬门。
- **`packages/web/src/views/Drift.tsx`**:演进为分组同步复核面(§6.3)。
- **`packages/cli/src/api.ts`**:新增 sync-state / 冲突 / 注册表的响应类型。

### 7.2 净新增文件

- `packages/core/src/sync-state.ts` —— 三方比对 + 推送安全检查(纯函数)。
- `packages/cli/src/commands/clone.ts`(或并入 init)—— 第二台机首次同步。
- `packages/web/src/components/ConflictItem.tsx` —— 两栏/语义摘要的单项处置组件。

### 7.3 dotfiles 的粗粒度妥协(已知)

`dotfiles.status()` 今天就是 `chezmoi verify` 一个布尔,chezmoi 自己掌管比对,
Roost 拿不到逐文件三方哈希。**取舍:dotfiles 退化用 `chezmoi diff` 非空=有变 +
`lastSyncedCommit` 判方向,不做逐文件三方。** spec 明确这是 dotfiles 的已知粒度
妥协,不假装做到了逐文件三方。

---

## 8. 影响与风险

- **不破坏项(范围护栏)**:`selection.yaml` schema 不动;capture/apply 主流程骨架
  不动;age 加密、Secret Scanner 硬门、apply 可逆(覆盖前备份)、v1 仅 macOS 全部沿用。
  新冲突处置**复用** `backupFiles` 与 skills 备份模式。
- **契约语义变更**:`status` 现表达方向 → ADR-②;字段加法,运行期向后兼容。
- **state churn**:capture/load 写 `state/{host}.json` 产生 commit;因方向判定基于
  内容(§3.1)不致误报,但仓库历史会更密 —— 可接受。
- **同名主机**:hostname 撞 key(§4)——已知限制,可选显示名消歧。
- **高风险逻辑**:三方比对 + 冲突处置 → 必须 TDD(见 §9)。

---

## 9. 测试策略

沿用"每模块三类测试:单元 / dry-run / 幂等"(CLAUDE.md 约定),并新增:

- `sync-state.ts` 纯函数:四态判定(含基线缺失=untracked、同名摘要等边界)。
- 推送安全门:远端领先/相等/落后三种分支。
- 每模块 `status()` 三方输出:构造 local/repo/baseline 三种组合,断言 direction。
- 冲突处置:`取仓库` 必先备份(断言备份文件存在)、`保留本地` 不动盘、`合并`(env)
  并集与键冲突取舍、appconfig 整域写不逐键。
- 引导:clone 失败 / doctor 不过 → **不进入 apply**(硬门生效)。
- core 禁联网(clone/push 经唯一 exec 适配器,测试用 fake exec)。

---

## 10. 范围与变更控制(必开 ADR)

设计已冻结;本设计经 brainstorming 决策,落地前新增:

- **ADR-A:同步状态模型 + 三方基线** —— 引入 sync-state 概念、方向判定基于内容、
  `lastSyncedCommit` 仅用于推送门。
- **ADR-B:SyncModule 契约扩展** —— `DriftItem` 携带三方哈希/方向的加法式契约变更。
- **ADR-C:MachineState 扩展 / 注册表语义** —— `modules` 当基线袋、新增
  `lastSyncedCommit`/`lastSeen`、hostname 作 key 的取舍与已知限制。

新能力仅落到**模块**或经既有扩展契约,**不 hack core**(守 §4/§7 扩展规则)。

---

## 11. 已知限制

1. dotfiles 为粗粒度方向(§7.3),非逐文件三方。
2. 同名主机撞 key(§4)。
3. appconfig 处置整域级,不逐键挑(§6.3)。
4. 非自动同步:推拉仍需用户显式触发(设计取舍,守范围冻结)。
