# Roost 前端视觉与交互系统(LOCKED)

- **状态**: LOCKED · 2026-05-30。变更走架构文档 §13 ADR。
- **设计语言**: Raycast 化——深色近黑 + 珊瑚红点睛 + 键盘优先 + 软圆角 + 克制而"脆"的动效 + 大量克制的精致细节。
- **设计档位(本产品覆写,非营销基线)**: Variance 3 / Motion 4 / Density 5。理由:它管配置与密钥,要稳重可信,不要"花"。
- **硬规则**: 禁 emoji(用 Phosphor 图标 + 彩色状态点);禁 Inter/衬线;禁霓虹外发光/营销级特效;尊重 `prefers-reduced-motion`;仅动 transform/opacity。

## 1. 设计 Token(锁定值)
**配色(暗色优先)**
```
bg        #0B0B0D       surface   #161618      border #232327(hairline,常透 60%)
text      #EDEDED       muted     #8A8A8E
accent(品牌/选中/焦点/主操作) = Raycast 珊瑚 #FF6363(大面积填充时降饱和)
状态(仅语义,与品牌分工):同步 emerald · 漂移 amber · 冲突 深红(区别于珊瑚)· 未纳管 zinc-500
浅色变体:bg #FAFAFA / surface #FFFFFF / border zinc-200
```
**字体**:`Geist`(UI)+ `Geist Mono`(路径/数字/hash/diff)。SF Pro 为原生可选。标题 `tracking-tight`。
**字号**:区块标题 11–12 大写+字距 muted / 行标题 13–14 / accessory 12–13 muted / 正文 14 / 页标题 18–20。字重 标题 500 · 正文 400 · 强调 600。
**间距/圆角**:4px 基栅;行高 ~40;行内横向 padding 12–16;icon–文字 gap 8–10;面板内距 12–16;section gap 16–20。圆角 面板/卡 12–16 · 行/输入 8–10 · 图标 tile 8 · kbd 6 · pill full。
**高度/阴影**:border + 背景分层优先;少阴影,要用就染底色;**禁外发光**。列表用 `divide-y`/hairline,不堆卡片。
**动效**:状态 150ms、模态/HUD 200ms,**紧弹簧**(高 stiffness 低 overshoot)那种"脆"感;选中行移动用 `layout`;无空闲态无限循环。

## 2. 图标体系
- 库:`@phosphor-icons/react`(regular 默认 / fill 激活 / duotone 空状态)。尺寸 16(行内)/20(导航·按钮)/24(标题)/40–48(空状态)。
- **Raycast 招牌:圆角方形彩色图标 tile**(模块/命令用):20–28px tile,低饱和底色 + glyph(dotfiles 石板蓝 / packages 琥珀 / secrets 珊瑚 / appconfig 青 / projects 紫灰)。
- 语义映射(一概念一图标):主力 `Laptop` · 从机 `Desktop` · capture `FloppyDisk` · load `DownloadSimple` · 同步 `ArrowsClockwise` · 漂移 `GitDiff` · dotfiles `FileCode` · packages `Package` · appconfig `SlidersHorizontal` · projects `GitBranch` · 加密 `Lock`/密钥 `Key` · 扫描 `Radar` · 时间线 `ClockCounterClockwise` · 回滚 `ArrowCounterClockwise` · 预设 `Stack` · 体检 `Heartbeat` · 已纳管 `CheckCircle` · 未纳管 `CircleDashed` · 冲突 `WarningCircle` · 隐私 `ShieldCheck` · 设置 `GearSix` · 扩展 `PuzzlePiece` · 解除 `MinusCircle` · 添加 `PlusCircle`。
- 规则:一概念一图标;关键操作图标必配文字;色走 currentColor 继承状态;不混图标族。
- 品牌标记:自绘 SVG,两台设备 + 传输弧线(主力→从机)。

## 3. 信息架构(5 视图 + 键盘三件套)
| 视图 | 职责 |
|---|---|
| Overview | 双机状态卡 + 漂移摘要 + 快捷 Capture/Load + 模块健康点 |
| Manage | 「已纳管」+「可添加(扫描)」+ 预设 —— 可视化管理已备份内容 |
| Drift | 主力⟷从机 并排 diff(Monaco) |
| Timeline | 快照历史 + preview + 回滚 |
| Settings | 仓库/Profiles/age 后端/模块·插件;Doctor、扫描状态折叠为卡片 |

**键盘优先三件套(Raycast 精髓)**:
- **⌘K 命令面板**:跑任意命令,模糊搜索 + 图标 tile + 右侧快捷键 chip。
- **底部动作栏(常驻)**:主操作 + `Actions ⌘K` + 上下文 chip(`↵ Apply` · `⌘Z Undo` · `⌘. Cancel`)。
- **accessory + 全键盘**:行右侧 muted 等宽显示状态/路径/快捷键;方向键选、↵ 执行。

## 4. 组件清单(可复用)
MachineCard · ModuleSection(折叠)· ItemRow(名/路径 + 状态图标 + 悬显 [diff][unmanage])· CandidateRow(名+体积+建议分类+勾选)· DiffViewer(Monaco)· TimelineRail + SnapshotDetail · **DryRunModal**(应用/回滚前预览,逐项可退选,示"会先备份")· StatusBadge/Dot(色义见 token)· PresetPicker · SecretStatusPanel · LocalBanner(本地·不回传)· CommandPalette(⌘K)· ActionBar(底部)· Kbd(快捷键 chip)· HUD(toast)· Skeleton。

## 5. 交互与微交互
- **hover**:行 hover = 圆角高亮块(bg 提亮一档,rounded-8)120ms;**选中行** = 更明显圆角块 + 左侧 2px 珊瑚指示条;accessory/快捷键 chip 在 hover/选中提亮。按钮 `active:scale-[.98]`,次级按钮 hover 仅动边框/bg。
- **危险操作**(回滚/覆盖/解除):深红描边图标 + 必弹 DryRunModal 确认 + 明示"将先备份、可回退"。**绝无静默破坏**。
- **进度态**:capture/load 运行中才让状态点轻脉冲(`ArrowsClockwise` 旋转);空闲恒静态实心点。
- **加载**:骨架 shimmer(匹配行尺寸),不用转圈 spinner。
- **toast/HUD(Raycast HUD)**:底部居中紧凑圆角 pill,图标 tile + 短句(“Captured 12 items”/“Loaded to Mac mini”),150ms scale+fade,~2s 自动消失,非阻塞;错误用红 HUD 但克制、可点开详情。
- **tips**:footer/空状态轮换微提示(“Tip: 在任意行按 ⌘K 打开动作”),muted、可关。
- **长列表**(697 域/60 仓库):虚拟化 + 搜索过滤 + “显示高级”,绝不一次铺开。
- **空状态**:居中图标 tile + 一句 + 单 CTA + 一条 tip。
- **焦点**:珊瑚 2px offset 焦点环,全键盘可达。

## 6. craft 细节(那些"说不出来"的精致层)
- 面板顶 1px 内高光 `inset 0 1px 0 rgba(255,255,255,.04)` —— Raycast 式精致边缘。
- 分隔用 hairline(border 透 60%),不用粗线。
- kbd chip:小号 mono、1px 边、圆角 6。
- 选中优先"圆角高亮块"而非整行满色(Raycast 标志)。
- 区块标题:小号大写 + 字距 + muted。
- accessory 右对齐 muted,路径/数字用 mono。
- 行内图标统一 20px、gap 8px、光学对齐。

## 7. 关键线框(emoji-free)
```
Overview
┌ Roost ───────────────────────────  sync 2m ago · [local] ┐
│ [Overview] Manage Drift Timeline Settings                   │
│ ┌ Laptop 主力 MacBook Pro ─┐ ┌ Desktop 从机 Mac mini ──┐    │
│ │ ● 已同步   12 项         │ │ ▲ 3 漂移   12 项        │    │
│ │ capture 2m ago           │ │ load 1d ago             │    │
│ └──────────────────────────┘ └─────────────────────────┘    │
│ [FloppyDisk Capture 主力]   [DownloadSimple Load→从机]      │
│ 模块: dotfiles● packages● appconfig▲ projects● secrets[lock]│
│ ────────────────────────────────────────────────────────── │
│ footer:  ↵ Capture   ·   Actions ⌘K   ·   ⌘Z Undo           │
└─────────────────────────────────────────────────────────────┘

Manage
│ [已纳管 12] [可添加(扫描)]        Stack 预设▾   搜索…      │
│ ▾ dotfiles (8)                                  ● synced    │
│   FileCode  ~/.zshrc          track     [diff][unmanage]    │
│   Lock      ~/.config/env.sh  encrypted [diff][unmanage]    │
│ ▸ projects   ⚠ 1 无 remote · 14 未提交                      │
│ ▸ secrets (5)   Radar 扫描: 无明文泄露                       │

Drift / Timeline
│ Drift  主力 ⟷ 从机        [应用选中→从机 (dry-run)]         │
│ [x] com.apple.dock  仅主力有   ▸ Monaco 并排 diff           │
│ Timeline  ●─●─●─◍(now)  hover: “改 VSCode 字体 +3 brew”     │
│           选中快照  [Preview]  [Rollback (dry-run)]         │
```

## 8. 前端实现约束(P3 落地时遵守)
栈:React + Vite + Tailwind + Radix/shadcn(必须改默认 radii/色/影以贴本系统)+ Monaco + React Query + SSE。性能:transform/opacity 动画、虚拟化长列表、骨架替代 spinner。可达性:键盘全可达、焦点可见、reduced-motion。实现时启用 frontend-design/design-taste-frontend 技能。
