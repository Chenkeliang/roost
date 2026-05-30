# Roost 仪表盘重构 — 设计文档(Design Spec)

- **日期**: 2026-05-31
- **状态**: 草案(DRAFT,待 owner 评审)
- **配套**: `docs/adr/0006-tiered-on-demand-discovery.md`(契约改动);受 `2026-05-30-roost-architecture.md`(LOCKED · I1–I10/§4 SyncModule)约束。
- **范围**: 重构本地 Web 仪表盘(`packages/web` + `packages/cli` server)。**不改** core 领域逻辑边界、密钥模型(I6)、`selection.yaml` 等数据 schema(profile-scoped selection 另见 ADR-0005)。

---

## 1. 问题与目标

**现状三大病:**
1. **越界扫描**:进 Manage/Overview 就 `/api/discover` 全量扫整个 home、`/api/status` 无条件外呼 brew/chezmoi → 冷调 24s,且"没问就扫你整盘"。
2. **页面空心**:除 Aliases & Env 外,页面要么空(没纳管就 "No modules tracked")、要么只想用"计数"充内容 → 没有实质内容。
3. **死/占位数据**:Overview 两张机器卡是占位(跟随机写死 `Mac mini`、两卡同一份本机计数、主/副无真实来源、`health.name` 写死 `roost`);Settings 文档链接是假 `your-org`、且无文档站入口。

**目标:**
- **内容优先**:每页以"你已纳管的真实配置"为主体(从仓库读,便宜且丰富)。
- **按需 + 主动权在用户**:贵操作(全盘扫、brew/chezmoi 比对)只在用户显式触发时跑。
- **诚实**:不摆假数据;没有的就明确空态。
- **守架构**:薄编排(I1)、唯一 exec 出口(I3)、模块为唯一扩展点(I4)、discover 体积守卫(M4);契约改动走 ADR。

---

## 2. 设计原则

1. **实质内容 = 已纳管配置**,来自仓库文件(`selection.yaml`/`env.yaml`/`Brewfile`/`projects.yaml`/`appconfig.yaml`/chezmoi managed/git log)——**全部便宜**,进页面即时加载。
2. **三档信息成本**:T0 可用性(`which`/`existsSync`,≈0)· T1 索引(已纳管内容,便宜)· T2 全量发现(扫盘/外呼,**仅按需**)。默认只到 T1。
3. **发现是"加东西"的动作**,不是页面存在的理由;发现结果是**可勾选的真实条目**,不是计数。
4. **失败安全/优雅缺失**:工具没装(brew/mas/op/rbw)→ 明确空态,不报错不卡。
5. **不摆假**:无第二台机器就只显本机;无数据就给可操作的空态。

---

## 3. 信息架构(IA / 导航)

当前是顶栏 6 个平铺 tab;模块升级为富页后会变多 → 改**左侧分组侧栏**(解决"路径复杂"):

```
Roost
├─ Overview            (跨模块:机器 + 总览 + 动作)
├─ MODULES
│   ├─ Dotfiles
│   ├─ Packages
│   ├─ Projects
│   ├─ App Config
│   └─ Aliases & Env   (已是富页范式)
├─ Drift               (跨模块:漂移 + diff)
├─ Timeline            (仓库快照历史)
└─ Settings            (仓库/密钥/模块/隐私/文档入口)
```

- 侧栏整宽可折叠;内容区沿用 `maxWidth:1080` 居中容器;**顶栏/侧栏与内容对齐**(修 #6)。
- 顶栏保留:品牌、`local` 徽标、**语言切换(P2)**、**⌘K 命令面板**、**文档入口**(→ 文档站)。

---

## 4. 发现模型(分层按需)→ ADR-0006

给 `SyncModule` 增加**一个可选方法** `index?(ctx)`(T1,便宜),保留 `discover()`(T2,按需全量)。向后兼容(未实现 `index` 的模块退化为"只有 discover")。

```ts
// @roost/shared(新增类型;详见 ADR-0006)
interface ModuleIndex {
  available: boolean;          // T0:工具在否/模块在此机器有意义否
  reason?: string;             // 不可用原因(如 "Homebrew 未安装")
  managed: number;             // 已纳管条数(从仓库读)
  summary?: Record<string, number | string>; // 模块自定义抬头(如 projects: {discovered?, withRemote?})
}
interface SyncModule {
  // ...既有 7 法不变...
  index?(ctx: ModuleContext): Promise<ModuleIndex>;   // 新增,可选,必须便宜&有界
}
```

- **`index()` 规则(MUST)**:只读仓库 + 便宜本机探测(`which`/`existsSync`/读 `.git/config`);**禁止**全盘扫、禁止 `brew bundle`、禁止逐项 git 子进程。
- **`discover()`**:维持"全量候选",但**只在用户点[扫描]时调用**(per-module),并受 M4 体积守卫(已加 MAX_VISITS)。
- **server**:`GET /api/index`(全模块便宜索引,进页面调,已被 25s 缓存覆盖)、`GET /api/discover?module=<name>`(按需、单模块、全量)。`/api/status` 仍存在但加守卫(§7)。

---

## 5. 逐页设计(目的 / 内容+来源 / 按钮+交互 / 状态 / 技术)

> 约定:**[主按钮]** = coral 实心;**[次按钮]** = 描边;行内图标按钮 = 编辑/删除/移动等。所有写操作 dry-run 优先或可撤销(I7)。

### 5.1 Overview(总览)
- **目的**:一眼看清"这台机器是谁、管了什么、和仓库/另一台是否同步、最近做了什么",并提供主动作。
- **内容(来源)**:
  - **本机卡**(真实):hostname(`os.hostname()` 经 `/api/health`)、角色(primary/follower,见 §6)、已纳管总数(`selection` + env.yaml 计数)、最近一次 capture/load(git log / state)。
  - **其它机器卡**:**有真实 per-host state 才显**(`/api/machines` 的 `states[host]`);无 → 一张"暂无其它机器,在另一台运行 `roost load` 后出现"的提示卡(不摆假卡)。
  - **模块总览**:每模块"已纳管 N 项 + 健康点"(便宜,来自 index)。
- **按钮+交互**:
  - **[Capture]**(主):`POST /api/capture` → 把已选项写入仓库;成功 HUD + 失效缓存 + 刷新。`⏎` 快捷键。
  - **[Load (dry-run)]**(次):`POST /api/load`(apply=false)→ 预览将对本机做的改动(逐项 + diff),再给 **[Apply]** 二次确认才真正应用(I7)。
  - 模块总览每项点击 → 跳到对应模块富页。
- **状态**:loading 骨架;无纳管 → "从某个模块开始纳管"引导(链到模块页)。
- **技术**:`/api/health`(加真 hostname)+ `/api/index`(新)+ `/api/machines`。**不再**在此触发 `/api/discover`。

### 5.2 Dotfiles
- **目的**:管理纳入备份的配置文件。
- **内容(来源)**:**已纳管文件列表**(chezmoi managed + selection,便宜):路径、分类(shell/git/editor…)、是否加密。点行 → 看内容/与本机 diff(按需 `/api/diff?module=dotfiles`)。
- **按钮+交互**:
  - **[扫描更多文件]**(次):`/api/discover?module=dotfiles` → 列出发现候选(勾选框)→ **[加入纳管]**(`/api/selection/add`)。带加载态。
  - 行内:**[移除纳管]**(`/api/selection/remove`,二次确认 + 提示 git 历史不清)、**[查看 diff]**(按需)。
- **状态**:未纳管 → 空态 + 醒目 **[扫描更多文件]**;扫描中 → "扫描中… N 项"。
- **技术**:index 读 chezmoi managed(便宜);discover 按需;diff 按需。

### 5.3 Packages(Homebrew)
- **目的**:管理 Homebrew formulae/casks + Mac App Store 应用。
- **内容(来源)**:**解析仓库 `Brewfile`** 分组展示(formulae / casks / mas),真实清单(读文件,便宜)。
- **可用性**:`which brew` 不在 → **"未安装 Homebrew"空态**(给安装指引,绝不报错/不扫)。
- **按钮+交互**:
  - **[从本机导入全量]**(次,需授权):点击 → 确认弹窗(说明将运行 `brew bundle dump`)→ 授权后 `POST /api/capture`(packages)拉全量写 Brewfile。带加载态。
  - **[检查是否都已安装]**(次):按需 `brew bundle check`(贵)→ 标注每项 installed/missing。
  - 行内:增/删 Brewfile 条目(写仓库)。
- **状态**:无 Brewfile → "尚未纳管软件包,[从本机导入全量]";brew 缺失 → 安装指引空态。
- **技术**:index = `{available: which brew, managed: Brewfile 条数}`(便宜,**不调 brew**);全量/check 按需且需授权确认。

### 5.4 Projects(你的 #1 重点)
- **目的**:管理"要随身带"的 git 项目(换机一键重建)。
- **真实场景(首台真机审计)**:95 仓库 · 无远端 0 · SSH 80/HTTPS 15 · 主机分布 `gitlab.luojilab.com`×72、`github.com`×20、`code.qschou.com`×3 —— **异构远端(多内网 GitLab + GitHub)是常态,设计必须按此**。
- **内容(来源)**:
  - **已纳管项目**(读 `projects.yaml`,便宜):名字、**远端地址(原样保留 SSH/HTTPS)**、**本地文件夹路径**、本地在否、**远端主机**。
  - **可发现项目**(按需扫描):有界遍历 home 找 `.git`(MAX_VISITS),**读 `.git/config` 拿远端(不调 git 子进程)**;列出文件夹 + 远端 + 解析出的主机。
- **按主机分组/筛选**:页面顶部 chip = `全部 / github.com / gitlab.luojilab.com / code.qschou.com / 无远端`(按实际主机动态生成),区分内网/公网、工作/个人。
- **按钮+交互**:
  - **[扫描本机 git 项目]**(次):`/api/discover?module=projects` → 列表(文件夹 + 远端 + 主机 + 协议 + 无远端标注),带加载进度("40/88")。
  - 每行:**[测试]**(`git ls-remote <remote>` 验"可达+可鉴权",按需单点;内网仓库借此暴露"需 VPN/无权限")· **[保存/纳管]**(写 `projects.yaml`,URL 原样)· 已纳管但本地缺失 → **[克隆]**(`git clone`,走 apply,失败逐个跳过+报告)。
  - 行内:编辑远端、移除纳管。
- **鉴权边界(诚实、不越界)**:SSH key / token / VPN 属用户环境,Roost **不存不管凭据**(I1 薄编排、I6 不碰密钥);只记 URL + 克隆 + 用 [测试]/恢复报告如实暴露可达性。`doctor` 可提示"N 个在内网主机,恢复需 VPN + SSH key"。
- **状态**:未纳管 → 空态 + [扫描本机 git 项目];扫描中 → 进度;无远端 → 标注"无法按清单恢复";测试结果 ✓可恢复 / ✗(VPN/权限)。
- **隐私**:`projects.yaml` 含内网仓库 URL(与 `inventory/` 同级敏感)→ 配置仓库须私有 + 公开前清洗。
- **技术**:index 读 projects.yaml(便宜);discover 有界扫 + 读 .git/config + 解析 host;test=`git ls-remote`(单点按需);clone=既有 apply 路径。

### 5.5 App Config
- **目的**:管理 macOS app 偏好域(`defaults`)。
- **内容(来源)**:已纳管域列表(读 `appconfig.yaml`,便宜)+ 来源 app。
- **按钮+交互**:**[扫描 app 偏好]**(按需发现)· **[录制(Learn Mode)]**(P2:开始录制 → 让用户在 app 改设置 → 抓变更域)· 行内增删纳管。
- **状态**:未纳管空态。**技术**:index 读 appconfig.yaml;discover/录制按需(经唯一 exec 调 `defaults`)。

### 5.6 Aliases & Env(已完成,作范式)
- 已是内容优先(搜索 + 统一列表 + 种类筛选 + 行内编辑 + secret 来源 age/op/rbw + 从 shell 导入)。本次仅:纳入侧栏 IA、复用统一加载态、i18n(P2)。

### 5.7 Drift
- **目的**:看本机与仓库(及跨机)哪里不一致。
- **内容**:**只列"已纳管且漂移"的项** + 展开 unified diff(+/- 着色)。
- **按钮+交互**:**[全部刷新]**(次,按需触发 status/diff 比对,贵)· 每项 **[查看 diff]**(按需)· (P2)**[以仓库为准应用]** / **[以本机为准捕获]**。
- **状态**:无漂移 → "全部同步"空态。**技术**:依赖 **status 守卫**(§7);diff 按需 `/api/diff`。

### 5.8 Timeline
- **目的**:仓库快照历史(每次 capture = 一个 git commit)。
- **内容**:git log(SHA/说明/相对时间,便宜)。**按钮**:(P2)**[回滚到此]**(目前只读,明确标注)。**技术**:`/api/timeline`(已真)。

### 5.9 Settings
- **目的**:配置与状态。**内容**:仓库路径、age key 状态、已注册模块、隐私声明(本地无遥测)。
- **按钮+交互**:**[使用文档]**(→ 文档站,修"无入口")· 文档链接改真(`Chenkeliang/roost`)· (P2)**语言切换** · (P2)**仓库切换/远端配置**(待 §"未决")。
- **技术**:`/api/health` + `/api/modules`(已真)。

---

## 6. 机器身份模型(去假)

- **真 hostname**:`/api/health` 返回 `os.hostname()`(替换写死的 `roost`)。
- **per-host state**:沿用 `state.ts`(每台机 capture/load 时把自己 state 写进仓库);`/api/machines` 读各 host 的真实 state(tracked/drift/lastAction)。
- **主/副角色**:**当前无真实来源**。P1:Overview **只显一张真实本机卡** + "暂无其它机器"。P2:引入"机器角色"(接 **ADR-0005** profile/机器画像),每台机记录自己是 primary/follower,Overview 按真实 state 渲染多卡 + 真·跨机漂移。
- **原则**:在有第二台真实 state 之前,**绝不摆假卡**。

---

## 7. 横切关注点

- **加载态(#4)**:统一 `<Loading label="Scanning projects… 40/88" />`;每个 T2 操作独立 loading,不阻塞页面外壳(页面先出,数据流入)。
- **缓存(已完成)**:`/api/status`、`/api/discover`(及新 `/api/index`)25s TTL,mutation 后失效。
- **status 守卫(#5,core)**:`packages.status` 在无 Brewfile / 未纳管时**不调 brew**;`dotfiles.status` 未纳管不调 chezmoi → 直接返回 untracked。冷调即快。
- **错误/空态**:工具缺失、无纳管、扫描为空 → 各有明确文案 + 可操作引导,绝不静默或假数据。

---

## 7A. 路径可移植性与机器覆盖(跨切面 · 关键)

> 核心问题:备份在**主机**采集、在**副机**应用——用户名/家目录/CPU 架构/工具路径都可能不同。设计必须假想各种场景:默认"自动对",差异处"可指定"。

**值的三类(采集时分类,决定如何存/还原):**
- **A 类 · 处处相同**:别名(`gs='git status'`)、`GOPROXY`、`GO111MODULE`、多数 env。原样存、原样应用。
- **B 类 · 家目录/架构相对**:`~/…` 下路径、brew 前缀。存**可展开形式**(`$HOME`、`$(brew --prefix)`),apply 时按副机解析。
- **C 类 · 机器特定**:必须因机而异(办公代理、某机独有路径、`.gitconfig` 邮箱、仅工作机的仓库)。**base + 机器覆盖**(Profiles/ADR-0005),dotfiles 另可用 chezmoi 模板。

**总策略:**
1. **默认家目录相对**:存 `~/go` 而非 `/Users/keliang/go`;apply 用副机 `$HOME` 还原 → 不同用户名自动对。
2. **工具路径交还工具**:nvm/`g`/brew/orbstack 的 PATH 由各自 init 设(已留在 rc、不进 Roost)→ 版本/架构差异天然消化。
3. **机器差异 → Profiles 覆盖(ADR-0005)**:同一项在不同机器取不同值/路径——这就是"可以指定"。
4. **采集时检测并建议**:遇 `/Users/<当前用户>/…` 字面量 → 自动建议改 `~`;遇版本固定/架构固定/`/Volumes/…` 的"机器味"路径 → 标注"机器特定,建议设为覆盖项"。

**假想场景 × 处理:**

| 场景 | 处理 |
|---|---|
| 副机用户名/家目录不同(`/Users/bob`) | 家目录相对(`$HOME`/`~`)→ 自动对 |
| Apple Silicon ↔ Intel(brew 前缀 `/opt/homebrew` vs `/usr/local`) | 不硬编码;`brew shellenv`/`$(brew --prefix)`;含前缀的 env 走 B 类 |
| node 版本路径(nvm)、Go(`~/.g/go`)、cargo | 工具自管 PATH;不存版本固定路径(已清 rc 硬编码) |
| `GOPATH=~/go` | B 类:存 `$HOME/go`,副机展开 |
| 外置盘/工作目录绝对路径(`/Volumes/Work/…`) | C 类:覆盖项或排除;诚实标注"无法自动移植" |
| 办公网代理 `HTTP_PROXY`(仅工作机) | C 类:work profile 设、home 不设(ADR-0005) |
| `RUN_ENV=testing` 别机不同 | C 类:profile 覆盖 |
| 同批仓库,副机想克隆到不同根(`~/work`) | projects 克隆基目录可配置 + 家目录相对 |
| 仅工作机存在的内网仓库 | profile-scoped selection(仅 work profile 纳管,ADR-0005) |
| app 只装在某台机 | appconfig/packages apply 时**优雅跳过**缺失项 |
| 密钥位置 | age key 家目录相对;**op/rbw 引用与主机无关**,各机从自己密码管理器取值 → 天生可移植 |
| `.gitconfig` 邮箱 work vs personal | chezmoi 模板按 hostname,或 profile |
| 软链接 / 非标准 `$HOME` | 仍按 `$HOME` 相对,存逻辑路径 |
| 副机无 VPN/权限(内网仓库) | clone 逐个失败跳过+报告;[测试] 提前暴露(§5.4) |

**当前两处缺口(待修):**
- env 值为单引号字面量,**无法表达会展开的家目录相对值** → 需支持 B 类 env 值安全展开(双引号 + C3 白名单)。我们写死的 `GOPATH=/Users/keliang/go` 即此问题。
- projects 存**绝对路径** → 改家目录相对 + 可配置克隆基目录。

**诚实限制:** 真正机器特定且无规律的路径(外置盘等)**无法自动移植**,只能显式覆盖或排除——Roost 检测并提示,但不假装能搬。

---

## 8. API 与契约改动汇总

| 改动 | 层 | 是否需 ADR |
|---|---|---|
| `SyncModule.index?()` + `ModuleIndex` 类型 | shared + core(各模块实现 index) | **是 → ADR-0006** |
| `GET /api/index`(全模块便宜索引) | cli server | 否(UI 层) |
| `GET /api/discover?module=`(按需单模块) | cli server | 否 |
| `POST /api/projects/test`(`git ls-remote`)、克隆走既有 apply | cli server + projects | 否(模块内既有能力) |
| `health.name` → 真 hostname;machines 用真 state | cli server | 否 |
| status 守卫(便宜短路) | core(各模块 status) | 否(行为收紧,不改契约) |
| 侧栏 IA、富页、加载态、对齐、文档入口 | web | 否 |
| web i18n 层(en/zh) | web | 否 |

---

## 9. 死数据整改清单
- `health.name` 写死 `roost` → 真 hostname。
- Overview 跟随机写死 `Mac mini`、两卡同计数 → 真 per-host state / 单本机卡 + 空态。
- Settings 文档链接 `your-org` → `Chenkeliang/roost` + 文档站入口。

---

## 10. i18n(提上日程,排 P2)
干净的 **web i18n 层**:`LocaleProvider` + `t()` + 字符串表(复用 core 的 en/zh locale 概念),顶栏切换 + `localStorage` 记忆。**排 P2 的理由**:P1 会重写大量视图,先翻译等于翻两遍;页面定型后再统一抽字符串最省、最干净。

---

## 11. 计划 P0–P3(含验收)

**P0 — 止血 + 去假(小)**
- [x] exec 修复、projects 扫描有界化、status/discover 25s 缓存(已完成、已上线)。
- [ ] status 短路守卫(#5);顶栏对齐(#6);`health` 真 hostname;Overview 单本机卡 + 空态(去假卡);Settings 文档链接改真 + **文档入口**。
- **验收**:冷调 status 秒级(无纳管时);Overview 无假数据;顶栏与内容对齐;能从仪表盘进文档站。

**P1 — 内容优先重构(核心)** · 各自 spec + **ADR-0006**
- [ ] `index()` 契约 + `/api/index` + 各模块 index;`/api/discover?module=` 按需化。
- [ ] 侧栏 IA;模块富页:**Projects(先)**→ Packages → Dotfiles → App Config。
- [ ] 加载态(#4)。
- [ ] **路径可移植性(§7A)**:projects 存家目录相对路径 + 可配置克隆基目录;env B 类值支持安全展开(`$HOME`);采集时检测 `/Users/<user>/…` 并建议改 `~`。
- **验收**:进任何模块页即时出已纳管真实内容;扫描/外呼仅按需;Projects 有远端/文件夹/[测试][克隆][保存] + 按主机分组;brew 缺失优雅态;采集的路径默认家目录相对、副机可还原。

**P2 — 多机真实化 + 富操作 + i18n**
- [ ] **Profiles/机器画像(ADR-0005)**:机器特定路径/值覆盖(§7A C 类)+ profile-scoped selection;据此实现**真主/副机 + 真跨机漂移**。
- [ ] Timeline 回滚;App Config Learn Mode;**web i18n(en/zh)**;Settings **「Git 远端与同步」面板**(查看/设置远端 + 领先落后 + Push/Pull)。

**P3 — 发布与桌面**
- [ ] Tauri 真构建 + 签名;`inventory/` 清洗;商标;文档站部署。

---

## 12. 已定稿决策 / 未决 / 风险 / 边界(诚实)

**已定稿(owner 评审中确认):**
- **IA = 左侧分组侧栏**(顶部横排 → 竖排 + "模块"分组),已认可。
- **"仓库切换" = Settings 的「Git 远端与同步」面板**(查看/设置配置仓库的 git 远端 + 领先/落后 + [Push]/[Pull] + 首次接 `roost init --github`),**不做**运行时多仓切换(小众、需改 server 作用域 + ADR,搁置)。排 P2。
- **i18n 排 P2**(P1 重写视图后再统一抽字符串)。
- **主/副机** P1 只显单本机真实卡 + "暂无其它机器"空态;真多机/角色待 P2(接 ADR-0005)。

**未决 / 风险:**
- **主/副角色**需要 ADR-0005(profile/机器画像)落地才能"真";在此之前不摆假。
- **P1 是大前端重构**;Aliases & Env 已铺范式,按模块逐页推进,每页可独立交付验证。
- `index()` 为可选、向后兼容;不强制所有模块同时实现。
- 不触碰 I6 密钥模型、不改 selection.yaml schema(profile-scoped 另走 ADR-0005)。
