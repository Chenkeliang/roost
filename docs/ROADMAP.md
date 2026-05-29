# Roost ROADMAP

> 工作名 **Roost**(命名待定,见末尾)。本文件是阶段总览与续接入口。约束来源:`docs/superpowers/specs/`(LOCKED)、`docs/adr/`、`CLAUDE.md`。变更走 architecture §12–13 的 ADR。

## 阶段总览
| 阶段 | 目标 | 交付(可独立工作的软件) | 计划 |
|---|---|---|---|
| **P0** | 地基 | pnpm monorepo + 类型/接口 + exec 适配器 + 注册表 + 日志脱敏 + i18n + CLI 骨架 + CI(含 macOS runner)+ OSS 骨架 | `plans/2026-05-30-p0-foundation.md` |
| **P1** | MVP | dotfiles + secrets(age,密钥托管,扫描)+ Brewfile + 选择向导 + `capture`/`load`(安全可逆)/`list` + bootstrap | `plans/2026-05-30-p1-mvp.md` |
| **P2** | 扩展 | appconfig 通用发现 + Learn Mode、projects + mise、导入器、审计、密钥轮换 | `plans/2026-05-30-p2-extend.md` |
| **P3** | GUI | Tauri 桌面应用(漂移仪表盘 + 时间线回滚 + 可视化管理),见 ADR-0002 | 待 P1 后用 writing-plans 展开 |

## MVP 切线(P1 最小可发)
**做**:dotfiles、secrets、Brewfile、CLI(`init`/`select`/`capture`/`load`/`list`/`status`/`diff`/`doctor`)、bootstrap、选择向导(CLI)、age 密钥托管 + 扫描 + 覆盖前备份。
**先不做(挪 P2)**:projects+mise、appconfig/Learn Mode、导入器、Web/GUI。
理由:最快拿到"全新用户在两台 Mac 间往返"的真实反馈。

## i18n 决策
英文为主 + 中文。字符串从 P0 起走 `t()` 机制(`packages/core/src/i18n`),禁硬编码面向用户的文案。

## Lead-time 清单(尽早办,别卡进度)
- [ ] **名称 + 可用性**:npm `@roost`/包名、GitHub org/repo、Homebrew tap 名(域名暂不考虑)。
- [ ] **Apple Developer ID($99/年)**:P3 的 Tauri 应用需签名+公证;注册与首次公证有 lead time。
- [ ] **macOS CI runner**:P0 即接入 GitHub Actions `macos-latest`,保证往返冒烟在真 macOS 上跑。

## 治理 / 续接
- 三份 spec 与本路线 **LOCKED**;改架构/范围/schema 必须新增 ADR(`docs/adr/`)。
- **如何续接**:新会话先读 `CLAUDE.md` → 对应阶段 `plans/*.md` → 勾选未完成 task 往下做;偏离锁定基线必须先开 ADR。

## 命名建议(未定)
留 **Roost**(清晰安全)或换可品牌化短名:**Roost**(首推)/ Decant / Ferry / Stowaway。改名 = 一次全局替换 + 包名/bin 调整,不阻塞 P0。
