I have everything I need. The catalog model is whole-file: `encrypt: true` backs up a file as an encrypted opaque blob (no field extraction exists — that's a key constraint for the "mixed file" section). Now I'll write the report.

The research's `[kind/policy]` maps to catalog as: kind `settings/mcp/memory/data` → `kind`; policy `plain` → no encrypt, `encrypt` → `encrypt: true`, `never` → `NEVER_BACKUP` (exclude from catalog). I'll order section one by popularity (stars/MAU).

# Roost AI 工具 catalog 候选

> 映射说明:每条路径写成 catalog 数据可直接用的 `{ path（home 相对，去掉 ~/）, kind, encrypt }`。
> kind 取自 Roost 现有四值 `memory | settings | mcp | data`;policy `encrypt` → `encrypt: true`,policy `plain` → 不带 encrypt,policy `never` → **不进 catalog**(进 `NEVER_BACKUP` 或直接不收)。
> **重要前提**:Roost 当前是**整文件备份**模型,`encrypt: true` 把整个文件当作不透明加密 blob 备份,**没有"字段提取"能力**。因此"配置+密钥混在一个文件"的工具,只能整文件加密(可纳管但不优雅,见第四节)。

---

## 一、推荐首批补充(按流行度排序)

这些工具路径已核实(官方文档/本机实测/源码),MCP 为**独立文件**或可整文件加密,能干净进 catalog。

### 1. Ollama(120k+ stars,本地推理事实标准)— MCP:none

仅收元数据与 GUI 设置;模型权重与日志绝不备份。

| path | kind | encrypt |
|---|---|---|
| `.ollama/models/manifests` | settings | — |
| `Library/Application Support/Ollama` | settings | — |

> `~/.ollama/`(含 models/ blobs)、`~/.ollama/logs/server.log` → **NEVER_BACKUP**(GB 级 / 日志)。

### 2. Cursor(月活 100 万+,30k+ stars,实测确认)— MCP:standalone

```
{ path: ".cursor/mcp.json",                                            kind: "mcp",      encrypt: true }
{ path: "Library/Application Support/Cursor/User/settings.json",       kind: "settings"  }
{ path: "Library/Application Support/Cursor/User/keybindings.json",    kind: "settings"  }
{ path: ".cursor/prompt_history.json",                                 kind: "data"      }
```
MCP 是**独立文件**(`.cursor/mcp.json`),现有 dotfiles/aitools 机制已能覆盖。注意 Cursor 的 Global Rules 存在 `state.vscdb`(SQLite),非单文件、可能很大,**首批不收**(放第二梯队)。

### 3. opencode(160k+ stars,月活 700 万+)— MCP:mixed

```
{ path: ".config/opencode/opencode.json",          kind: "settings" }   // 含 mcp 块,但支持 {env:}/{file:} 引用,不写死密钥
{ path: ".config/opencode/tui.json",               kind: "settings" }
{ path: ".local/share/opencode/auth.json",         kind: "settings", encrypt: true }   // provider API key
{ path: ".local/share/opencode/mcp-auth.json",     kind: "mcp",      encrypt: true }   // MCP OAuth token
```
亮点:`opencode.json` 用 `{env:VAR}`/`{file:path}` 引用外部密钥,**MCP 配置块本身不含明文密钥**,可明文备份;真凭据隔离在 `auth.json`/`mcp-auth.json` 两个独立加密文件。这是同类工具里最干净的密钥分离设计。`themes/` 待核实(取决于是否装主题),暂不收。

### 4. Cline CLI(主仓库 63k+ stars,500 万+ 安装)— MCP:standalone

```
{ path: ".cline/data/settings/providers.json",          kind: "settings", encrypt: true }  // API key
{ path: ".cline/data/settings/global-settings.json",    kind: "settings" }
{ path: ".cline/data/settings/cline_mcp_settings.json",  kind: "mcp" }                       // MCP 独立文件
{ path: ".cline/rules",                                  kind: "memory" }
```
密钥与 MCP **分离到独立文件**,设计干净。注意:`cline_mcp_settings.json` 内单个 server 的 `env` 字段**可能**夹带 token——若用户实际写了 token,应让其手动标记加密(走 `dotfiles-encrypt` 约定键,ADR-0010)。`.cline/data/db/`(SQLite session)体积不定,不收。

### 5. Zed(50k+ stars,实测确认)— MCP:mixed(同文件)

```
{ path: ".config/zed/settings.json",  kind: "settings", encrypt: true }   // 含 context_servers(MCP)块
{ path: ".config/zed/keymap.json",    kind: "settings" }
```
MCP(`context_servers`)与设置**混在 settings.json 同一文件**,该 server env 可能含密钥 → 整文件加密。属第四节"混合文件"。

### 6. goose(44k+ stars,Block 开源 → Linux Foundation)— MCP:mixed(同文件)

```
{ path: ".config/goose/config.yaml",   kind: "settings" }   // extensions 键含 MCP 定义;主路径密钥在 Keychain,此文件本身一般不含明文密钥
{ path: ".config/goose/permission.yaml", kind: "settings" }
{ path: ".config/goose/prompts",        kind: "memory" }
```
密钥主路径是 **macOS Keychain**(不进备份);`config.yaml` 含 MCP extensions 但通常不含明文密钥,可明文备份。`secrets.yaml` 仅 Keychain 不可用时的明文回落,**若存在**则 `encrypt: true`(条件项,见第四节)。`permissions/tool_permissions.json` 运行时自动管理,不收。

### 7. aider(46k+ stars,410 万+ 安装)— MCP:mixed(同文件)

```
{ path: ".aider.conf.yml",            kind: "settings", encrypt: true }   // 可含 openai/anthropic key 及 mcp-server 键
{ path: ".aider.model.settings.yml",  kind: "settings" }
{ path: ".aider.model.metadata.json", kind: "data" }
{ path: ".aider.input.history",       kind: "data" }
```
`.aider.conf.yml` 可直接写 openai/anthropic key,也可放 MCP 配置 → 整文件加密(若用户用 `.env` 放密钥则可降为 plain,但保守起见标 encrypt)。属第四节。

### 8. Cherry Studio(35k+ stars,实测确认)— MCP:mixed(在 IndexedDB)

```
{ path: "Library/Application Support/CherryStudio/config.json",      kind: "settings" }   // 实测仅 clientId+theme
{ path: "Library/Application Support/CherryStudio/window-state.json", kind: "settings" }
{ path: "Library/Application Support/CherryStudio/memories.db",       kind: "data" }       // 实测 SQLite,无凭据
{ path: "Library/Application Support/CherryStudio/IndexedDB",         kind: "settings", encrypt: true }  // API keys+MCP+全部设置(唯一真相源)
{ path: "Library/Application Support/CherryStudio/Data/KnowledgeBase", kind: "data" }      // 可选,用户内容
```
关键事实(官方 Discussion #7190 确认):**API keys + MCP 配置 + 全部用户设置都在 `IndexedDB`(LevelDB 格式),无独立 MCP JSON**。这是唯一配置真相源,只能整目录加密备份。属第四节。

### 9. Continue.dev(VS Marketplace 100 万+ 下载)— MCP:mixed(同文件)

```
{ path: ".continue/config.yaml", kind: "mcp",      encrypt: true }   // v1.0+,mcpServers 内嵌,env 可含密钥
{ path: ".continue/config.json", kind: "settings", encrypt: true }   // 旧版主配置,同样可含密钥
{ path: ".continue/config.ts",   kind: "settings" }                  // 可选 TS 扩展,不含密钥
```
MCP 内嵌主配置 → 整文件加密。属第四节。

### 10. Cline(VS Code 扩展,39k+ stars,数百万下载)— MCP:mixed(同文件)

```
{ path: "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json", kind: "mcp",      encrypt: true }  // env 可含密钥
{ path: "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings",                          kind: "settings", encrypt: true }  // 同目录含密钥字段
{ path: "Documents/Cline/Rules",                                                                                        kind: "memory" }
{ path: "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev",                                   kind: "data" }   // 任务/对话历史,体积可能大,可选
```
注意与 CLI 版(条目 4)是**两套独立路径**,id 应区分(如 `cline` vs `cline-cli`)。MCP env 含密钥 → 加密。属第四节。

### 11. Crush(Charmbracelet,24k+ stars)— MCP:mixed(同文件,但密钥走 env)

```
{ path: ".config/crush/crush.json",       kind: "settings" }   // 含 mcp 键,密钥走环境变量不硬编码
{ path: ".local/share/crush/crush.json",  kind: "data" }       // session 状态,不含密钥
```
MCP 与设置同文件,但密钥通过环境变量注入、**不硬编码**,故可明文备份。设计较干净。

### 12. Windsurf IDE(Codeium,OpenAI 30 亿美元收购)— MCP:standalone

```
{ path: ".codeium/windsurf/user_settings.pb",            kind: "settings" }   // Protobuf 二进制,无独立 settings.json
{ path: ".codeium/windsurf/memories/global_rules.md",    kind: "memory" }
{ path: ".codeium/windsurf/mcp_config.json",             kind: "mcp", encrypt: true }   // 独立文件,env 可含密钥
```
MCP 是**独立文件**;现有机制可覆盖。注意 IDE 版与 VS Code 插件版(Codeium.codeium)是不同产品。

### 13. GitHub Copilot(VS Code 扩展,装机量最大)— MCP:none

```
{ path: "Library/Application Support/Code/User/prompts", kind: "memory" }   // 用户级 .instructions.md
```
真 token 在 Keychain;`globalStorage/github.copilot/`(OAuth 缓存)→ **NEVER_BACKUP**。`settings.json` 与其他扩展共享、含全局 VS Code 设置,是否收取决于 Roost 是否单独纳管 VS Code(见不收说明)。

---

## 二、第二梯队(流行度一般 / 路径或行为待核实)

| 工具 | 原因 | 建议 path(待核实部分已标注) |
|---|---|---|
| **Qwen Code** | star 数待核实(近期 fork Gemini CLI);路径模式与 Gemini 一致,可信度较高 | `.qwen/settings.json` [settings,mcp 同文件];系统级 `/Library/Application Support/QwenCode/settings.json` 个人机一般无 |
| **Amp**(Sourcegraph) | star 未公开,2025-07 才推出;路径多数明确但 `secrets.json` 待核实 | `.config/amp/settings.json` [settings]、`.config/amp/AGENTS.md` [memory]、`.config/amp/plugins`+`skills` [data]、`.amp/oauth` [mcp,encrypt];`.local/share/amp/secrets.json` **待核实** |
| **Windsurf**(IDE 条目,见第一节 12) | 与 VS Code 插件版易混淆;`user_settings.pb` 是 Protobuf,Roost 整文件备份无解析压力但不可读 | 同条目 12 |
| **Cursor Global Rules** | 存在 `state.vscdb`(SQLite),非单文件、含对话历史可能很大 | `Library/Application Support/Cursor/User/globalStorage/state.vscdb` [data] —— 体积/含敏感对话,建议默认不收 |
| **Trae**(字节,免费) | 实测路径确认,但国内工具受众/长期性待观察 | `Library/Application Support/Trae/User/settings.json` [settings]、`Library/Application Support/Trae/User/mcp.json` [mcp,encrypt]、`.trae/user_rules.md` [memory] —— 路径已核实,可上调首批 |
| **Kiro**(AWS) | 公测阶段;路径实测确认,steering 目录可能为空 | `Library/Application Support/Kiro/User/settings.json` [settings]、`.kiro/settings/mcp.json` [mcp,encrypt]、`.kiro/steering` [memory] —— 路径已核实,可上调首批 |
| **LM Studio** | MCP 路径有已知 bug(可能落 `.cache/lm-studio/mcp.json`),需两处都备 | `Library/Application Support/LM Studio` [settings]、`.lmstudio/mcp.json`+`.cache/lm-studio/mcp.json` [mcp,encrypt]、`.lmstudio/hub` [settings];models → never |
| **Jan** | MCP 文件名(v0.7.3+)官方未披露,**待核实** | `Library/Application Support/Jan/data/`(settings/assistants/threads 子目录可收 [plain]);MCP JSON 文件名待核实 |
| **5ire** | userData 根的其余设置文件名待核实;MCP 文件已确认 | `Library/Application Support/5ire/mcp.json` [mcp,encrypt](DeepWiki 确认);其余设置文件名待核实 |
| **ChatGPT 桌面版** | App Store 版无 MCP;直载版 MCP 路径待核实(本机未装) | `Library/Application Support/com.openai.chat/app_pairing_extensions` [settings];`Library/Application Support/OpenAI/ChatGPT/mcp_config.json` **待核实** |
| **Roo Code** | 2026-04 已停维护,用户迁 Kilo Code | `Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline` [settings,encrypt]、`.roo/rules` [memory] —— 收价值在迁移过渡期 |
| **PearAI / Void / ChatWise / Kilo Code** | 路径全部**基于推断未实测**(见第二节末) | 全部待本机/源码二次核实后再收 |

> 纯推断未验证、暂不给可用条目:**PearAI**(`.pearai/config.json` 推断自 Continue fork)、**Void**(`Library/Application Support/Void/User/settings.json` + `.config/void/mcp_servers.json` 社区资料)、**ChatWise**(`Library/Application Support/app.chatwise/` 由 bundle ID 推断,MCP 无独立文件)、**Kilo Code**(`globalStorage/kilocode.kilo-code/` extension ID 推断)。

---

## 三、明确不收(及原因)

| 工具/路径 | 原因 |
|---|---|
| **模型权重**:Ollama `.ollama/models`、LM Studio `.cache/lm-studio/models`、Jan `data/models` | GB 级二进制,重新 pull 即可,绝不备份(NEVER) |
| **运行日志**:Ollama `server.log`、Jan `app.log` | 无恢复价值 |
| **OAuth/session token**:GitHub Copilot `globalStorage/github.copilot/`、Windsurf 插件 `globalStorage/codeium.codeium/` | 短命凭据,备份纯增风险零恢复价值(对齐现有 NEVER_BACKUP 与 ADR-0022 "Credentials are never backed up") |
| **CUA Group Container**:ChatGPT `2DC432GLL2.com.openai.sky.CUAService/` | 通常为空 / 仅 plist,无配置价值 |
| **GitHub Copilot 的 `settings.json`、VS Code 全局 settings** | 与其他扩展共享的 VS Code 全局设置,属"编辑器配置"范畴,不应由 AI 工具条目重复纳管(避免与潜在的 VS Code/Cursor 编辑器条目冲突) |
| **纯推断未验证项**(PearAI/Void/ChatWise/Kilo Code 全量、Amp secrets.json、Jan MCP 文件、ChatGPT 直载版 mcp_config) | 诚实门槛:路径未经实测/源码确认前不进默认 catalog,避免备份不存在的路径或漏备真实路径 |
| **Cline/Roo 的对话历史目录**(`saoudrizwan.claude-dev/`、`rooveterinaryinc.roo-cline/` 全量) | 体积可能很大,默认不收;用户可手动按 dotfiles 选取 |

---

## 四、"配置+密钥混在一个文件"清单(整文件加密即可纳管,但无字段提取)

Roost 现为**整文件备份**模型——这些工具把 MCP/设置/密钥揉在同一文件或同一不可拆目录,**只能整文件 `encrypt: true`**。可纳管,但代价是:加密整块、内容不可读、无法只备非密钥部分。若未来要"干净纳管"(明文存配置、仅加密密钥字段),需要新增**字段提取/脱敏能力**,这是**架构变更,必须先立 ADR**(architecture.md §11–§13;现有 Secret Scanner 是 capture 硬门,不做字段拆分)。

| 工具 | 混合载体 | 现状处理 |
|---|---|---|
| **Zed** | `settings.json` 含 `context_servers`(MCP)块 | 整文件 encrypt |
| **aider** | `.aider.conf.yml` 含 api-key + `mcp-server` | 整文件 encrypt |
| **Continue.dev** | `config.yaml`/`config.json` 内嵌 `mcpServers`,env 含密钥 | 整文件 encrypt |
| **Cline(VS Code 扩展)** | `cline_mcp_settings.json` 的 server `env` 含 token;同目录 settings 含密钥 | 整文件/整目录 encrypt |
| **Cline CLI** | `cline_mcp_settings.json` server `env` **可能**含 token(条件) | 默认 plain,用户实测含 token 时走 `dotfiles-encrypt` 标记(ADR-0010) |
| **Cherry Studio** | `IndexedDB`(LevelDB):API key + MCP + 全部设置,**唯一真相源,无独立 JSON** | 整目录 encrypt(最极端,完全不可拆) |
| **goose** | `config.yaml` 的 `extensions` 含 MCP;`secrets.yaml` 是密钥明文回落 | config.yaml 一般可 plain;`secrets.yaml` 若存在则 encrypt(密钥主路径在 Keychain) |
| **Qwen Code** | `.qwen/settings.json` 的 `mcpServers` 与 settings 同文件 | 视密钥引用方式;保守 encrypt |

> **设计较干净、不在此列**(密钥已隔离或走 env/Keychain,MCP 配置块本身可明文备份):**opencode**(`{env:}`/`{file:}` 引用 + 独立 auth.json/mcp-auth.json)、**Crush**(密钥走 env)、**Cursor / Windsurf / Trae / Kiro / 5ire / LM Studio**(MCP 是独立文件)。

---

## MCP 形态速查(独立文件 vs 混合)

- **MCP 独立文件**(现有 dotfiles/aitools 机制已能覆盖,只需对该文件按需加密):Cursor、Windsurf IDE、Trae、Kiro、5ire、LM Studio、Cline CLI(`cline_mcp_settings.json`)、opencode(`mcp-auth.json`)、Void(待核实)。
- **MCP 混合文件**(需整文件加密,字段提取须先立 ADR):Zed、aider、Continue.dev、Cline(VS Code)、Cherry Studio、goose、Qwen Code。
- **MCP:none**(无需处理 MCP):Ollama、GitHub Copilot、Windsurf VS Code 插件。

---

相关源文件(均为绝对路径):
- catalog 数据与类型:`/Users/keliang/MacMove/packages/core/src/ai-tools-catalog.ts`(`AiToolPath` 用 `kind: memory|settings|mcp|data` + `encrypt?: boolean`;`NEVER_BACKUP` 数组)
- 加密标记机制:`/Users/keliang/MacMove/docs/adr/0010-encrypt-mark-and-blocked-retry.md`(`dotfiles-encrypt` 约定键)
- 资产层/凭据不备份原则:`/Users/keliang/MacMove/docs/adr/0022-asset-layer.md`

> 一句话结论:**首批可直接进 catalog 的有 13 个**(Ollama / Cursor / opencode / Cline CLI / Zed / goose / aider / Cherry Studio / Continue / Cline-VSCode / Crush / Windsurf IDE / GitHub Copilot)。其中 7 个属"配置+密钥混合"、只能整文件加密;若要做字段级脱敏,须先立 ADR。**字段提取能力当前不存在,是这批工具"优雅纳管"的唯一阻塞点。**