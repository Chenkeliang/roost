# 纳入本地已有 skill — 设计(发现按目录分组 · 接管即解耦 · 修复假纳管)

- 日期: 2026-06-09
- 状态: 设计已确认,待写实现计划
- 关联: ADR-0012(skills 模块)、ADR-0014(冲突:备份后接管);本设计新增 **ADR-0019**(纳入本地 skill + capture 解引用)。spec 2026-06-08-roost-skills-module-design.md(模块契约)、2026-06-08-roost-skills-conflict-resolution-design.md(冲突)。

## 0. 动机(实测)

在真机扫描 `~/.agents/skills`(45 条)发现:

- **10 个 skill 是软链**指向 `~/.cc-switch/skills/X`(被另一工具管理),且**已经"在 repo 里"——但存的是软链不是内容**。`git ls-files skills/database-query` 只有 1 条(软链本身)。**换台 Mac 恢复,这 10 个全是空的/坏的。**
- 根因是现有 `capture()` 的 bug:`fs.cpSync(软链目录, dest, {recursive:true})`(默认 `dereference:false`)把 `dest` 抄成**软链**,真实内容从未进仓库。已用探针确认:`realpathSync` 顶层后再 `cpSync` → `dest` 为真实目录、内部软链仍保留。
- 还有约 21 个 bare(真实目录)skill 尚未纳管。
- "只在 IDE 目录、源里没有的"真实 skill ≈ 0(只有 `.system`/`.DS_Store` 之类垃圾)。

## 1. 目标与范围

让用户通过现有 **「发现」→ 接管** 流程,把本机已有的 skill 纳入 Roost 管理:**把真实内容**抓进仓库、并(默认)就地把源变成真实目录从而**脱离原管理工具**。同时修复上述"假纳管"。

**IN**
- **capture 解引用**:抓取前若源顶层是软链,先 `realpathSync` 再 `cpSync` → 仓库落真实内容(内部软链保留)。
- **discover 按"真实内容所在目录"分类**(`origin`),不点名任何工具(I8):`location`(内容真实所在目录)、`linked`(是否经软链)、`needsRepair`(已在 repo 但存成软链/无真实内容)。
- discover **surface 修复项**:把"仓库里存成软链"的重新列出,标「需修复」(现状被当已管理跳过)。
- discover **只认含 `SKILL.md` 的目录**,跳过点开头条目(过滤垃圾)。
- **接管即解耦**(默认):接管 = capture + 就地 materialize 源(仓库真实内容 → `<sourceDir>/X`,替换原软链)。确认框给「立即生效」开关,可取消只入库。
- **移出管理**(un-adopt):让 Roost "忘掉"某 skill(删 `repo/skills/X` + `skills.yaml` 条目 + `skills-links.json` 中该 skill 记录),**不删用户任何本地文件/链**,完全可逆。
- **同名多处**:内容一致的多处自动合并成一行(按解析后的真实目录);内容**不一致**(conflict)时让用户**选用哪一份**再接管。
- web 发现页**按 `origin.location` 目录分组**;软链组挂**通用提醒**(不提工具名);批量**确认框带 dry-run 预览**;接管/修复/移出入口。

**OUT(YAGNI)**
- 不点名 cc-switch / 不写死任何工具路径;不读/写 cc-switch 数据库;不自动迁移、不替用户关闭其它工具(只提示)。
- 不改 core 编排/分层/`selection.yaml` 语义(skills 真相源仍是 `skills.yaml` + `repo/skills/` + `skills-links.json`)。
- 不加 `roost skills adopt` CLI(走现有 discover/capture 路径,方案 C)。
- 不做"接管时一并全量分发到所有 IDE 目标"(分发仍是现有「应用/link」动作;源变真实目录后,既有指向源的 IDE 软链自然继续可用)。仅 macOS(I9)。

## 2. 不变量符合性

- **I6 密钥硬门**:接管复用 `capture()` 既有的 `scanPathForSecrets` 闸门 —— 含密钥/过大者跳过、计入 `blockedDetail`,绝不入库。
- **I7 可逆 / 默认 dry-run**:确认框先列将动的文件/大小/来去路径,确认才写;materialize 用 `rmSync` **只删源处那条软链**(探针确认:不动软链目标,即 cc-switch 内容安全);"移出管理"不删用户文件。
- **I8 零硬编码**:分类**按解析出的真实目录**,UI 按目录分组、提醒按目录措辞;core 不出现 `cc-switch` 字样、不写死工具路径。
- **I3 分层 / core 零领域分支**:全部新行为落在 **skills 模块 + server 端点 + web**;不往 core 编排加 if-else。
- **I9 仅 macOS**;**ADR 门**:新增 ADR-0019(含 `Candidate.origin` 这一 additive schema 变更)。

## 3. shared:`Candidate.origin`(additive)

`packages/shared/src/types.ts` 给 `Candidate` 加可选字段(全字段可选、纯增量,不破坏现有模块):

```ts
origin?: {
  location: string;        // 真实内容所在目录(展示用,如 "~/.cc-switch/skills"、"~/.agents/skills")
  linked: boolean;         // 经软链到达(true → UI 显示通用提醒)
  needsRepair?: boolean;   // 已在 repo 但存成软链/无真实内容(修复项)
  conflictLocations?: string[]; // 同名多处且内容不一致时的候选来源目录(供 UI 选择)
};
```

## 4. core(`modules/skills.ts`)

### 4.1 `capture()` 解引用(修 bug)
定位源 root 后,抓取前:`const realRoot = fs.lstatSync(root).isSymbolicLink() ? fs.realpathSync(root) : root;` 再 `fs.cpSync(realRoot, dest, { recursive: true })`(保持 `dereference:false`,内部软链保留)。同名多处冲突时,支持按 `from`(用户所选来源目录)覆盖默认 root。

### 4.2 `discover()` 增强
- 列举每个候选时,对其"活动副本"求 `realpathSync`,据此算 `origin.location`(真实内容所在目录)与 `origin.linked`。
- `managed` 判定细化:`repo/skills/X` 若为**软链或无真实文件** → 不跳过,标 `needsRepair:true`(修复项);若为正常真实目录 → 跳过(已正确纳管)。
- **只收含 `SKILL.md` 的目录**;跳过 `.` 开头条目。
- 同名多 root:全部 `realpath` 一致 → 合并一行;不一致 → 保留既有 `conflict` note + 填 `origin.conflictLocations`。

### 4.3 `materializeSource(ctx, names)`(抽自 `apply()` step-1)
对每个 name:`rmSync(<sourceDir>/X)`(只删源处软链/目录) → `cpSync(repo/X → <sourceDir>/X)`。供"接管即解耦"复用,与 apply 同一逻辑(抽公共小函数,避免重复)。dry-run 不落地。

### 4.4 `unadopt(ctx, names)`(移出管理)
`rmSync(repo/skills/X)` + 从 `skills.yaml` 删该条目 + 从 `skills-links.json` 删该 skill 的记录(**不** `removeOwnedLink` 磁盘上的链、**不**动 `<sourceDir>/X` 与 IDE 目录)。纯"忘掉",完全可逆(可再被 discover 到)。dry-run 不落地。

## 5. server 端点(`packages/cli/src/server.ts`)

- 扩展 `GET /api/skills/discover` 响应:`candidates` 带 `origin`。
- 扩展 `POST /api/skills/capture` → **adopt**:body `{ names, decouple?: boolean = true, from?: Record<string,string> }`;`captureSkills` 后,`decouple` 为真则对成功项 `materializeSource`。回 `{ written, blocked, blockedDetail, materialized }`。
- 新增 `POST /api/skills/unadopt` body `{ names }` → `skillsModule.unadopt`;`cache.invalidateAll()`。
- 复用既有 `makeCtx`/缓存失效约定。

## 6. web(`views/Skills.tsx` + `api.ts` + i18n)

- 「发现」列表**按 `origin.location` 分组**(沿用 Projects 按 host 分组样式):每组标题=目录,组内逐项 checkbox。
- **软链组**(`origin.linked && location ∉ sourceDir`)挂通用提醒:
  > 这些 skill 的真实内容在 `<目录>`,是软链接进来的。接管会把内容复制进你的仓库;若该目录另有程序在自动管理,接管后请关掉它的自动管理,否则两边会持续互相覆盖。
- `needsRepair` 项显示「需修复」徽标,按钮文案「修复」而非「接管」。
- 同名冲突项:组内小单选(radio)让用户选 `conflictLocations` 之一作为来源。
- 选中 → 「接管/修复」→ **批量确认框**:dry-run 预览(将复制的文件数/大小、来去路径)、软链组单独列出 + 上面提醒、密钥/过大将跳过的提示;**默认勾「立即生效(脱离原工具)」**(= decouple),可取消。确认 → `adoptSkills(names,{decouple,from})` → 成功后**重扫 discover** + 刷新已管理视图;blocked 项留在原地并标原因。
- 「已管理」表每行加**「移出管理」**入口(确认弹窗:说明只是 Roost 停止跟踪,不删本地文件)→ `unadoptSkills(names)`。
- `api.ts`:`discoverSkills()` 返回带 `origin`;新增 `adoptSkills`、`unadoptSkills`;i18n 加 `skills.adopt.*`(en+zh)。

## 7. 测试(TDD 先行)

- **core / 真实 fs(`modules/skills.test.ts`)**
  - capture 一个**软链目录** → `repo/skills/X` 是**真实目录**(非软链)、含真实内容、内部软链保留;源软链目标(模拟 cc-switch)**未被破坏**。
  - discover 分类:bare→`linked:false`;软链→`linked:true` 且 `location` 为解析目录;`repo` 存成软链的→`needsRepair:true` 被列出;无 `SKILL.md` 的目录与 `.` 条目被排除;同名多处内容一致→合并一行,不一致→带 `conflictLocations`。
  - `materializeSource`:源软链 → 调用后 `<sourceDir>/X` 为真实目录;dry-run 不落地。
  - `unadopt`:删 `repo/skills/X` + `skills.yaml`/`links.json` 记录;`<sourceDir>/X` 与 IDE 链**仍在**;dry-run 不落地。
- **server(`server.test.ts`,隔离临时 home)**:`/api/skills/discover` 返回含 `origin`;`/api/skills/capture` 带 `decouple` → 入库且源被 materialize;`/api/skills/unadopt` → 仓库条目消失、本地保留。
- **web(`Skills.test.tsx`)**:发现项按 `origin.location` 分组渲染;软链组显示提醒;`needsRepair` 显「修复」;接管经确认调用 `adoptSkills`;移出经确认调用 `unadoptSkills`(mock 断言)。
- 现有全套保持绿;浏览器验证:对真机 10 个"假纳管"之一走「修复」、对一个 bare 走「接管」、对一个走「移出管理」。

## 8. ADR

新增 **ADR-0019(纳入本地已有 skill + capture 解引用)** —— 扩展 ADR-0012:① capture 对顶层软链先解引用,真实内容入库(修数据正确性 bug);② discover 按解析出的真实目录分类并 surface 修复项(I8:不点名工具);③ `Candidate.origin` additive schema;④ 接管=capture+可选 materialize 源(脱离原工具),移出=忘掉而不删本地。无 core 架构/分层/selection schema 变更;仅 macOS。

## 9. 实现阶段(交由 writing-plans)

- Phase 1:ADR-0019 + `Candidate.origin`(shared)。
- Phase 2:core `capture` 解引用 + `discover` 分类/修复/SKILL.md 过滤 + `materializeSource` + `unadopt`,配齐真实 fs / dry-run / 守门测试。
- Phase 3:server adopt(decouple)/unadopt 端点 + discover origin + 注入测试(隔离 home)。
- Phase 4:web 分组/提醒/修复徽标/冲突单选/确认框(dry-run 预览)/移出入口 + api.ts + i18n + 组件测试 + 桌面重建 + 真机三类各验一遍。
