# AI 方向调研报告

> 调研对象:6 个主题、40+ 项目。服务两项即将开工的工作:**模块 #2「AI 工具配置」一等公民模块**与**功能 #3「Sync Review opt-in AI 解读」**。所有结论均标注来源项目。

---

## 一、生态地图

### 主题 A:dotfile/配置管理器

| 项目 | Star | 加密 | 多机差异 | App Catalog | 密码管理器集成 | Hooks | Dry-run |
|---|---|---|---|---|---|---|---|
| [chezmoi](https://github.com/twpayne/chezmoi) | ~13k | age/gpg/git-crypt/transcrypt | Go template + .chezmoiignore 模板化 | 无 | 17+(1Password/Bitwarden/Vault…) | run_/run_once_/run_onchange_ + before/after | diff / `apply --dry-run` |
| [mackup](https://github.com/lra/mackup) | ~15k | **无** | 无 | **400+ INI cfg(独家)** | 无 | 无 | 无 |
| [yadm](https://github.com/yadm-dev/yadm) | ~6.3k | GPG/OpenSSL archive | ##os/##hostname 后缀 + 模板 | 无 | 无 | pre_/post_ 目录 | 经 git |
| [dotbot](https://github.com/anishathalye/dotbot) | ~7.9k | 无 | `if` 条件字段 | 无 | 无 | shell 指令 | --dry-run |
| [GNU Stow](https://www.gnu.org/software/stow/) | ~1k | 无 | 无 | 无 | 无 | 无 | -n;两阶段冲突预检 |
| [rcm](https://github.com/thoughtbot/rcm) | ~3.2k | 无 | tag-/host- 双维度目录 | 无 | 无 | pre-up/post-up | 无 |

关键模式:加密分「整文件入库」vs「完全不加密」两派;macOS plist 不可 symlink 是生态共识(mackup Sonoma 警告),佐证 Roost `defaults export/import` 路线;只有 mackup 做出社区 catalog,只有 chezmoi 做出密码管理器集成——**无人两者兼得**。

### 主题 B:AI 编码工具配置面

| 工具 | Star | 核心配置 | 记忆/规则文件 | 密钥位置 |
|---|---|---|---|---|
| [Claude Code](https://github.com/anthropics/claude-code) | ~50k | ~/.claude/settings.json、agents/、skills/、keybindings.json、plans/ | CLAUDE.md(全局/项目/.local) | apiKeyHelper 脚本、env 字段;~/.claude.json 含 OAuth token |
| Claude Desktop | 闭源 | claude_desktop_config.json(单文件) | 无 | env 字段常含明文 token |
| [Codex CLI](https://github.com/openai/codex) | ~30k | ~/.codex/config.toml | 无 | ~/.codex/auth.json(高敏感) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | ~60k | ~/.gemini/settings.json | GEMINI.md | ~/.gemini/.env、.gemini/.env |
| [Cursor](https://github.com/getcursor/cursor) | ~35k | ~/Library/Application Support/Cursor/User/{settings,keybindings}.json、snippets/ | .cursor/rules/*.mdc、.cursorrules | OS Keychain;state.vscdb 为二进制 SQLite |
| Windsurf | 闭源 | ~/.codeium/windsurf/mcp_config.json + VS Code 式 User/ | memories/global_rules.md、.windsurf/rules/ | mcp_config env 字段(支持 ${env:}/${file:} 插值但常见明文) |
| [Continue.dev](https://github.com/continuedev/continue) | ~25k | ~/.continue/config.yaml(+config.ts) | rules/prompts in yaml | .continue/.env,`${{ secrets.X }}` 引用 |
| [aider](https://github.com/Aider-AI/aider) | ~25k | .aider.conf.yml | 无(chat history 可备份) | 多处 .env + oauth-keys.env,conf.yml 可内嵌 key |
| [ollama](https://github.com/ollama/ollama) | ~120k | 无配置文件,全靠 launchctl env | Modelfile(手动保存) | 无密钥;模型权重 GB 级 |

### 主题 C:MCP 管理/注册/同步

| 项目 | Star | 定位 | 密钥处理 |
|---|---|---|---|
| [Smithery CLI](https://github.com/smithery-ai/cli) | ~761 | Registry 搜索安装,9000+ server | 交互填 env 后明文写客户端 JSON |
| [MCPM](https://github.com/pathintegral-institute/mcpm.sh) | ~968 | 全局管理 + **Profile 系统**,10+ 客户端 | 明文全局配置,无同步 |
| [MCP-Club/mcpm](https://github.com/MCP-Club/mcpm) | ~107 | Claude App 启停管理 | 「禁用但保留」配置 |
| [mcp-get](https://github.com/michaellatman/mcp-get) | ~511(已弃用) | 安装时**声明式 env schema**(description/required) | 明文 |
| [官方 Registry](https://github.com/modelcontextprotocol/registry) | ~6.9k | 元数据注册表(UUID + namespace 验证) | 只存元数据,密钥不经过 |
| [Docker MCP Catalog](https://docs.docker.com/ai/mcp-catalog-and-toolkit/) | N/A | Gateway + 容器隔离 + secrets 注入 | **生态最佳**:密钥不落客户端 JSON |
| [mcp-hub](https://github.com/ravitemer/mcp-hub) | ~493 | 单端点聚合 | **`${cmd:...}` 动态命令取值**(可接 keychain) |
| [mcp-sync](https://github.com/ztripez/mcp-sync) | ~46 | global→project→tool 三层合并写入 | 明文,无密钥分离 |

### 主题 D:AI CLI profile/账号切换器

| 项目 | Star | 范围 | 凭据存储 |
|---|---|---|---|
| [farion1231/cc-switch](https://github.com/farion1231/cc-switch) | ~99k | 7 工具、50+ provider 模板、代理/故障转移 | SQLite ~/.cc-switch/cc-switch.db;自动备份轮转 10/20 份 |
| [guibes/claude-profile-switch](https://github.com/guibes/claude-profile-switch) | ~1 | 完整 profile + git 历史 | **age clean/smudge filter**——与 Roost 同构 |
| [XueshiQiao/CCSwitcher](https://github.com/XueshiQiao/CCSwitcher) | ~101 | 菜单栏原子切换 Keychain+~/.claude.json | backups.json **明文 OAuth token**(Secret Scanner 拦截对象) |
| [Mamdouh66/claude-switch](https://github.com/Mamdouh66/claude-switch) | ~23 | Bash 零依赖 | macOS Keychain;token 8h 过期 |
| [breakstring/cccs](https://github.com/breakstring/cccs) | ~78 | 仅切 settings.json | 不碰凭据——settings/凭据分离心智 |
| [ukogan/claude-account-switcher](https://github.com/ukogan/claude-account-switcher) | ~2 | auth 隔离 + settings symlink 共享 | per-profile 目录 |
| [KagasiraBunJee/cc-account-switcher](https://github.com/KagasiraBunJee/cc-account-switcher) | ~0 | 加密快照 | AES-256-GCM,key 在 Keychain |
| [venkycs/cc-switch](https://github.com/venkycs/cc-switch) | ~2 | 多订阅切换 | Keychain |

### 主题 E:LLM 解释/生成 git 变更

| 项目 | Star | Provider 数 | 大 diff 策略 | 密钥存储 | 隐私开关 |
|---|---|---|---|---|---|
| [OpenCommit](https://github.com/di-sukharev/opencommit) | ~7.3k | 8+(含 Ollama) | token 上限截断 + .opencommitignore | ~/.opencommit 明文 | 无 |
| [aicommits](https://github.com/Nutlope/aicommits) | ~9k | 8+(含 Ollama/LM Studio/OpenRouter) | max-length | ~/.aicommits 明文,展示掩码 | 无 |
| [pr-agent](https://github.com/The-PR-Agent/pr-agent) | ~11.6k | 多 | **PR Compression:文件优先级裁剪** + 0.3 安全系数 | env var / 外部 secret manager | enable_ai_metadata 默认 false |
| [gptcommit](https://github.com/zurawiki/gptcommit) | ~2.4k | 仅 OpenAI | **per-file 两阶段汇总** | 配置文件 + env var | 无 |
| [lumen](https://github.com/jnsahaj/lumen) | ~2.4k | 10+ | 未公开 | JSON 明文 | 无 |
| [llm (simonw)](https://github.com/simonw/llm) | ~12k | 插件制,数十个 | — | keys.json 平台感知路径,per-plugin key name | **logs on/off** |

### 主题 F:桌面应用「可选 AI」模式

| 项目 | Star | 关键模式 |
|---|---|---|
| [Ollama](https://github.com/ollama/ollama) | ~170k | `GET localhost:11434/api/tags` 为本地模型发现事实标准 |
| LM Studio | 闭源 | Developer 模式默认关闭 = 天然 opt-in;/v1/models 发现 |
| [Jan](https://github.com/janhq/jan) | ~43k | 60s 可配超时、per-message 内联错误卡片 + Regenerate、错误持久化跨重启 |
| [Open WebUI](https://github.com/open-webui/open-webui) | ~141k | Ollama 零配置自动发现;失败显示引导而非报错 |
| [Zed](https://github.com/zed-industries/zed) | ~85k | **opt-in 最完整范本**:`disable_ai:true` 单布尔、onboarding 明示路径、Key 入 Keychain、零保留措辞 |
| [Continue.dev](https://github.com/continuedev/continue) | ~25k | 声明式 config 文件供 power user 绕过 UI |
| [Obsidian AI Providers](https://github.com/pfrankov/obsidian-ai-providers) | ~119 | **Provider Hub**:一处配置,多功能消费 |
| [Logseq 插件生态](https://github.com/briansunter/logseq-plugin-gpt3-openai) | ~32k/~1.2k | 核心零 AI、插件层 opt-in;对比措辞定位隐私 |

---

## 二、对模块 #2「AI 工具配置」的设计输入

### 2.1 配置面完整清单(工具 × 路径 × 类别 × 敏感性)

类别:**记忆**(规则/指令,最高价值)、**设置**、**MCP**、**凭据**、**状态/二进制**、**大文件**。
处置:✅ 明文入库 · 🔐 age 加密 · 🚫 绝不备份 · 📦 二进制快照 · ⏭️ 默认跳过可选开

| 工具 | 路径 | 类别 | 处置 |
|---|---|---|---|
| Claude Code | ~/.claude/CLAUDE.md | 记忆 | ✅ |
| | ~/.claude/settings.json | 设置 | ✅(env.* 字段须扫描) |
| | ~/.claude/agents/、skills/、keybindings.json、plans/ | 设置 | ✅ |
| | ~/.claude/settings.local.json | 设置+密钥 | 🔐 |
| | ~/.claude.json | 凭据(OAuth session) | 🚫(仅可记录账号元数据) |
| | /Library/Application Support/ClaudeCode/managed-settings.json | 设置(组织) | ✅ |
| Claude Desktop | ~/Library/Application Support/Claude/claude_desktop_config.json | MCP+密钥(env 字段) | 🔐 或脱敏占位符 |
| Codex CLI | ~/.codex/config.toml | 设置 | ✅ |
| | ~/.codex/auth.json | 凭据 | 🚫 |
| | ~/.codex/history.jsonl | 状态 | ⏭️ |
| Gemini CLI | ~/.gemini/GEMINI.md | 记忆 | ✅ |
| | ~/.gemini/settings.json | 设置 | ✅ |
| | ~/.gemini/.env、~/.env | 密钥 | 🔐 |
| Cursor | …/Cursor/User/settings.json、keybindings.json、snippets/ | 设置 | ✅ |
| | …/Cursor/User/globalStorage/state.vscdb | 状态(SQLite) | 📦(不适合 git diff) |
| | (.cursor/rules/*.mdc) | 记忆(项目级) | 归 projects 模块,非本模块 |
| Windsurf | ~/.codeium/windsurf/memories/global_rules.md | 记忆 | ✅(首要捕获目标) |
| | ~/.codeium/windsurf/mcp_config.json | MCP+密钥 | 🔐/脱敏 |
| | …/Windsurf/User/{settings,keybindings}.json | 设置 | ✅ |
| Continue | ~/.continue/config.yaml、config.ts、*.prompt | 设置/记忆 | ✅(models.apiKey 字段须扫描) |
| | .continue/.env | 密钥 | 🔐 |
| aider | ~/.aider.conf.yml | 设置+可能内嵌 key | 扫描后 ✅/🔐 |
| | ~/.env、~/.aider/oauth-keys.env | 密钥 | 🔐 |
| | .aider.chat.history.md | 状态 | ⏭️(可选,有保留价值) |
| ollama | Modelfile | 设置 | ✅ |
| | ~/.ollama/models/ | 大文件(GB) | ⏭️ 默认不备份(可重拉) |
| | launchctl env(OLLAMA_*) | 设置 | 导出为数据文件 ✅ |
| cc-switch 类 | ~/.cc-switch/cc-switch.db | 状态(SQLite,含 key) | 📦+🔐 |
| | ~/.ccswitcher/backups.json | **明文 token** | 🚫(Secret Scanner 硬门典型对象) |
| Keychain 条目 | 如 "Claude Code-credentials" | 凭据 | 仅记录 service/account 元数据,不导出明文(来源:CCSwitcher/claude-switch) |

### 2.2 Catalog 机制借鉴

- **mackup**:400+ 应用 INI catalog 是直接原型——每工具一个数据文件、社区可贡献、`[configuration_files]`/`[xdg_configuration_files]` 双节点。Roost 应升级为:每条路径附**类别 + 敏感性标签 + 处置策略**(mackup 完全没有的维度),以可覆盖数据文件形式存放(满足 I8)。
- **mcp-get**:声明式 `environmentVariables`(description/required)schema——catalog 中声明「此工具需要哪些密钥」,restore 时逐项引导。
- **官方 MCP Registry**:元数据与凭据彻底分离——catalog/selection.yaml 只记「用什么」,绝不记「凭什么用」。
- **OAuth token 时效**(claude-switch,8h 过期):catalog 应标注哪些凭据「备份无意义」,只存账号标识元数据。

### 2.3 密钥处理借鉴

| 模式 | 来源 | 对 Roost |
|---|---|---|
| age clean/smudge filter,密文入 git | guibes/claude-profile-switch | 与 Roost 架构同构,可直接复用 |
| capture 时 env 值替换占位符,restore 时引导填入 | mcp-get 的声明式提示 + Claude Desktop 痛点 | AI 模块的 env 字段标准流程 |
| `${cmd:...}` 动态取值 | mcp-hub | restore 可写入引用而非明文(接 Keychain/age) |
| 密钥不落客户端 JSON,注入式分发 | Docker MCP Toolkit | apply 时从 age 解密注入,JSON 只留引用 |
| settings 与凭据分开建模 | breakstring/cccs、ukogan | 模块内子类型划分依据 |

---

## 三、对功能 #3「Sync Review AI 解读」的设计输入

| 设计点 | 最佳实践 | 出处 |
|---|---|---|
| **Provider 抽象** | provider + model 两级配置,不让用户填裸 base_url;provider 作为可插拔单元,per-provider 独立 key name | OpenCommit/lumen(两级);llm(插件 + key 隔离);Obsidian AI Providers(hub:一处配置全局消费——Roost 未来多 AI 功能共用) |
| **统一网关备选** | 支持 OpenRouter 一个 key 多 provider,降低配置负担 | aicommits、lumen |
| **Key 存储** | 存 macOS Keychain,配置文件只存 provider/endpoint;UI 展示掩码;key 绝不进日志 | Zed(Keychain,**生态唯一**,Roost 应跟进);aicommits(掩码)。注意:主题 E 全部工具明文存 key——是反面教材也是差异化点 |
| **环境变量覆盖** | env var(ANTHROPIC_API_KEY 等)优先级最高,兼容脚本场景 | gptcommit、OpenCommit,事实标准 |
| **Diff 截断** | 按模块/文件优先级裁剪而非整体截断;token 估算留安全系数(×0.3);per-module 两阶段汇总(逐模块 summarize → 聚合)——Roost 的 SyncModule 边界天然提供语义分段,优于全生态的「单文本块」做法 | pr-agent(Compression + 系数);gptcommit(两阶段);OpenCommit(上限参数) |
| **Secret 防泄** | 发送前两道门:(1) 路径级 ignore 列表,默认含 .env/*.pem/lock 文件;(2) 内容级 Secret Scanner 正则扫描——生态无人做,Roost 复用 capture 硬门即首创 | OpenCommit(.opencommitignore);Roost 自身架构(I6) |
| **本地模型** | `GET localhost:11434/api/tags` 自动发现;成功→列模型,失败→「未检测到 Ollama」引导而非报错;LM Studio /v1/models 同理 | Ollama(事实标准)、Open WebUI、Jan、Continue |
| **opt-in UX** | 默认 off + 单布尔总开关;首次启用时明示数据流(「diff 将发送至 <provider>;选择本地模型则不离机」);provider 选择器上做本地/云视觉区分标注 | Zed(disable_ai + onboarding 路径选择)、LM Studio(Developer 模式)、Logseq(核心零 AI)、pr-agent(metadata 默认 false) |
| **超时与降级** | 60s 可配超时;失败显示内联错误卡片 + 重试按钮,持久化跨重启,不静默失败;AI 不可用时 Sync Review 规则视图完整可用 | Jan |
| **隐私措辞** | 「请求后即丢弃 / 不持久化 / 不用于训练」三件套;对比式措辞(「除非显式配置云 provider,否则不发送任何数据」) | Zed、Logseq |
| **视图融合** | diff 展示与 AI 解读同一视图,不拆两页;规则结果与 AI 建议并列且标注来源 | lumen;生态空白点(主题 F 空白 4) |
| **可审计性** | 维护 ai-audit.jsonl(何时调用、哪个模型、是否降级、耗时);llm 的 logs on/off 显式开关 | llm;生态空白点(主题 F 空白 3) |

---

## 四、生态空白与 Roost 的差异化机会

| # | 空白 | 证据 | Roost 机会 |
|---|---|---|---|
| 1 | **跨 AI 工具统一备份不存在** | 9 个主流 AI 工具、10+ 目录,无任何工具统一扫描/备份(主题 B) | 模块 #2 即第一个:统一发现 + 三类子类型差异化策略(明文 git/加密/不备份) |
| 2 | **catalog + 加密 + macOS 语义三者兼得无人做到** | mackup 有 catalog 无加密;chezmoi 有加密无 catalog;无人懂 plist/mas/LaunchAgent(主题 A) | Roost 核心定位本身 |
| 3 | **MCP 配置跨机迁移无原生方案** | 所有 MCP 工具只管本机;密钥几乎全明文(主题 C) | MCP 配置纳入 AI 模块,密钥走 age,「profile 进私有 git + 多接收方加密」填补团队共享空白 |
| 4 | **切换器都是切换工具,无人做迁移** | 主题 D 全部项目;~/.cc-switch.db 类资产零覆盖;CCSwitcher 明文 token 落盘 | Roost 备份 settings 层 + 二进制快照,切换逻辑零介入(边界清晰) |
| 5 | **diff→LLM 链路上无 secret 内容扫描** | 主题 E 全部工具仅有文件级 ignore | Secret Scanner 复用至 AI 路径 = 生态首创 |
| 6 | **AI key 无人存 Keychain** | 主题 E 全部明文;仅 Zed(编辑器)做到 | macOS 原生工具的天然差异化 |
| 7 | **模块化语义分段解读无人做** | 所有工具把 diff 当单一文本块 | SyncModule 边界 → 按模块解读再聚合,精度优于截断 |
| 8 | **本地路径隐私标注、AI 审计日志、规则/AI 来源并列展示均空白** | 主题 F 空白 2/3/4 | 「完全本地,数据不离机」徽章 + ai-audit.jsonl + dry-run 输出区分「规则检测」vs「AI 建议」 |
| 9 | **配置备份工具集成 AI 为零** | mackup/chezmoi/rcm 全无 AI(主题 F 空白 1) | 功能 #3 即第一个 |

---

## 五、风险与边界

### 隐私承诺(I2/无遥测)
- AI 解读**默认 off**,启用是逐项明示的用户决策(Zed/Logseq 范式)。云 provider 路径必须在 UI 标注「diff 将发送至 <provider>」;本地模型路径标注「数据不离机」。任何静默调用都违背无遥测承诺。
- key 进 Keychain、UI 掩码、不进日志(I6 延伸);发送前必过 Secret Scanner——CCSwitcher backups.json、Claude Desktop env 字段、aider conf.yml 等已知明文热点须有专门规则。
- OAuth/session token(~/.claude.json、auth.json)**绝不备份**,只记账号元数据——token 8h 时效使备份无价值且纯增风险(claude-switch)。

### I8 策展数据
- AI 工具 catalog(工具×路径×类别×敏感性)必须是**可覆盖的数据文件**,不是硬编码;`inventory/` 真机审计仅作测试夹具校验 catalog,绝不直接生成产品逻辑。
- AI 工具路径迭代极快(Continue config.json→yaml、Cursor .cursorrules→rules/*.mdc),catalog 需带格式版本与废弃标记,参考 mackup 社区贡献模型。

### 范围控制(I1/I4/§11)
- 两项工作均落为模块/可选能力,**不碰 core**:模块 #2 是一个 SyncModule;功能 #3 是 Sync Review 的可选消费层,AI provider 抽象走独立 hub(Obsidian 模式),core 禁联网的不变量不破——AI 调用只能发生在 UI/独立服务层。
- 明确 OUT:不做 provider 切换/账号切换(委托 cc-switch 类工具)、不做 MCP 安装/registry(委托 Smithery/MCPM)、不备份 GB 级模型权重(默认跳过,可选开关)、不做 AI 自动决策(AI 只解读,apply 仍走 dry-run+备份,I7)。
- 项目级文件(.cursor/rules、.mcp.json、.codex/config.toml)归 projects 模块,AI 模块只管用户级——避免模块职责重叠。
- 两项均涉及新数据 schema(catalog 格式、AI provider 配置),按 §11 须各立 ADR 后动工。