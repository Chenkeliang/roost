# ADR-0010: 任意文件加密标记 + 被拦项的告知与加密重试

- **状态**: 接受(ACCEPTED · 2026-05-31)。用户定:做。
- **日期**: 2026-05-31

## 背景

ADR-0007 H1 让 dotfiles capture 内容扫描:非加密路径若含疑似密钥则**阻断**(`blocked`),不明文入库。实测命中 `.config/clash`、`.cc-switch`、`.config/raycast` 等。问题:
1. **UI 不告知** —— Capture 只弹"Captured N",被拦项对用户不可见。
2. **无法补救** —— 用户想迁这些(代理配置、token),但只有 catalog 项(如 DataGrip)能自动加密;**任意路径无法标记加密**。
3. **无重试** —— 没有"标加密→再试"的闭环。

## 决定

### 1. 任意路径加密标记(无 schema 变更)
`selection.yaml` 的 `modules` 是 `Record<string, string[]>`。新增一个**约定键** `dotfiles-encrypt`,存被显式标记加密的绝对路径:
```yaml
modules:
  dotfiles: [ "/Users/me/.config/clash", ... ]
  dotfiles-encrypt: [ "/Users/me/.config/clash" ]   # 标记加密的子集
```
- 复用既有泛化端点:`addSelection("dotfiles-encrypt", path)` / `removeSelection(...)`(后者对未知"模块"是安全 no-op)。**无新端点、无 schema 变更。**
- `dotfiles.capture` 的加密判定增加第三来源:
  `wantsEncrypt = isSensitivePath(id) || catalogEncrypt(id) || sel.modules["dotfiles-encrypt"]?.includes(id)`
- 加密仍需 age 密钥(`ensureChezmoiAgeConfig`);无密钥则照旧阻断并提示生成。

### 2. 告知被拦项(UI)
Capture 后聚合各模块 `ChangeSet.blocked`,在 Overview 显示一个面板:列出被拦路径 + 原因(疑似密钥/过大),每项给操作。

### 3. 加密重试闭环
被拦项面板每项一个 **「🔒 加密并重试」**(及"全部加密重试"):
- → `addSelection("dotfiles-encrypt", path)` 标记;
- → 重新 `capture`;
- → 该项这次走加密(`encrypted_*.age`),不再被拦。
"过大"类(H3)不提供加密重试(应改用更精确子路径),只提示。

## 触及不变量
- **I6 密钥三禁**:核心目的——让本该加密的敏感文件**加密入库**而非明文或丢失;仍过 age 加密,密钥不入库。
- **I4 模块为唯一扩展点**:逻辑落在 dotfiles 模块;selection 仅多一个约定键(string[],无 schema 变更)。
- **I7 可逆**:标记/取消标记走 add/removeSelection,可逆。

## 备选
- 把 selection 项改成对象 `{path, encrypt}` —— 真 schema 变更,改动面大。**否决**(约定键足够)。
- 让用户手编仓库 + chezmoi 手动 `--encrypt` —— 反直觉。**否决**。

## 待确认
1. 约定键名 `dotfiles-encrypt` 可否?(建议:是。)
2. 被拦面板放 Overview(capture 入口处)还是各模块页?(建议:Overview,capture 后即时弹;Dotfiles 页也可标记。)
