# ADR-0007: 策展式 App 配置目录(已知应用配置位置发现)

- **状态**: 接受(ACCEPTED · 2026-05-31)。Q1–Q4 经审定(见末「决议」);v1 实现待排期,引导式还原拆 ADR-0008。
- **日期**: 2026-05-31

## 背景

很多应用的配置**不是家目录点文件**,而是文件形式存在 `~/Library/Application Support/<App>/` 等位置:

- JetBrains 全家桶(DataGrip / IntelliJ / GoLand…):`~/Library/Application Support/JetBrains/<App><版本>/options/`
- VS Code:`~/Library/Application Support/Code/User/settings.json`、`keybindings.json`、`snippets/`
- 其他:Sublime、Zed(部分)、终端等。

`dotfiles.discover()` 只扫家目录点文件 + `~/.config`,**扫不到这些**;`appconfig` 模块只处理 `defaults` 偏好域(plist),也覆盖不了文件式配置。结果:用户在仪表盘搜 "datagrip" 一无所获(已确认)。

**已交付的兜底(Part A)**:Dotfiles 页加了「自定义路径」输入 —— 用户粘贴绝对路径即可纳管任意 App 配置(chezmoi 管理任意路径)。这解决了"能不能管",但仍要用户自己知道路径。

本 ADR 解决"**引导发现**":让 Roost **主动列出**常见 App 的已知配置位置供勾选。

## 调研:参照成熟开源项目(2026-05-31)

- **Mackup**(`lra/mackup`,**609** 个 App 定义,**GPLv3**)是 macOS"应用→配置路径"的事实标准库。格式:`[application] name=…` + `[configuration_files]`(家目录相对路径列表)+ 可选 `[xdg_configuration_files]`。
- **验证 Roost 设计**:Mackup 用 **symlink plist**,在 **macOS Sonoma+ 会毁掉用户偏好**(其 README 明确警告)。Roost 的 chezmoi 拷贝 + `defaults export/import`(§10)正是规避此坑的更安全方案 —— 本设计选择得到佐证。
- **分工(直接影响 catalog 范围)**:Mackup 把 plist 与文件混在一个 app 里(如 iTerm2 = `Library/Preferences/com.googlecode.iterm2.plist`)。在 Roost:**plist 类走既有 `appconfig`(defaults 导出),文件类走本 catalog**。catalog **只收文件式配置**,plist 域路由到 appconfig,不重复。
- **多版本**:Mackup 对 DataGrip **逐版本枚举**(`DataGrip2017.3`…`JetBrains/DataGrip2023.2`),存在哪个备哪个,还原回同名版本路径。印证 v1「列全 + 存在性检测 + 还原原路径 + 警示」是业界标准;Roost 用 **glob**(`JetBrains/*/options`)比逐版本枚举更省维护。
- **法律**:Mackup 为 GPLv3,**禁止把其 `.cfg` 文件抄进本 MIT 仓库**。但"某 App 配置在哪个路径"是**事实**(不受版权保护)。故 Roost **自行编写** `app-config-catalog.yaml`,以 Mackup 等为**参照而非拷贝**,并在文件头注明来源参考。

来源:[lra/mackup](https://github.com/lra/mackup) · [Mackup .cfg 格式/applications](https://github.com/lra/mackup/tree/master/src/mackup/applications) · [Mackup PyPI](https://pypi.org/project/mackup/)。

## 决定

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

## 还原映射:多版本 / 指定目录(用户期望流程)

纯 chezmoi 还原会写回**死的相对路径**(`~/Library/.../DataGrip2026.1/options`),从机若装的是别的版本(2025.3)就对不上。目标设计(用户确认)是**两端都引导选择**:

- **主机(capture/选择时)**:catalog 命中多实例/多版本时(如 DataGrip 2024.1/2025.2/2026.1),**列出全部让用户勾选**要备份哪个(而非默默全收或只收一个)。
- **从机(load/还原时)**:
  1. 先**检测并列出从机已安装**的对应 App/版本(如"已装 DataGrip2025.3");
  2. 让用户**选择还原目标** —— 映射到从机现有目录,或**手动指定一个目录**;
  3. 按所选目标写入(而非原始相对路径)。

**分期与影响(重要)**:
- 这改变了 load/apply 的语义(目前 `chezmoi apply` 写固定相对路径),需要**路径重写/拷贝到所选目标**的机制 —— 不是 chezmoi 原生能力,属较大改动。
- 倾向**单独成阶段**(可能拆出 ADR-0008「引导式还原与路径映射」),不与本 ADR 的"发现/catalog"耦合上线。
- **v1(本 ADR 范围内)**:仅做发现/catalog + 主机多版本勾选;**还原仍走原路径 + 明确警示**版本不匹配需手动处理。从机检测+指定目录留待后续阶段。

## 备选方案

- **A. 仅自定义路径(已交付)**:足够灵活但需用户自知路径。本 ADR 是其上的引导层,二者并存。
- **B. 在 core/dotfiles 代码里硬编码应用列表**:违反 I8(零硬编码、策展数据应为可覆盖数据文件)——**否决**。
- **C. 本 ADR:可覆盖策展数据文件**——既引导又不硬编码,用户可扩展。**选定(待审)**。

## 决议(审定 2026-05-31)

1. **首批 App(文件式,参照 Mackup 取经)**:
   - **VS Code / Cursor**:`Library/Application Support/{Code,Cursor}/User/{settings.json,keybindings.json,snippets}`(路径不带版本,干净往返)。
   - **JetBrains 全家桶**:`Library/Application Support/JetBrains/*/options`、`.../*/keymaps`(glob 覆盖各版本/各 IDE;只收 options/keymaps,排除缓存/索引)。
   - **文件式终端**:Alacritty / Kitty / WezTerm / Ghostty 的配置文件。
   - plist 类(iTerm2 等)**不进 catalog**,路由到既有 `appconfig`。其余留用户在 `roost/app-config-catalog.yaml` 覆盖/扩展。
2. **合并策略:按 `name` 合并,用户条目优先**(用户可覆盖默认 app 的 paths、或新增 app)。✅
3. **高风险项(DataGrip 等可能含 DB 凭据)**:默认**列出**,但候选标 `encrypt` 推荐 + 文件头/UI 警示;capture 仍过 Secret Scanner 硬门。✅
4. **引导式还原(多版本/指定目录)拆为 ADR-0008,单独排期;本 ADR 的 v1 = 发现/catalog + 主机多版本勾选,还原走原路径 + 版本不匹配警示。** ✅

## v1 实现范围(本 ADR)

- `app-config-catalog.yaml`(随包默认 + `roost/` 覆盖,按 name 合并),只含**通用文件式** App(零个人/公司路径,I8)。
- `dotfiles.discover()` 读 catalog → glob 展开 → 存在性过滤 → 产出候选(`note: "app config (<App>)"`,高风险标 `encrypt`)。
- 三类测试(单元/dry-run/幂等);文件头注明"参照 Mackup 等,非拷贝;GPLv3 文件未被引入"。
- **不含**:从机检测、指定还原目录、版本重映射(→ ADR-0008)。
