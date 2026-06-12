# Roost 战略结论:AI 时代的精华能力与 cc-switch 定位

## 一、cc-switch 事实画像(它是什么/不是什么,带证据)

**它是什么:** 一个面向「同时使用多个 AI CLI 的重度用户」的 **provider 切换器 + 统一控制面板**。截至 v3.16.2(2026-06-08),它管理 7 款 AI CLI(Claude Code/Desktop、Codex、Gemini CLI、OpenCode、OpenClaw、Hermes),提供 50+ 预置 provider、本地代理热切换/故障转移/熔断、MCP 统一面板、用量 Dashboard、跨应用会话管理、Skills 分发(GitHub repo/ZIP + symlink/copy)。(来源: github.com/farion1231/cc-switch README + releases)

**它的「备份/同步」是什么:** 本机 SQLite 轮转备份(保留 10 份)+ 云文件夹同步(WebDAV/S3 兼容,v3.16.0→v3.16.2 连续两版扩展,是其当前主动投入方向)。同步范围仅限「providers、endpoint、MCP、prompt、skill、settings、proxy 表」。(来源: v3.16.2 release notes)

**它明确不是什么(对 Roost 关键):**
- **无加密**:密钥明文存 SQLite,云同步无内置加密层。第三方评测明确警告用户「API keys、relay endpoints、MCP servers 均为敏感配置」,需自行验证云文件夹安全。(来源: knightli.com 评测)
- **无版本历史/无 git**:云同步是文件夹级 push/pull,非 VCS;无任何「git 作为事实源」的 roadmap 表态。
- **无系统级覆盖**:不碰 dotfiles、shell 环境、macOS defaults/plist、brew/mise/chezmoi 编排、新机 bootstrap。仅限 7 款已列名的 AI CLI。
- **无密钥扫描硬门**:不阻止 API key 写入任何配置。

**它的用户在抱怨什么:** 最高反应 issue 是认证持久化失败(#404, 64 reactions)、配置切换后设置被覆盖、多账号管理(#4096)——本质是**数据可靠性焦虑**,而非功能不够多。(来源: github.com/farion1231/cc-switch/issues)

**诚实的冷水:** cc-switch 迭代极快(一个月两个大版本)、覆盖面持续扩张、98.7k★ 的社区动能是真实的。任何「在它的主场打它」的想法都不现实。

## 二、需求侧:真实存在且无人服务好的 jobs(带原话证据)

**JTBD-A:把 AI 开发环境一键迁到新 Mac。**
> 「Claude Code stores a rich set of data across your machine: global instructions, per-project memory, installed skills, plugins... Losing any of these means rebuilding your environment from scratch.」— jtklinger/claude-code-backup-guide

现有方案全是手写 tar 脚本(mcpware/claude-code-backup)或 Dropbox symlink。连最细致的 Mac setup 指南(Robin Wieruch、swyx 2025/2026)都把 MCP/CLAUDE.md 迁移当黑盒跳过——这是产品级空白。

**JTBD-B:防止 MCP/Claude 配置被静默抹除,可一键回滚。**
> 「Claude Desktop is repeatedly deleting or overwriting the claude_desktop_config.json file... This has occurred dozens of times.」— issue #34359(被官方标 invalid/stale 关闭)
> 「1.5 days lost rolling out MCP to 15 staff machines... the silent overwrite made this nearly impossible to debug.」— issue #59368

官方明确不修,需求由第三方填补。git 历史天然提供 undo/restore,cc-switch 的轮转备份做不到逐变更回溯。

**JTBD-C:团队共享 AI 配置而不泄露密钥。**
> 「Without a centralized strategy, teams end up with fragmented prompt libraries, duplicated effort, and inconsistent AI outputs.」— Medium (Aayush Ostwal)

而当前共享方式(推 .mcp.json 进 git)无门控,CVE-2026-21852 已证明「仅打开恶意 repo 即可外泄 API key」(Check Point Research)。市场上无任何「共享 + 不明文入库」双满足方案。

**JTBD-D:把 API key 从明文中移出。** 2025 年公开 GitHub 新增 2900 万条 secrets 泄露,同比 +34%(CybelAngel)。行业级痛口,cc-switch 不碰。

**冷水:** 注意这些 jobs 的频率结构——JTBD-A 是**低频**(换机一年一次),JTBD-B/C/D 是高频焦虑但低频触发。Roost 不会是日用工具,装机量天花板低于 cc-switch 这类日常操作工具,这是定位前提而非缺陷。

## 三、能力精华论:Roost 应该具备的能力集(≤6 条)

赢家先例的收敛结论(chezmoi/Brewfile/1Password/Tailscale/mackup 案例研究):决定性能力只有 4 类——模板化差异、密钥安全内建、单命令可重现、无侵入可逆退出。Roost 的精华集:

**1. 单命令可重现:`roost apply` → 新机 10 分钟全就位(含 AI 工具)。**
为什么是精华:Tailscale(install+login=done)和 1Password(Touch ID 弹出即完成)证明,用户感知动作必须收敛为一个,复杂性全部内化。Brewfile 靠「声明式 + 单命令恢复」成为事实标准。cc-switch 不覆盖——它只管 7 款 AI CLI 的 provider 表,不管 brew/dotfiles/系统偏好/bootstrap。

**2. 密钥安全硬门:capture 前 Secret Scanner + age 加密,密钥永不明文入库。**
为什么是精华:chezmoi 比较表中「内建密钥管理」是它胜出 stow/yadm 的三大能力之一;CVE-2026-21852 + 2900 万条泄露把这从「备注」升级为「主叙事」。cc-switch 明文存 SQLite 且无加密路线规划——这是结构性差异,不是功能差距。

**3. git 版本历史 = 可回滚的配置时间线(尤其对 ~/.claude.json、claude_desktop_config.json)。**
为什么是精华:issue #34359/#59368 证明「配置被静默抹除」是反复发生的事故;atuin 的先例证明「给现有工具加安全持久层」本身就能立足。cc-switch 的备份是轮转快照(10 份),无逐变更历史、无 diff、无审计。

**4. AI 工具配置作为一等模块(CLAUDE.md/MCP/skills/hooks/commands 的 capture+apply)。**
为什么是精华:这是 JTBD-A 的直接载体,也是所有 Mac setup 指南的盲区(内容营销 + 产品双重切口)。cc-switch 覆盖其中一小块(MCP/prompt/skill 的同步),但不做版本化、不做加密、不与系统层联合恢复。

**5. 无侵入、可逆退出:真实文件而非 symlink,apply 前备份 + 默认 dry-run。**
为什么是精华:mackup(15k★)被 macOS Sonoma 的 symlink plist 禁令 + 应用主动覆盖 symlink 双重击穿(「link mode will BREAK YOUR PREFERENCES」— mackup README),证明「侵入式接管」架构必死;chezmoi 「随时停用无需反向操作」被用户列为迁移理由。Roost 现有架构禁令(不 symlink plist、defaults export/import)已与此一致。cc-switch 在这点上同样做对了(「even if you uninstall the app, your CLI tools will continue to work normally」)——这条不是差异点,是入场券。

**6. 模板化多机差异(经 chezmoi,薄编排,不自研)。**
为什么是精华:HN 社区把 templating 列为 chezmoi 核心优势;多 Mac 用户(work/personal)是 Roost 的第二大场景。Roost 只需让 chezmoi 的能力零摩擦可见,不重复实现。cc-switch 无此概念。

**反面清单(社区证伪的伪需求,不做):** GUI 优先、云同步服务、自动 app 配置扫描(mackup 的死因)、v1 跨平台、实时自动推送。Roost 现有范围冻结与此高度一致,保持。

## 四、对 Q2 的直接回答

**直接回答:不要试图「抢」cc-switch 的用户,也抢不到——但这个问题本身问错了方向。正确策略是共存 + 兜底,做 cc-switch 用户的下一层。**

理由:
1. **重叠面极窄。** cc-switch 解决「我现在想用哪个 provider」(日常高频操作),Roost 解决「这一切在新机器上消失了/被抹掉了怎么办」(低频高价值灾备)。两个问题在同一用户脑中并存,分属不同焦虑维度。lazygit 与 GitHub Desktop、atuin 与原生 history、mackup 与 brew 都证明「双装是常态」。
2. **正面竞争必败。** cc-switch 一个月发两个大版本、7 款工具覆盖、98.7k★ 社区动能——在「切换便利」轴上 Roost 没有任何胜算,也不该投入。
3. **兜底定位有 15k★ 先例。** mackup 仅凭「给现有应用做备份层」就建立了显著社区规模。Roost 沿「安全 + 持久」轴展开(age 加密、Secret Scanner、git 历史),这恰是 cc-switch 架构上不做、用户被第三方评测警告需自理的部分。
4. **具体动作:** 把 cc-switch 的 SQLite/skills 目录纳入 Roost 的 capture 范围,并在 README 明确写「Roost 是 cc-switch 的加密灾备层」——这是 mise 兼容 .tool-versions、direnv 读 .env 的同款策略:兼容巨头数据格式,把竞品用户变成自己的入口。

**风险(诚实版):**
- **R1:cc-switch 内置加密备份。** 它已自实现 AWS Signature V4,加一层加密技术上不难;无公开 roadmap 说明,属真实不确定。对冲:Roost 的第二层差异(macOS 系统级恢复、brew/dotfiles/AI 配置联合 bootstrap)是 cc-switch 定位上不会触及的——它的「minimal intrusion」原则与整机迁移天然冲突。
- **R2:低频工具的增长困境。** 灾备工具的装机动机是恐惧而非日用,获客依赖事故时刻(配置被抹、换新机)的搜索流量。必须靠内容(「cc-switch 数据备份」「Claude Code 迁移指南」等关键词)而非功能堆叠获客。
- **R3:Anthropic 官方修复。** 若 Claude Code 官方推出配置同步/备份,JTBD-A/B 的一部分会被收编。但 #34359 被标 stale 关闭说明短期意愿低,且跨工具(7+ 款 CLI)、跨层(系统+AI)的整合官方永远不会做。

## 五、对模块 #2 / 功能 #3 的修订建议

(模块 #2 = appconfig 模块;功能 #3 = 应用配置捕获/恢复。基于设计文档语境,如指代有偏请指出。)

**收范围:**
1. **appconfig 模块 v1 应以「AI 工具配置」为旗舰子集,而非泛化的「所有 app 配置」。** 泛化 app 配置发现正是 mackup 被击穿的伪需求(§三反面清单);而 AI 工具配置(~/.claude/、.mcp.json、claude_desktop_config.json、cc-switch SQLite、Gemini/Codex 配置)有明确文件清单(jtklinger 的 guide 已列出 14+ 类)、有验证过的痛(#34359/#59368)、有获客叙事(JTBD-E 盲区)。建议:策展数据文件中优先收录 AI 工具的路径清单,普通 GUI app 的 defaults 域作为第二梯队。
2. **不做自动扫描发现。** 维持「策展数据文件 + selection.yaml 显式选择」,这与 I8(零硬编码)和 mackup 教训一致。
3. **明确把 cc-switch 列为受支持的被备份对象**(其 SQLite + skill 目录),并在文档写明上下游关系。这不扩架构——只是策展数据多一条记录,符合「加模块/加数据,不 hack core」的扩展契约。

**改强调:**
4. **把「配置版本历史 + 回滚」从隐含能力提升为 appconfig 模块的显式卖点。** git 底座已有,缺的是 UX:`roost history <file>` / `roost restore <file>@<rev>` 级别的体验,直接对位 #34359 的「dozens of times 手动恢复」。若这超出当前冻结范围,按变更控制走 ADR——证据(两个高反应 issue + 官方拒修)足以支撑。
5. **Secret Scanner 硬门在 AI 配置场景前置宣传**:.mcp.json/settings.json 是 API key 明文重灾区(CVE-2026-21852),这是 capture AI 配置时 Scanner 价值最直观的展示场。

**不改:** 薄编排、不 symlink plist、defaults export/import、v1 仅 macOS、无云服务——全部被外部证据(chezmoi 胜因、mackup 死因、伪需求清单)二次确认,维持冻结。

---
来源索引:cc-switch README/releases/issues、knightli.com 评测、v3.16.2 release notes;GitHub issues anthropics/claude-code #34359/#59368;jtklinger/claude-code-backup-guide;mcpware/claude-code-backup;petegypps.uk;CVE-2026-21852/CVE-2025-59536 (Check Point);CybelAngel API Threat Report 2025;chezmoi.io 比较表;mackup README/issues;1Password/Tailscale/Brewfile 官方文档;lazygit/atuin/zoxide/direnv/mise 共存案例;HN 41453264/11515567;Robin Wieruch/swyx setup 指南。