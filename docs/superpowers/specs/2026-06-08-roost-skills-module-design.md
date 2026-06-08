# Roost `skills` 模块 — 设计(跨 IDE skills 备份 + cc-switch 式软链分发)

- 日期: 2026-06-08
- 状态: 设计已确认,待写实现计划
- 关联: architecture.md(I1 薄编排 / I3 分层 / I4 模块是唯一扩展点 / I6 密钥三禁 / I7 apply 可逆 / I8 零硬编码 / I9 仅 macOS / §4 SyncModule 契约 / §7 扩展契约 / §10 macOS 规则)、ADR-0012(本设计要求新增)
- 调研来源: cc-switch(farion1231/cc-switch)skills 管理模型

## 1. 目标与范围

新增一个 Roost 模块 `skills`,把跨 IDE/Agent 的 skills 目录备份进配置仓库,并在新机以 **cc-switch 式逐个 skill 软链(可选拷贝)** 分发到各 IDE 的 skills 目录。

**IN(本设计覆盖)**
- 备份:既支持单一规范源(`~/.agents/skills`),也支持从各 IDE 的 `skills/` 目录归集。
- 分发:逐个 skill 软链(默认)或拷贝(可选)到各启用的 IDE 目标目录。
- 目标目录表(catalog)为可覆盖数据文件(I8);默认内置 cc-switch 那套。
- **逐 skill 开关 + 逐 skill×IDE 启用管理**:每个被管理的 skill 可整体 enable/disable;且可按 IDE 粒度选择在哪些 IDE 激活(同一 skill 可只链进 Claude、不进 Codex)。"disable"= 取消软链/拷贝、停用,但**仍保留在仓库备份**(仍受管,只是不激活),与 Remove/unmanage(彻底不管)区分。
- 可逆 apply(默认 dry-run、覆盖前备份)、冲突检测、只删 Roost 自建的软链。
- CLI 接入 + web 新增 Skills 管理页(含 skill×IDE 启用矩阵)。

**OUT(明确不做)**
- 边界仅 `skills/` 子目录;**不**备份其他 agent 配置(CLAUDE.md / settings.json / MCP / rules)、**不**备份整个 agent 目录。
- 不管理 provider/API key 切换(那是 cc-switch 的另一块,不在本模块)。
- 不引入跨平台分支(I9);不改 core、不改 selection schema。
- 不做 skills 的远程 registry 搜索/安装(cc-switch 的 skills.sh 那套)。

## 2. 不变量符合性

- **I1/I3/I4**:作为一个 `SyncModule` 经 §7 扩展契约新增;core 零改动、零领域分支。
- **I6 密钥**:capture 前过 Secret Scanner 硬门;命中则拦下,不入库、不显形、不进日志。
- **I7 apply 可逆**:默认 dry-run;覆盖目标前先备份到 `~/.roost-backups/skills/<ts>/`。
- **I8 零硬编码**:目标目录默认值在代码里(`DEFAULT_SKILLS_TARGETS`),用户可用仓库数据文件覆盖。
- **I9 仅 macOS**:只处理 macOS 路径,无跨平台分支。
- **§10**:不 symlink plist(本模块不碰 plist);软链对象为纯文本 skills 目录,可逆。

## 3. 数据模型

```
配置仓库(= 备份事实源)
  <repo>/skills/<skill-name>/...        # 各 skill 内容,纯文件、git 跟踪
  <repo>/selection.yaml                  # modules.skills: [name, ...]
  <repo>/roost/skills.yaml               # 分发配方(可覆盖),随仓库到 B 机
本机
  规范本地源:<sourceDir>/<name>          # 默认 ~/.agents/skills;apply 时由仓库物化
  各 IDE 目标目录:逐个 skill 软链 → 指向 <sourceDir>/<name>
```

### 3.1 selection.yaml
`modules.skills: string[]` —— 被管理的 skill 名清单。`modules` 为 `Record<string, string[]>`,接受任意键,**无需改 schema**(已与 `dotfiles-encrypt` 同机制验证)。

### 3.2 目标目录 catalog(可覆盖,I8)
代码内默认 `DEFAULT_SKILLS_TARGETS`(沿用 `app-config-catalog` 的 merge-by-id 覆盖机制):

| id | 路径 | 说明 |
|---|---|---|
| `claude` | `~/.claude/skills` | Claude Code |
| `codex` | `~/.codex/skills` | Codex |
| `gemini` | `~/.gemini/skills` | Gemini CLI |
| `opencode` | `~/.config/opencode/skills` | OpenCode |

规范源 `~/.agents/skills` 是 `sourceDir` 默认值(见配方),既是归集来源之一,也是软链目标对象。用户可用 `roost/skills.yaml` 的 `targets` 增删/改路径覆盖。

### 3.3 `roost/skills.yaml` 配方(随仓库走,可共享)
```yaml
sourceDir: ~/.agents/skills      # 规范本地源(可改)
method: symlink                  # 默认分发方式 symlink | copy
targets: [claude, codex, gemini, opencode]   # 默认启用的 IDE 目标(id 取自 catalog)
skills:                          # 逐 skill 配置(键=skill 名,均可选,缺省继承上面默认)
  foo:
    enabled: true               # 整体开关;false=保留备份但不软链/拷贝(停用)
    targets: [claude]           # 仅在这些 IDE 激活(覆盖默认 targets)
    method: copy                # 覆盖默认 method
  bar:
    enabled: false              # 已备份但全局停用,不链进任何 IDE
```
这是**可共享配置**,随仓库到 B 机。catalog 默认值在代码,`skills.yaml` 只存默认选择 + 逐 skill 覆盖。

**三个开关层级**(从粗到细):
1. `selection.modules.skills` —— 是否**受管/备份**(进不进仓库)。
2. `skills.<name>.enabled` —— 受管的 skill 是否**激活**(链不链进 IDE);默认 true。
3. `skills.<name>.targets` —— 激活时**进哪些 IDE**;缺省继承顶层 `targets`。

"enable/disable 某 skill" 改第 2 层;"某 skill 在某 IDE 开/关" 改第 3 层;两者都不动备份(第 1 层)。

### 3.4 `state/skills-links.json` 本机链路状态(不入库)
```json
[{ "skill": "foo", "target": "claude", "path": "~/.claude/skills/foo", "kind": "symlink" }]
```
**per-machine 运行时状态**,记录"本机由 Roost 建立的链",是"只删自己建的链"的依据(见 §5)。放在 `state/` 下——`runInit` 写的 `.chezmoiignore` 已忽略 `state`/`state/**`,故**不随仓库走**,避免跨机冲突。每台机自建自记。

## 4. 操作语义(SyncModule 八方法)

- **index**(cheap):读 `selection.modules.skills` + 各 skill 在仓库是否存在 + 本机链路状态摘要。支撑仪表盘即时加载。
- **discover**:扫 catalog 中所有 IDE skills 目录 + `sourceDir`,列出尚未管理的 skill 文件夹。返回 `Candidate`(id=skill 名,附 `sources: string[]` 来源路径)。同名但内容 SHA-256 不一致 → 标 `conflict` 并列出冲突来源。**不自动扫盘**,仅命令/按钮触发。
- **capture**:对选中 skill,把内容从来源拷进仓库 `skills/<name>/`。写前过 **Secret Scanner 硬门(I6)**。同名多来源:内容一致→存一份;不一致→拦下报冲突,要求用户选保留来源。返回 `ChangeSet{ written, encrypted, blocked }`。
- **apply**(默认 dry-run,I7):
  1. 对**所有**受管 skill(第 1 层):仓库 `skills/<name>` → 物化到 `<sourceDir>/<name>`(覆盖前备份到 `~/.roost-backups/skills/<ts>/`)。备份本身不受 enable 影响。
  2. 解析每个 skill 的有效配置:`enabled`(默认 true)、`targets`(缺省继承顶层)、`method`(缺省继承顶层)。
  3. 分发:仅对 `enabled=true` 的 skill,逐个分发到其 `targets` 列出的 IDE 目标:默认 `symlink`(`<target>/<name>` → `<sourceDir>/<name>`),可选 `copy`。目标已存在先备份再替换;若目标是"真实目录(非 Roost 链)"→ 不覆盖、标 `conflict`。
  4. **收敛(reconcile)**:对 `enabled=false` 的 skill、或不在某 skill `targets` 内的 IDE,若 `state/skills-links.json` 里存有 Roost 之前建的链 → **移除该链**(停用即生效),并从清单删除。绝不碰非 Roost 建的目录。
  5. 记录新建链路进 `state/skills-links.json`(本机状态,见 §5)。
  返回 `ApplyResult{ applied, backedUp, skipped }`(skipped 含 disabled / 未选中 IDE / conflict)。
  > apply 是**幂等收敛**:enable/disable 或增删某 IDE 后重跑 apply,会把本机链路收敛到与配方一致(该建的建、该撤的撤)。
- **diff**:仓库 vs 本机(`sourceDir` + 各目标)按 SHA-256 内容比对,文本列出每个 skill 在每个目标的 新增/变更/缺失/已软链/冲突。
- **unmanage**:从 `selection.modules.skills` 移除;**只删 `links` 清单里 Roost 自建的链**;仓库历史不重写(沿用全局约定);从 `links` 移除对应项。
- **doctor**:`sourceDir` 是否存在;各 target 目录是否可写;有无 dangling symlink(源被删);有无"目标是真实目录而非 Roost 链"的冲突。返回 `Health[]`。

## 5. 软链可逆性与冲突处理(安全核心)

- **建链前备份**:目标位置已存在(真实目录或旧链)→ 先移到 `~/.roost-backups/skills/<ts>/<target>/<name>`,再建链/拷贝。
- **只删自己建的链**:`state/skills-links.json` 记录本机由 Roost 建立的每条链(skill/target/path/kind)。`unmanage`、重链(改 method/targets)时**只动该清单内的条目**,绝不碰 IDE 自带的真实 skill 目录。
- **冲突不静默**:apply 遇到"目标是真实目录"→ 跳过 + 标 `conflict`;UI/CLI 让用户决定(跳过 / 备份后接管)。
- **断链**:源被删导致的 dangling symlink 由 doctor 报出,不自动删除。
- **跨机**:`skills.yaml` 配方随仓库到 B 机;`load` 时按同一 `method`/`targets` 把规范源软链进 B 机各 IDE 目录(`state/skills-links.json` 为本机状态,B 机自建自记)。

## 6. CLI 界面

- 通用 registry 自动接入:`roost discover/capture/load/status/diff/unmanage skills`。
- 软链专属薄封装(便于单独重链,不必走全量 load):
  - `roost skills link [--copy] [--target <id>...]` —— apply 的分发部分(收敛)。
  - `roost skills unlink [--target <id>...]` —— 移除 Roost 自建链(按 `state/skills-links.json`)。
- 开关管理(改 `roost/skills.yaml` 后触发收敛):
  - `roost skills enable <skill>` / `roost skills disable <skill>` —— 第 2 层整体开关。
  - `roost skills enable <skill> --target <id>` / `disable <skill> --target <id>` —— 第 3 层逐 IDE 开关。
  - 改完后 `apply`(或 `skills link`)收敛本机链路。

## 7. web 界面(Skills 管理页)

新增 **Skills 页**,沿用其他模块页的 Selected/Discovered 双 tab + 现有视觉(Raycast token、Phosphor 图标、coral 强调)。

- **Discovered tab**:扫各 IDE 目录 + 规范源,列未管理 skill(标来源、标冲突),批量勾选 → capture。
- **Selected tab(skill × IDE 启用矩阵)**:已管理 skill 列表;每行一个 skill,左侧一个**整体 enable/disable 开关**(第 2 层),右侧各 IDE 一列、每格一个**开/关勾选**(第 3 层)+ 状态徽标(✅已软链 / 📋已拷贝 / ⚠️冲突 / ⛓️‍💥断链 / ⚪未启用)。每行可切 symlink↔copy、Remove(彻底不管)。改动写入 `roost/skills.yaml` 并触发收敛 apply。
  - disabled 的 skill 整行置灰,各 IDE 格不可勾(需先 enable);Remove 与 disable 视觉/语义区分明确。
- **配方区(页顶)**:`sourceDir` 路径输入、默认 method、默认目标 IDE 勾选(新管理的 skill 继承此默认)。对应 `roost/skills.yaml` 顶层。
- **后端**:`server.ts` 新增 `/api/skills` 系列端点(沿用现有路由模式):
  - `GET /api/skills`(index:已管理 + 链路状态)
  - `GET /api/skills/discover`
  - `POST /api/skills/capture`
  - `POST /api/skills/link`(body: targets/method,触发收敛) / `POST /api/skills/unlink`
  - `POST /api/skills/toggle`(body: `{ skill, enabled }` 第 2 层 或 `{ skill, target, enabled }` 第 3 层;写 `roost/skills.yaml` 后收敛)
  - `GET /api/skills/config` / `POST /api/skills/config`(读写顶层配方)
- web `api.ts` 加对应函数;i18n 加 `skills.*` 键(en + zh)。

## 8. 密钥(I6)

capture 路径接现有 Secret Scanner(`packages/core/src/secrets/scanner.ts`)硬门。skills 以 prompt/脚本为主、密钥风险低,但脚本可能埋 token,照例扫描;命中则拦下、报 blocked、不入库、不进日志。**不**对 skills 默认加密(纯文本应可读、可 git-diff);若某 skill 命中密钥,提示用户清理或单独标记加密(沿用 `dotfiles-encrypt` 机制,可选)。

## 9. 变更控制

新增模块属范围扩张 → **需新增 ADR-0012(skills 模块 + 软链分发)**,声明:经 §7 扩展契约新增 `SyncModule`;记录"软链式 apply"这一新行为;不改 core、不改 selection schema、不引入跨平台;仅 macOS。实现计划第一步即落 ADR-0012。

## 10. 测试矩阵(每模块三类 + 真实往返)

- **单元**:catalog 加载与覆盖(merge-by-id);SHA-256 内容比对;`links` 记录/读取;冲突判定(真实目录 vs Roost 链);discover 同名多来源归并;**有效配置解析**(enabled/targets/method 的默认继承与逐 skill 覆盖)。
- **dry-run**:apply 只产计划、不落地(无文件/链改动)。
- **幂等 + 收敛**:重复 apply 不重复建链/备份;`disable` 某 skill 后 apply 撤掉其链;某 IDE 从 targets 移除后 apply 撤该 IDE 链;`enable`/重新加入后 apply 复建——本机链路始终收敛到配方。
- **真实软链往返**:建链 → 读 link target 正确 → disable+apply 撤链(确认只撤 Roost 自建、非 Roost 目录不动)→ enable+apply 复建,用真实临时目录。
- core 禁联网。

## 11. 实现阶段(交由 writing-plans 细化)

- Phase 1:ADR-0012 + catalog 数据(`DEFAULT_SKILLS_TARGETS` + `loadSkillsTargets` 覆盖)+ 配方读写(`roost/skills.yaml`,含逐 skill `enabled/targets/method`)+ **有效配置解析**(默认继承+覆盖)+ 单元测试。
- Phase 2:`skills` 模块(discover/index/capture/status/diff/unmanage/doctor)+ 单元/dry-run/幂等测试;注册进 `defaultRegistry`。
- Phase 3:apply 软链/拷贝分发 + **收敛(按 enabled/targets 建链与撤链)** + 备份/冲突/`state/skills-links.json` 记录 + 真实软链往返与收敛测试。
- Phase 4:CLI(`skills link/unlink/enable/disable` + 通用接入)。
- Phase 5:web Skills 页(skill×IDE 启用矩阵 + 整体开关 + 配方区)+ `/api/skills` 端点(含 `toggle`)+ api.ts + i18n + 组件测试 + 浏览器验证。
