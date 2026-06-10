# Skills 页面重设 — 设计(冷静默认 · 响亮例外 + 目标管理)

- 日期: 2026-06-10
- 状态: 设计已确认,待写实现计划
- 关联: ADR-0012(skills 模块)、ADR-0019(纳入本地 skill);spec 2026-06-08-roost-skills-module-design.md、2026-06-09-roost-adopt-local-skills-design.md(本设计**叠在** `feat_adopt-local-skills` 之上,因改动同一批文件)。
- 设计语言: frontend.md(Raycast 化,coral #FF6363 克制使用,Geist/Geist Mono,Phosphor,克制动效)。

## 0. 动机

「已管理」tab 当前是矩阵:`Skill | 启用 | Claude Code | Codex | Gemini CLI | OpenCode | 软链/拷贝 | 移出`。每行 ~5 个 coral 标记,24 个 skill ≈ **145 个同色对号**。强调色被当默认态用 → 真正的例外(冲突/断链/需修复/部分覆盖)无法跳出。同时缺两类控制:**不给某工具开某 skill** 的清晰入口,以及**自定义目录**作分发目标。

(已核实:`/api/skills` 返回 24 个**唯一** skill,无重复——截图里的重复行是 adopt 改写仓库工作树时的瞬时态,非 bug,不处理。`loadSkillsTargets` 已支持用 `roost/skills-catalog.yaml` 覆盖/新增目标,但**无保存入口**——目标管理是真正的新后端。)

## 1. 目标与范围

把「已管理」从满屏对号的矩阵改成**冷静列表 + 按需细化**,并补齐 per-tool 与自定义目标控制。

**IN**
- **覆盖格**:4 列 per-tool → 1 格 `n/m · 方式` + m 个小段点;**按期望集算覆盖**(见 §3)。
- **摘要条**:把共性说一次("24 skill · 全部启用 · 均软链至各自目标")。
- **per-tool 弹层**:点覆盖格 → 列全部目标,逐个开关(在/不在期望集)+ 状态 + 方式。复用现有 `toggleSkill(name, enabled, targetId)`,**零新后端**。
- **行尾 `⋯` 菜单**:收纳 `移出`、`方式`(从常驻列移走)。
- **搜索**:已管理 tab 加筛选(对齐发现 tab)。
- **目标管理**(新后端):core `saveSkillsTargets` + server `POST /api/skills/catalog` + 顶部「管理目标」面板(增删改自定义目标;内置 4 个可改路径/标签、不可删)。
- **色彩纪律**:中性灰=健康;琥珀=断链/drift;coral=冲突 / 唯一主 CTA;压暗=停用。

**OUT(YAGNI)**
- 不做「只给单个 skill 链到一次性怪路径」(共享目标够用;以后可加)。
- 不改 skills 真相源(仍 `skills.yaml` + `repo/skills` + `skills-links.json`)、不改 `SkillTarget` schema、不动 selection 语义。
- 不做矩阵/虚拟滚动等过度工程;仅 macOS(I9)。

## 2. 不变量符合性
- **I8 强调色克制**:coral 只标例外与唯一主操作;默认态中性。目标管理按目录、不点名工具。
- **I7 可逆**:删目标只从 catalog 移除 + 下次 apply 按既有 reconcile 清理 Roost 自建链;**绝不删用户的目标目录**。所有写入经确认。
- **I3 分层**:新增只落 skills 模块(`saveSkillsTargets`)+ 一个端点 + web;core 零领域分支。
- **无 schema/架构变更 → 无需新 ADR**(见 §7)。

## 3. 覆盖度语义(关键)

- 每个 skill:`effective.targets` = **期望分发集**;`links` = 实际链接(每目标 symlink/copy/缺失/冲突)。
- 覆盖格 `n/m`:`m = |期望集|`,`n = 期望集中健康链接数`。
  - `n === m` 且方式统一 → **中性灰**,安静(如 `4/4 · 软链`)。一个故意只放 2 个工具的 skill 显示 `2/2`(满覆盖),**不**显示 `2/5`。
  - `n < m`(某期望目标断链/缺失)→ 琥珀,`3/4 · 1 断链`。
  - 某期望目标处是**非 Roost 真实目录**(冲突)→ coral,`冲突`。
  - `enabled === false` → 整行压暗,格显 `—`。
- m 个小段点:实心=健康、空心=期望但缺、琥珀/coral=断链/冲突。目标多(>6)退化为纯比例数字。

## 4. web 重设(`packages/web/src/views/Skills.tsx`)

**行锚点(左→右):** `⬡ 名称(Geist Mono)` · 覆盖格 · 行尾 `⋯`。停用行压暗 + 「停用」小标签。

**覆盖格(`CoverageCell`,新组件):** 渲染 `n/m` + 段点 + 方式摘要;颜色按 §3;点击打开 per-tool 弹层。

**per-tool 弹层(`SkillTargetsPopover`,新组件):** 锚定覆盖格;列 `loadSkillsTargets()` 的**全部目标**,每行:`Switch`(in/out 期望集)+ 状态徽标 + 该行方式选择;冲突项给「解决」(复用现有 `resolveSkillConflict`)。Switch → `toggleSkill(name, on, targetId)`;方式 → 现有 `saveSkillsConfig`。

**摘要条 + 搜索:** 顶部 recipe 区下方一行摘要(计数从 `getSkills()` 派生);已管理 tab 复用 adopt 的筛选输入模式。

**`⋯` 行菜单:** Phosphor `DotsThree` → `移出`(`unadoptSkills`,带现有确认)、`方式`(快捷切 symlink/copy)。把当前常驻的「方式列」「移出列」撤掉。

**i18n:** 新增 `skills.coverage.*`、`skills.targets.*`(en+zh)。

## 5. 目标管理(自定义目录)

**core(`packages/core/src/skills-catalog.ts`):** 新增 `saveSkillsTargets(repoDir, targets: SkillTarget[])`,把**相对内置的覆盖/新增**写 `roost/skills-catalog.yaml`(内置项仅当被改才写;纯新增直接写)。`loadSkillsTargets` 已做合并,无需改。导出。

**server(`packages/cli/src/server.ts`):** `POST /api/skills/catalog` body `{ targets: SkillTarget[] }` → `saveSkillsTargets(repoDir, …)` → `cache.invalidateAll()` → `{ ok: true }`。

**web(`TargetManager` 弹窗 + `api.ts`):** 顶部「管理目标」入口 → 列表(label / 目录 / 默认方式;内置带 `内置` 标、可改路径与标签、不可删;自定义可增删改)。新增行:`名称` `目录` `方式`。`api.ts` 加 `saveSkillsTargets(targets)`。

**校验与安全:**
- 目录非空、展开 `~`、**不**强制已存在(apply 时建);名称→id 走 slug(冲突则报错)。
- **删目标**:仅从 catalog 移除;其下 Roost 自建链在下次 apply 由现有 reconcile 清理;**不删用户目录本身**;UI 给确认文案说明这点。

## 6. 色彩与排版
- 中性 zinc 为默认;琥珀 `#f0b352`(已用)= 需关注;coral `#FF6363` = 冲突 / 唯一主 CTA;压暗 = 停用。
- Geist Mono:skill 名、`n/m`、比例数字。密度略收(4→5)。Phosphor 图标,禁 emoji。

## 7. ADR 判定
**不新增 ADR。** `SkillTarget` schema 不变;只是给**已存在且已文档化**的可覆盖数据文件(`skills-catalog.yaml`)加一个保存端点 + UI,落在现有 UI→server→core 分层内,无新模块、无契约变更。若治理上认为「新增 catalog 写端点」值得记一笔,可补一份短 ADR——本设计判定不需要。

## 8. 测试(TDD)
- **core(`skills-catalog.test.ts`,新建):** `saveSkillsTargets` round-trip(新增自定义目标→`loadSkillsTargets` 能读回且与内置合并;改内置路径→覆盖生效;删自定义→消失)。
- **server(`server.test.ts`):** `POST /api/skills/catalog` 写入并经 `loadSkillsTargets` 反映(隔离临时 repo)。
- **web(`Skills.test.tsx`):** 覆盖格按 `n/m` 渲染、颜色态正确;点覆盖格开弹层、Switch 调 `toggleSkill(name,false,target)`;`⋯` 菜单的移出走确认调 `unadoptSkills`;目标管理增/删调 `saveSkillsTargets`(mock `../api`)。
- 现有套件保持绿。

## 9. 实现阶段(交由 writing-plans;**分阶段,UI 先行**)
- Phase 1:覆盖格 + 摘要条 + 色彩纪律(纯前端,先把「红墙」干掉)。
- Phase 2:per-tool 弹层 + `⋯` 菜单 + 搜索(仍纯前端,复用 `toggleSkill`/`unadoptSkills`)。
- Phase 3:core `saveSkillsTargets` + server `/api/skills/catalog` + 注入测试。
- Phase 4:`TargetManager` 面板 + `api.ts` + i18n + 组件测试 + 桌面重建验证。
