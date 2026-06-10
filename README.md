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
| **dotfiles** | 跟踪的配置文件(经 chezmoi;密钥加密) |
| **packages** | 你的 Homebrew Brewfile |
| **appconfig** | 选中的 macOS 应用偏好(`defaults`) |
| **projects** | 你的 git 仓库(恢复时重新克隆) |
| **aliases & env** | 可移植的 shell 别名 / 环境变量 / PATH / 函数 |
| **skills** | 跨 IDE 的 agent skills(Claude Code / Codex / Gemini / OpenCode),以软链或拷贝分发 |

### 亮点

- **同步复核** —— git 式呈现本机与仓库的差异(*已同步 / 仓库较新 / 本地较新 / 冲突*)。安全变更自动处理,只有真冲突才问你。逐项两栏对比、批量应用、每次覆盖都先备份。
- **第二台机引导** —— `roost clone`、doctor 预检硬门,以及一个**环境检查**页:缺的工具用 Homebrew 一键安装。
- **Skills 管理** —— 按工具覆盖度一目了然;从**本地文件夹 / .zip / git 地址**纳入已有 skill(过密钥/体积门);可自定义分发目标目录。

### 安装桌面应用

从 [Releases](https://github.com/Chenkeliang/roost/releases/latest) 下载对应架构的 `.dmg`(**Apple Silicon**:`aarch64`;**Intel**:`x64`),打开后把 **Roost** 拖进「应用程序」。

> **首次启动**(尚未 Apple 签名):右键 `Roost.app` →「打开」→「打开」,或运行 `xattr -dr com.apple.quarantine /Applications/Roost.app`。

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

完整文档(中英双语)在 **https://chenkeliang.github.io/roost/**。本地预览:

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
| **dotfiles** | tracked config files (via chezmoi; secrets encrypted) |
| **packages** | your Homebrew Brewfile |
| **appconfig** | selected macOS app preferences (`defaults`) |
| **projects** | your git repos (re-cloned on restore) |
| **aliases & env** | portable shell aliases / env vars / PATH / functions |
| **skills** | cross-IDE agent skills (Claude Code / Codex / Gemini / OpenCode), distributed by symlink or copy |

### Highlights

- **Sync Review** — a git-like view of how this machine differs from your repo (*in sync / repo-newer / local-newer / conflict*). Safe changes auto-resolve; only real conflicts ask you. Per-item two-column diff, batch apply, every overwrite backed up.
- **Second-machine onboarding** — `roost clone`, a doctor pre-flight gate, and an **Environment check** page that one-click-installs missing tools via Homebrew.
- **Skills management** — coverage per tool at a glance; adopt existing skills from a **local folder / .zip / git URL** (secret/size gated); add custom distribution-target directories.

### Install the desktop app

Download the `.dmg` for your Mac from [Releases](https://github.com/Chenkeliang/roost/releases/latest) (**Apple Silicon**: `aarch64`; **Intel**: `x64`), open it, and drag **Roost** into Applications.

> **First launch** (not yet Apple-signed): right-click `Roost.app` → **Open** → **Open**, or run `xattr -dr com.apple.quarantine /Applications/Roost.app`.

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
