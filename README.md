<p align="center">
  <img src="packages/web/src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Roost" />
</p>

<h1 align="center">Roost</h1>

<p align="center">
  <em>Settle into any Mac.</em><br/>
  Back up your setup on one machine, restore it onto another — you choose exactly what.
</p>

<p align="center">
  <a href="#english">English</a> · <a href="#中文">中文</a> · <a href="./LICENSE">MIT</a> · macOS
</p>

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
| **dotfiles** | tracked config files (via chezmoi; secrets encrypted) |
| **packages** | your Homebrew Brewfile |
| **appconfig** | selected macOS app preferences (`defaults`) |
| **projects** | your git repos (re-cloned on restore) |
| **aliases & env** | portable shell aliases / env vars / PATH / functions |
| **skills** | cross-IDE agent skills (Claude Code / Codex / Gemini / OpenCode), distributed by symlink or copy |

### Highlights

- **Sync Review** — a git-like view of how this machine differs from your repo (*in sync / repo-newer / local-newer / conflict*). Safe changes auto-resolve; only real conflicts ask you. Per-item two-column diff, batch apply, every overwrite backed up.
- **Second-machine onboarding** — `roost clone`, a doctor pre-flight gate, and an **Environment check** page that one-click-installs missing tools via Homebrew.
- **Skill import** — bring skills in from a **.zip** (drag-drop) or a **git URL**; scan the source, pick which to import (secret/size gated).

### Install the desktop app

Download `Roost_<version>_<arch>.dmg` from [Releases](../../releases), open it, and drag **Roost** into Applications.

**First launch** (not yet Apple-signed): right-click `Roost.app` → **Open** → **Open**, or run `xattr -dr com.apple.quarantine /Applications/Roost.app`.

**Build it yourself** (requires the Rust toolchain):

```bash
pnpm install
pnpm build:desktop   # builds the engine sidecar, then the Tauri app
```

### Quick start (dev)

```bash
pnpm install
pnpm -r build
pnpm test
node packages/cli/dist/index.js doctor   # later: `roost doctor`
```

### Two repos — don't mix them

- **Roost** (this repo) — the engine + CLI + desktop app. Ships with **zero personal data**.
- **Your config repo** — your private git repo, the single source of truth (Roost's chezmoi source).

### Documentation

Full user docs (English + 中文) live in [`website/`](./website) — a Starlight (Astro) site:

```bash
pnpm --dir website install
pnpm --dir website dev
```

### License

The engine (CLI + libraries) is open source under the **MIT** license — see [LICENSE](./LICENSE) and [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md). Roost follows an **open-core** model. Contributions require a DCO sign-off (`git commit -s`); see [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/adr/0003-license-and-business-model.md](./docs/adr/0003-license-and-business-model.md).

---

## 中文

**Roost** 是开源的 macOS 配置备份与迁移工具。在主力机上**选择**要管理的内容,Roost 存进**你自己的私有 git 仓库**;到另一台 Mac 上一键**恢复** —— 配套原生桌面应用,清楚展示备份了什么、哪里有差异。

> Roost 之于你的配置仓库,正如 git 之于你的代码仓库:**工具我们做,数据你拥有。**

### 为什么安全

- **数据始终是你的。** 一切存在**你自己的**私有 git 仓库 —— 无服务器、无账号、**无遥测**,不上报任何东西。
- **默认可逆。** 每次应用先预览(dry-run),**覆盖前先备份**原文件。
- **密钥可选且加密。** 多数配置无需密钥;若备份密钥,用你自己的 [age](https://github.com/FiloSottile/age) 私钥加密,绝不在界面/日志显形,且有扫描器拦截明文密钥入库。
- **薄编排层。** Roost 只编排可信工具([chezmoi](https://www.chezmoi.io/)、Homebrew、age、[mise](https://mise.jdx.dev/)),不重造轮子。

### 管理哪些内容

| 模块 | 备份什么 |
|---|---|
| **dotfiles** | 被管配置文件(经 chezmoi;密钥加密) |
| **packages** | 你的 Homebrew Brewfile |
| **appconfig** | 选定的 macOS 应用偏好(`defaults`) |
| **projects** | 你的 git 仓库(恢复时重新 clone) |
| **别名与环境** | 可移植的 shell 别名 / 环境变量 / PATH / 函数 |
| **skills** | 跨 IDE 的 agent 技能(Claude Code / Codex / Gemini / OpenCode),软链或拷贝分发 |

### 亮点

- **同步复核** —— git 式地展示本机与仓库的差异(*已同步 / 仓库较新 / 本地较新 / 冲突*)。安全变更自动处理,只有真冲突才问你。逐项两栏 diff、批量应用、覆盖前必备份。
- **第二台机引导** —— `roost clone`、doctor 预检硬门,以及一个**环境检查**页:缺的工具用 Homebrew 一键安装。
- **技能导入** —— 从 **.zip**(拖拽)或 **git 地址**导入;先扫描来源、勾选要导入的(过密钥/体积门)。

### 安装桌面应用

从 [Releases](../../releases) 下载 `Roost_<version>_<arch>.dmg`,打开后把 **Roost** 拖进「应用程序」。

**首次启动**(尚未 Apple 签名):右键 `Roost.app` → **打开** → **打开**,或运行 `xattr -dr com.apple.quarantine /Applications/Roost.app`。

**自行构建**(需 Rust 工具链):`pnpm install && pnpm build:desktop`。

### 两个仓库 —— 别混淆

- **Roost**(本仓库):引擎 + CLI + 桌面应用,**零个人数据**。
- **你的配置仓库**:你的私有 git 仓库,即唯一事实源(Roost 的 chezmoi 源)。

### 文档与许可

完整文档(中英)见 [`website/`](./website)。引擎以 **MIT** 开源(见 [LICENSE](./LICENSE)),采用 **open-core** 模式;贡献需 DCO 签名(`git commit -s`,见 [CONTRIBUTING.md](./CONTRIBUTING.md))。
