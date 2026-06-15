<p align="center">
  <img src="packages/web/src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Roost" />
</p>

<h1 align="center">Roost</h1>

<p align="center">
  <em>在任意一台 Mac 上安顿下来。</em><br/>
  在一台机器上备份你的配置,在另一台上恢复 —— 备份什么,完全由你决定。
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a> · <a href="./LICENSE">MIT</a> · macOS · <a href="https://chenkeliang.github.io/roost/">文档 Docs</a>
</p>

<p align="center">
  <a href="https://github.com/Chenkeliang/roost/releases/latest"><strong>下载桌面应用 (.dmg) →</strong></a>
</p>

---

## 中文

**Roost** 是开源的 macOS 配置备份与迁移工具。在你的主力机上**勾选**要管理的内容,Roost 把它存进**你自己的私有 git 仓库**;到另一台 Mac 上一键**恢复** —— 配套原生桌面应用,清楚展示备份了什么、哪里有差异。

> Roost 之于你的配置仓库,就像 git 之于你的代码仓库:**工具我们来做,数据你自己拥有。**

### 为什么放心用

- **数据始终是你的。** 一切都在**你自己**的私有 git 仓库里 —— 无服务器、无账号、**无遥测**,不向任何地方上报。
- **默认可逆。** 每次 apply 先预演(dry-run),**覆盖前先备份原文件**。
- **密钥可选且加密。** 多数场景无需密钥;若要备份密钥,用你自己的 [age](https://github.com/FiloSottile/age) 密钥加密,绝不在 UI 或日志里显形,且有扫描器阻止明文密钥入库。
- **薄编排层。** Roost 只编排可信工具([chezmoi](https://www.chezmoi.io/)、Homebrew、age、[mise](https://mise.jdx.dev/)),不重造它们。

### 管理什么

| 模块 | 备份内容 |
|---|---|
| **AI 工具** | AI 工具配置 —— Claude Code / Claude Desktop / Codex / Gemini CLI 的记忆文件、设置、MCP 配置(敏感项 age 加密;OAuth / 会话令牌**永不**备份) |
| **dotfiles** | 跟踪的配置文件(经 chezmoi;密钥加密) |
| **packages** | 你的 Homebrew Brewfile |
| **appconfig** | 选中的 macOS 应用偏好(`defaults`) |
| **projects** | 你的 git 仓库(恢复时重新克隆) |
| **aliases & env** | 可移植的 shell 别名 / 环境变量 / PATH / 函数 |
| **skills** | 跨 IDE 的 agent skills(Claude Code / Codex / Gemini / OpenCode),以软链或拷贝分发 |

### 亮点

- **换机迁移,克隆即恢复** —— 新 Mac 上克隆仓库,环境检查自动补齐缺的工具,逐项恢复全套配置。
- **AI 工具配置纳管** —— 备份 Claude Code / Codex / Gemini 等的记忆、设置、MCP 配置;敏感项加密、会话令牌永不入库。与 cc-switch 这类供应商切换器并存:它们管「此刻用哪个」,Roost 在底下把这一切加密备份,不争抢文件。
- **同步复核:本机 vs 仓库逐项比对** —— 安全项自动合、冲突才问你、覆盖前先备份;逐项或整模块 diff 随你看。
- **版本历史 + 文件级回滚** —— 每次备份是一条可读的变更日志提交;翻任意文件历史,一键把旧版本恢复到仓库。
- **内联文件预览** —— 点文件名直接看内容;加密项、凭据、含密钥的文件不显形。
- **自动备份 + 保鲜提醒** —— 每日 / 每周自动备;落后 / 未推送 / 超 7 天未备时横幅提醒;大文件先拦,仓库不膨胀。
- **Skills 跨 IDE 分发管理** —— 一眼看全各工具覆盖度,从文件夹 / zip / git 纳入,自定义分发目标。
- **Skills 管理** —— 按工具覆盖度一目了然;从**本地文件夹 / .zip / git 地址**纳入已有 skill(过密钥/体积门);可自定义分发目标目录。

### 安装桌面应用

从 [Releases](https://github.com/Chenkeliang/roost/releases/latest) 下载对应架构的 `.dmg`(**Apple Silicon**:`aarch64`;**Intel**:`x64`),打开后把 **Roost** 拖进「应用程序」。

> **首次启动**(已 ad-hoc 签名,但未经 Apple 公证):右键 `Roost.app` →「打开」→「打开」。若提示「已损坏,无法打开」:先把 Roost 拖进「应用程序」,再在终端运行 `xattr -cr /Applications/Roost.app`,然后打开。

**或自行构建**(需 Rust 工具链):

```bash
pnpm install
pnpm build:desktop   # 构建引擎 sidecar + Tauri 应用
# → packages/web/src-tauri/target/<triple>/release/bundle/(Roost.app + .dmg)
```

### 命令行(从源码运行)

CLI / 引擎目前从源码运行(尚未发布独立二进制):

```bash
pnpm install
pnpm -r build
node packages/cli/dist/index.js doctor     # 之后:roost doctor
```

### 两个仓库 —— 别混淆

- **Roost**(本仓库)—— 引擎 + CLI + 桌面应用,**零个人数据**。
- **你的配置仓库** —— 你自己的私有 git 仓库,唯一真相源(即 Roost 的 chezmoi 源)。

### 文档

完整文档(中英双语)在 https://chenkeliang.github.io/roost/ 。 本地预览:

```bash
pnpm --dir website install
pnpm --dir website dev
```

### 许可证

引擎(CLI + 库)以 **MIT** 开源 —— 见 [LICENSE](./LICENSE) 与 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md);Roost 采用 **open-core** 模式。贡献需 DCO 签名(`git commit -s`),见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [docs/adr/0003-license-and-business-model.md](./docs/adr/0003-license-and-business-model.md)。

---

## English

**Roost** is an open-source macOS configuration backup & migration tool. On your main Mac you **select** what to manage; Roost stores it in **your own private git repo**; on another Mac you **restore** it — with a native desktop app that shows exactly what's backed up and what differs.

> Roost is to your config repo what git is to your code repo: **we build the tool, you own the data.**

### Why it's safe

- **Your data stays yours.** Everything lives in **your** private git repository — no server, no account, **no telemetry**, nothing phoned home.
- **Reversible by default.** Every apply previews first (dry-run) and **backs up the existing file before overwriting**.
- **Secrets are optional and encrypted.** Most setups need no key. *If* you back up secrets, they're encrypted with your own [age](https://github.com/FiloSottile/age) key, never shown in the UI or logs, and a scanner blocks plaintext secrets from entering the repo.
- **A thin orchestrator.** Roost coordinates trusted tools ([chezmoi](https://www.chezmoi.io/), Homebrew, age, [mise](https://mise.jdx.dev/)) rather than reimplementing them.

### What it manages

| Module | What it backs up |
|---|---|
| **AI tools** | AI tool configs — Claude Code / Claude Desktop / Codex / Gemini CLI memory files, settings, MCP config (sensitive entries age-encrypted; OAuth/session tokens are **never** backed up) |
| **dotfiles** | tracked config files (via chezmoi; secrets encrypted) |
| **packages** | your Homebrew Brewfile |
| **appconfig** | selected macOS app preferences (`defaults`) |
| **projects** | your git repos (re-cloned on restore) |
| **aliases & env** | portable shell aliases / env vars / PATH / functions |
| **skills** | cross-IDE agent skills (Claude Code / Codex / Gemini / OpenCode), distributed by symlink or copy |

### Highlights

- **New Mac, clone and restore** — clone your repo on the new machine; an Environment Check installs missing tools, then you restore your whole setup per item.
- **AI tool configs, managed** — back up Claude Code / Codex / Gemini memory files, settings, and MCP config; sensitive entries encrypted, session tokens never stored. It lives alongside provider-switchers like cc-switch — they pick *which provider you use now*; Roost backs it all up underneath, encrypted, without fighting for the files.
- **Sync Review: item-by-item, machine vs repo** — safe changes auto-merge, only real conflicts ask you, every overwrite is backed up first; per-item or whole-module diff.
- **Version history + per-file rollback** — every backup is a readable changelog commit; browse any file's history and restore an old version to the repo in one click.
- **Inline file preview** — click a file to see its contents; encrypted, credential, and secret-bearing files are never shown.
- **Auto-backup + freshness nudges** — daily/weekly auto-capture; banners when you're behind, unpushed, or overdue; large files gated so the repo never bloats.
- **Skills, distributed across IDEs** — coverage per tool at a glance; adopt from a folder / zip / git URL, with custom distribution targets.

### Install the desktop app

Download the `.dmg` for your Mac from [Releases](https://github.com/Chenkeliang/roost/releases/latest) (**Apple Silicon**: `aarch64`; **Intel**: `x64`), open it, and drag **Roost** into Applications.

> **First launch** (ad-hoc signed, not Apple-notarized): right-click `Roost.app` → **Open** → **Open**. If it says it's "damaged and can't be opened": drag Roost into Applications, then run `xattr -cr /Applications/Roost.app` in Terminal and open it.

**Or build it yourself** (requires the Rust toolchain):

```bash
pnpm install
pnpm build:desktop   # builds the engine sidecar + Tauri app
# → packages/web/src-tauri/target/<triple>/release/bundle/ (Roost.app + .dmg)
```

### CLI (run from source)

The CLI / engine runs from source today (no standalone binary published yet):

```bash
pnpm install
pnpm -r build
node packages/cli/dist/index.js doctor     # later: roost doctor
```

### Two repos — don't mix them

- **Roost** (this repo) — the engine + CLI + desktop app. Ships with **zero personal data**.
- **Your config repo** — your private git repo, the single source of truth (Roost's chezmoi source).

### Documentation

Full docs (English + 中文) at **https://chenkeliang.github.io/roost/**. Preview locally:

```bash
pnpm --dir website install
pnpm --dir website dev
```

### License

The engine (CLI + libraries) is open source under the **MIT** license — see [LICENSE](./LICENSE) and [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md). Roost follows an **open-core** model. Contributions require a DCO sign-off (`git commit -s`); see [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/adr/0003-license-and-business-model.md](./docs/adr/0003-license-and-business-model.md).
