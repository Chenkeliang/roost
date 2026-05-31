# ADR-0009: 逐包选择(Packages 从"整份 Brewfile"到"逐项选/逐项装")

- **状态**: 接受(ACCEPTED · 2026-05-31)。两阶段一起做(用户定:不分开)。Q1 自动展开哨兵=是;Q2 mas+tap 全纳入;Q3 不拆,Phase 1+2 一起。
- **日期**: 2026-05-31

## 背景

Packages 模块目前是**整份 Brewfile 单位**:
- `discover` 只产出一个 `Brewfile` 候选;
- `capture` 跑 `brew bundle dump --force` —— **把本机所有** formulae/casks/mas/taps 全导进仓库;
- `apply`(load)跑 `brew bundle` —— 在从机**全部装回**。

问题(用户反馈):
1. **主机端无法逐个选** —— 想只备份一部分(排除 `fig` 已停更、`go@1.18` 旧版、第三方 tap…)做不到,只能全有或全无。
2. **从机端无法逐个选装** —— `brew bundle` 一股脑全装,从机想只装子集做不到。

## 决定(待审)

把 packages 从"单一 Brewfile"升级为"**逐包条目**",两端都可选。

### 数据(无 selection schema 变更)
`selection.yaml` 的 `modules.packages` 仍是 `string[]`,但内容从 `["Brewfile"]` 变为**逐包 id**:
```yaml
packages:
  - "brew:git"            # formula
  - "cask:firefox"        # cask
  - "mas:1295203466"      # Mac App Store app id
  - "tap:homebrew/services"
```
**向后兼容**:若列表里仍是历史 `Brewfile` 哨兵 → 视为"全部"(沿用旧行为),首次逐项操作时迁移为展开的逐包 id。

### 主机端(capture)
- `discover`:枚举**已安装**包为候选(`brew leaves`/`brew ls --cask`/`mas list`/`brew tap`),id 如上,`note` 标类型。便宜有界(呼应 ADR-0006)。
- `capture`:**从 selection 的逐包 id 生成 Brewfile**(`brew "git"` / `cask "firefox"` / `mas "...", id: N` / `tap "..."`),不再无差别 `dump`。仓库里仍是标准 Brewfile(B 机可读)。

### 从机端(load)——本 ADR 的"新模型",影响 load 语义
现状 load = `brew bundle` 全装。新增**安装前选择**:
- 从机 Packages 页读取仓库 Brewfile 的条目,**逐项勾选**要装的;
- 生成一份**过滤后的临时 Brewfile** → `brew bundle --file <tmp>` 只装所选;
- 默认全选(等价旧行为),用户可取消勾选不想装的。

## 触及不变量 / 为何需要本 ADR
- **改 load 行为**(从"全装"到"可选装")—— 按变更控制(architecture §11–§13)属 load 模型变化,须 ADR。
- **I4 模块为唯一扩展点**:逻辑全落在 packages 模块的 discover/capture/apply,不 hack core。
- **I1 薄编排**:仍只编排 `brew`/`brew bundle`,不自实现包管理。
- **selection 仍是 string[]**(无 schema 变更);"全部"哨兵向后兼容。

## 分期
- **Phase 1(主机端逐选)**:discover 枚举逐包 + capture 生成过滤 Brewfile + web Packages 页改为"已选/未选"两 Tab(与 Dotfiles 等一致,可批量)。**这是用户主诉求,改动内聚、风险低。**
- **Phase 2(从机端逐装)**:load 前选择 + 过滤 Brewfile 安装。改 load 模型,较大;可与 ADR-0008(引导式还原)同属"从机选择性 load"主题,单独排期。

## 备选
- 保持整份 Brewfile + 让用户手编仓库 Brewfile 排除 —— 可行但反直觉、易错。**否决为默认**(仍可手编)。
- 逐包但仅主机端、从机仍全装 —— 解决一半;用户明确要从机也能选,故纳入 Phase 2。

## 待确认问题
1. 历史 `Brewfile` 哨兵的迁移:首次进 Packages 页时**自动展开**为逐包 id(默认全选),可否?(建议:是。)
2. mas / tap 是否纳入逐选,还是只 formulae+casks?(建议:全纳入,tap 通常随其 formula/cask 自动需要,可默认跟随。)
3. Phase 2 从机选装是否拆为独立排期(本 ADR 仅承诺 Phase 1)?(建议:是。)
