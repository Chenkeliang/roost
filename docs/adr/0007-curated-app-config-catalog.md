# ADR-0007: 策展式 App 配置目录(已知应用配置位置发现)

- **状态**: 提议(PROPOSED · 2026-05-31)。待审。
- **日期**: 2026-05-31

## 背景

很多应用的配置**不是家目录点文件**,而是文件形式存在 `~/Library/Application Support/<App>/` 等位置:

- JetBrains 全家桶(DataGrip / IntelliJ / GoLand…):`~/Library/Application Support/JetBrains/<App><版本>/options/`
- VS Code:`~/Library/Application Support/Code/User/settings.json`、`keybindings.json`、`snippets/`
- 其他:Sublime、Zed(部分)、终端等。

`dotfiles.discover()` 只扫家目录点文件 + `~/.config`,**扫不到这些**;`appconfig` 模块只处理 `defaults` 偏好域(plist),也覆盖不了文件式配置。结果:用户在仪表盘搜 "datagrip" 一无所获(已确认)。

**已交付的兜底(Part A)**:Dotfiles 页加了「自定义路径」输入 —— 用户粘贴绝对路径即可纳管任意 App 配置(chezmoi 管理任意路径)。这解决了"能不能管",但仍要用户自己知道路径。

本 ADR 解决"**引导发现**":让 Roost **主动列出**常见 App 的已知配置位置供勾选。

## 决定(待审)

新增**一份可覆盖的策展数据文件**(策展数据,不是逻辑硬编码 —— 符合 I8),描述"应用 → 已知配置路径(glob)":

```yaml
# packages/core/src/data/app-config-catalog.yaml  (随包发布的默认策展数据)
# 用户可在仓库 roost/app-config-catalog.yaml 覆盖/追加(可覆盖数据文件,I8)
schemaVersion: 1
apps:
  - name: JetBrains (DataGrip/IntelliJ/…)
    paths:
      - "~/Library/Application Support/JetBrains/*/options"      # 仅 options,排除缓存
      - "~/Library/Application Support/JetBrains/*/keymaps"
  - name: VS Code
    paths:
      - "~/Library/Application Support/Code/User/settings.json"
      - "~/Library/Application Support/Code/User/keybindings.json"
      - "~/Library/Application Support/Code/User/snippets"
```

**归属**:文件式配置属 chezmoi/**dotfiles** 模块的范畴(任意路径文件管理),不进 `appconfig`(它是 `defaults` 偏好域专用)。由 `dotfiles.discover()` 读取该 catalog,对每条 glob 做存在性展开,产出候选(与现有家目录点文件候选同列,带来源标注 `note: "app config (<App>)"`)。

**规则(实现时为 MUST):**
- **精确到子目录/文件,绝不整目录吞缓存**:catalog 只列已知"纯配置"子路径(如 JetBrains `options/`),把缓存/日志/索引排除在外。新增条目必须人工确认不含大体积缓存。
- **密钥硬门照旧**:这些路径(尤其 DataGrip 的数据库连接配置)**可能含凭据**。capture 必须照常过 Secret Scanner;catalog 文档需显著警示。candidate 的 `recommendation` 对高风险项给 `encrypt` 提示。
- **零个人硬编码**(I8):默认 catalog 只含**通用应用**位置(JetBrains/VS Code 等),**不含任何个人/公司专属路径**;用户仓库内 `roost/app-config-catalog.yaml` 可覆盖/扩展。
- **便宜有界**(呼应 ADR-0006):catalog 展开只做 `glob`/`existsSync`,不深扫;受 M4 体积守卫。
- **macOS only**(I9):路径为 macOS 约定,不加跨平台分支。
- 经唯一 `exec`/`fs` 出口;不在 core 加领域 if-else(I4)——逻辑落在 dotfiles 模块。

## 触及不变量 / 为何需要本 ADR

- **新增数据文件 + 格式(scope/data schema)**:`app-config-catalog.yaml` 是新的策展数据契约 —— 按变更控制(architecture §11–§13)须先开 ADR。
- **I8 零硬编码**:用"可覆盖数据文件"承载策展,逻辑不变。
- **I6 密钥三禁**:发现这些路径后,capture 的密钥硬门是关键保障,本 ADR 显式要求保留并加警示。
- **I4 模块为唯一扩展点**:能力落在 dotfiles 模块的 discover,不 hack core。

## 备选方案

- **A. 仅自定义路径(已交付)**:足够灵活但需用户自知路径。本 ADR 是其上的引导层,二者并存。
- **B. 在 core/dotfiles 代码里硬编码应用列表**:违反 I8(零硬编码、策展数据应为可覆盖数据文件)——**否决**。
- **C. 本 ADR:可覆盖策展数据文件**——既引导又不硬编码,用户可扩展。**选定(待审)**。

## 待确认问题(审阅时定)

1. 默认 catalog 首批纳入哪些应用?(建议:JetBrains options/keymaps、VS Code User/settings+keybindings+snippets。其余留给用户覆盖。)
2. catalog 默认位置随包发布 + 仓库覆盖,合并策略是"用户追加/覆盖同名 app"还是"完全替换"?(建议:按 `name` 合并,用户条目优先。)
3. 高风险项(DataGrip 数据库配置)是否默认**排除**、仅在用户显式加入时提示加密?(建议:默认列出但标 `encrypt` 推荐 + 文档警示。)
