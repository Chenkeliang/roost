# Skills 冲突解决 — 设计(备份后接管)

- 日期: 2026-06-08
- 状态: 设计已确认,待写实现计划
- 关联: ADR-0012(skills 模块)、本设计新增 ADR-0014(冲突解决:备份后接管);spec 2026-06-08-roost-skills-module-design.md(§5 冲突语义)

## 1. 目标与范围

当 skills 矩阵某格为 ⚠️ 冲突(IDE 目标位置 `<home>/<target>/<skill>` 是用户自己的**真实目录**,非 Roost 软链)时,在 web UI 让用户**显式选择**把它**备份后接管**:把真实目录移到备份区,再建软链/拷贝指向规范源。结果该格变 ✅。

**IN**
- 单一解决操作:**备份后接管**(move 真实目录到 `~/.roost-backups/skills/<ts>/<target>/<skill>/`,再链)。
- 逐格(skill × target)解决;带确认弹窗。
- core 函数 + server 端点 + web 矩阵里的 Resolve 入口。

**OUT(YAGNI)**
- 不做"采纳我的版本为源""直接替换(不备份)""一键解决所有冲突"(用户只选了"备份后接管")。
- 不改 core 架构/模块契约/selection schema。仅 macOS(I9)。

## 2. 不变量符合性
- **I7 可逆**:用 `fs.rename`**移动**真实目录到备份(不是删除),完全可找回。dry-run 预览不落地。
- **只动用户显式确认的那一格**:守门确保仅对真实冲突目录动手,绝不碰软链/不存在的目标/Roost 自建链(延续 skills 模块"只删自己建的链"的安全原则)。
- core 零领域分支;新行为落在 skills 模块 + 一个端点。

## 3. core:`resolveConflict(ctx, skillName, targetId)`(在 `modules/skills.ts`)
签名:`resolveConflict(ctx: ModuleContext, skill: string, targetId: string): Promise<{ backedUp: string; linked: string }>`

步骤:
1. 解析 target(`loadSkillsTargets`)→ `dest = <home>/<target.path>/<skill>`。
2. **守门**:`lstat(dest)` 必须存在、是**真实目录**(非 symlink)、且 **不在** `state/skills-links.json`(非 Roost 自建)。否则抛错 `not a conflict`(不动手)。
3. 备份:`mkdir -p ~/.roost-backups/skills/<ts>/<targetId>/`;`fs.rename(dest, backupPath)`(跨设备 EXDEV 兜底:`cpSync` + `rmSync`)。
4. 物化规范源(若缺):仓库 `skills/<skill>` → `<sourceDir>/<skill>`(同 apply)。
5. 按该 skill 的 `effectiveSkill().method` 建软链(默认)或拷贝到 `dest`。
6. 记入 `state/skills-links.json`。
7. 返回 `{ backedUp, linked }`。
- dry-run(`ctx.dryRun`):只返回将要做的路径,不落地。

复用:备份路径约定、物化、symlink/copy、记 link 都与 apply 一致(抽共用小函数避免重复)。

## 4. server 端点
`POST /api/skills/resolve` body `{ skill: string, target: string }`:
- 调 `skillsModule.resolveConflict(makeCtx(false), skill, target)`。
- 成功 → `cache.invalidateAll()` → `{ ok: true, backedUp, linked }`。
- 守门失败(非冲突)→ 400 `{ error }`。

## 5. web UI(`views/Skills.tsx`)
- 矩阵中 `targetStatus === "conflict"` 的格:把 ⚠️ 徽标做成可点的 **Resolve** 控件(点 ⚠️ 或其旁的小按钮)。
- 点击 → **确认弹窗**(用 `t()` 文案):
  > 你在 `<home>/<target>/<skill>` 的现有目录将被**移动**到 `~/.roost-backups/skills/…`(可找回),并替换为指向规范源的软链。继续?
- 确认 → `resolveSkillConflict(skill, target)`(api.ts 新函数)→ 成功后 `getSkills()` 刷新 → 该格变 ✅。
- 文案强调"移动(可找回),不是删除"。
- api.ts 加 `resolveSkillConflict(skill, target): Promise<{ ok; backedUp; linked }>`;i18n 加 `skills.resolve.*`(en+zh)。

## 6. ADR
新增 **ADR-0014(skills 冲突解决:备份后接管)**——扩展 ADR-0012:经用户**显式确认**,Roost 可把目标 IDE 里用户的真实 skill 目录**移动到 `~/.roost-backups/`** 后接管(建链)。强调:移动非删除、逐格、守门只动真实冲突目录;不改架构/schema。

## 7. 测试
- **单元/真实 fs**(`modules/skills.test.ts`):
  - 真实目录冲突 → `resolveConflict` → 断言:①`~/.roost-backups/skills/<ts>/<target>/<skill>` 存在且含原内容;②`dest` 现在是软链且指向 `<sourceDir>/<skill>`;③`state/skills-links.json` 有该 link。
  - 守门:对"目标是软链 / 目标不存在 / 目标是 Roost 自建链"→ 抛错,且**不动**任何文件。
  - dry-run:不落地(备份与链都不创建)。
  - method=copy 时:接管后是真实拷贝而非软链。
- **server**(`server.test.ts`):`POST /api/skills/resolve` 对真实冲突 → 200 + backedUp/linked;对非冲突 → 400。
- **web**(`Skills.test.tsx`):冲突格渲染 Resolve 控件;点击经确认调用 `resolveSkillConflict`(mock 断言被调用)。
- 现有套件保持绿。

## 8. 实现阶段(交由 writing-plans)
- Phase 1:ADR-0014。
- Phase 2:core `resolveConflict` + 单元/真实 fs/守门/dry-run/copy 测试。
- Phase 3:server `/api/skills/resolve` + inject 测试。
- Phase 4:web Resolve 控件 + 确认弹窗 + api.ts + i18n + 组件测试 + 浏览器验证(对真实的 3 个冲突之一走一遍)。
