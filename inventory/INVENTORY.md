# Roost 主力机配置盘点（Inventory）

> 机器：keliang 的 Mac（macOS 26.5, Apple Silicon, zsh）
> 盘点日期：2026-05-30
> 方法：5 路并行只读扫描（dotfiles / 软件 / app 配置域 / 敏感项 / 项目仓库），未修改任何文件，敏感项仅记路径不读内容。
> 用途：作为 Roost 备份/同步的事实基线（"哪些 track、哪些 encrypt、哪些 exclude"）。

## 0. 关键结论

1. **"乱"的根因是缓存臃肿，不是配置多。** home 下约 **22GB** 是可排除的缓存/版本管理器（`.gemini` 13GB、`.nvm` 3.7GB、`.cache` 1.7GB、`.vscode` 1.2GB、`.codeium` 910MB、`.cursor`+`.windsurf` ~1.3GB、`.fig` 237MB、`.codex` 93MB、`.oh-my-zsh` 28MB）。**这些绝不进备份**——这就是为什么不能无脑同步整个 `~`。
2. 剔除缓存后真正要管的很少：**~25 个文本 dotfile（track）+ ~7 个敏感项（encrypt）**。
3. **697 个 `defaults` 偏好域 / 761 个沙盒容器** —— 不可能全量，必须精选（~30）并靠 Learn Mode 增量纳管。
4. **60 个 git 仓库**，绝大多数是 `gitlab.luojilab.com` 业务服务，可用清单还原；**真正风险是：1 个无 remote + 14 个有未提交改动**（迁移前必须先处理，见 §6）。
5. **~45 个 GUI 应用没走 Homebrew**，其中很多其实有 cask（chrome/edge/zed/cursor/datagrip/intellij/iterm2/karabiner/orbstack/iina/sourcetree…），建议补成 cask 提升可还原率。

---

## 1. Dotfiles 分类

### ✅ track（git 明文存）
shell：`.zshrc` `.zprofile` `.zshenv` `.bash_profile` `.bashrc` `.p10k.zsh`
git：`.gitconfig` `.gitignore_global` `.gitflow_export` `.config/git/`
编辑器/终端：`.config/zed/` `.config/iterm2/` `.vim/`（不含 `.viminfo`）`.config/fish/`
工具：`.config/yazi/` `.config/uv/` `.config/jgit/` `.config/configstore/` `.config/preset/` `.config/sourcery/` `.gitnexus/`
AI 工具：`.claude/` `.claude.json` `.copilot/` `.kiro/` `.trae/` `.config/opencode/`

### 🔐 encrypt（age 加密后存）
- `~/.ssh/id_ed25519`、`~/.ssh/id_rsa`（私钥）
- `~/.ssh/config`（含主机/身份映射）
- `~/.git-credentials`（明文 HTTPS 凭据）
- `~/.npmrc`（含 `_authToken`）
- `~/.config/env.sh`（含 `GEMINI_API_KEY` 等）
- `~/.config/gh/`（GitHub CLI OAuth token）
- `~/.aws/`（**待确认**：目录存在但盘点未发现 `credentials` 文件；若用到则加密，否则只 track `config`）

### 🚫 exclude（缓存/可重装，~22GB）
`.gemini`(13G) `.nvm`(3.7G) `.cache`(1.7G) `.vscode`(1.2G) `.codeium`(910M) `.cursor`+`.windsurf`(~1.3G) `.fig`(237M) `.cargo`(173M) `.config/raycast`(160M,扩展缓存) `.codex`(93M) `.config/clash*`(47M) `.oh-my-zsh`(28M,可重装) `.gvm`
状态类：`.zsh_history` `.bash_history` `.viminfo` `.ssh/known_hosts` `*.backup*`

---

## 2. 环境变量（来自 .zshrc / .bashrc / .config/env.sh）

**非敏感（随 shell rc / env.sh 一起 track）**：`ZSH` `RUN_ENV` `GOOGLE_CLOUD_PROJECT` `NODE_PATH` `PATH` `G_MIRROR` `NVM_DIR` `HOMEBREW_API_DOMAIN` `HOMEBREW_BOTTLE_DOMAIN` `GOROOT` `GOPATH` `GO111MODULE` `GONOPROXY` `GOPRIVATE` `GOPROXY` `NODE_OPTIONS` `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` 等。

**敏感（值已隐去，随 encrypt 项处理）**：`GEMINI_API_KEY`（在 `.config/env.sh`）。

> 建议：把含密钥的 env 从 `.config/env.sh` 拆出，明文 env 放 track 的 rc，密钥放 age 加密文件，由 shell 启动时 source 解密结果。

---

## 3. 软件 → 详见 `Brewfile.draft`

- Homebrew：**40 formulae（leaves）+ 14 cask**，已生成 `Brewfile.draft`。
- npm 全局 8 个、`go install` 工具 5 个 → 已在 `Brewfile.draft` 末尾**以注释列出**（非 Brewfile 原生指令，需单独脚本 `npm i -g` / `go install`）。
- mas（App Store）：**当前未登录**，`mas list` 为空；新系统 `mas signin` 已失效，需先在「系统设置」手动登录 Apple ID，且只能装"已购买"应用。
- **注意事项**：
  - `homebrew/services` tap 指向 USTC 镜像 → 机器相关，迁移时确认是否保留。
  - `eslint-plugin-duckquery` 是本地路径软链（`-> .../mypy/duckdb-query/...`），新机无法直接还原。
  - ~45 个 GUI 应用未走 brew（清单见 `Brewfile.draft` 注释区），建议用 `brew search <名>` 确认后补成 cask。

---

## 4. 应用配置（697 域）→ 精选 ~30，靠 Learn Mode

全量 697 域不可行。**精选纳管目标**（用 `defaults export` 导文本，**不要符号链接**，避开 Sonoma+ 的 cfprefsd 坑）：

- 系统：`com.apple.dock` `com.apple.finder` `com.apple.screencapture` `com.apple.spaces` `com.apple.HIToolbox`（输入法快捷键）`com.apple.AppleMultitouchTrackpad` `NSGlobalDomain`
- 终端/编辑器：`com.googlecode.iterm2`（+ app-support）`dev.zed.Zed`（+ `~/Library/Application Support/Zed`）`com.apple.dt.Xcode` `com.jetbrains.*`（+ `~/Library/Application Support/JetBrains`）`Cursor`（app-support）
- 工具：`com.raycast.macos`（域 + app-support）`cc.ffitch.shottr` `com.colliderli.iina` `org.zotero.zotero`
- **skip**（账号/机器相关）：`cn.apifox.app` `com.adspower.global` `com.alibaba.DingTalkMac` 等

> Learn Mode：录制前后各 `defaults export` 一次，diff 出变更域/键，按 bundle id 关联 → 任意 app（含 mackup 不认识的）都能纳管。

---

## 5. 敏感项（仅路径，未读内容）

**🔐 建议 age 加密入库**：`~/.ssh/id_ed25519` `~/.ssh/id_rsa` `~/.ssh/config` `~/.git-credentials` `~/.npmrc`（+ §1 的 `.config/env.sh`、`.config/gh/`）。

**🚫 建议排除（机器相关/可重生成）**：`~/.docker/config.json`（重新 `docker login`）`~/.kube/config`（重新获取 kubeconfig）`~/.ssh/known_hosts` `~/.ssh/agent/*`（socket）。

**未发现**：`~/.aws/credentials` `~/.netrc` `~/.pypirc` `~/.cargo/credentials`。

---

## 6. 项目（60 仓库）→ 详见 `projects.draft.yaml`

绝大多数是 `~/go/src/gitlab.luojilab.com/...` 下的 Go 业务服务，可靠清单 clone 还原。**迁移前必须处理的风险**：

- ⚠️ **无 remote**（清单无法还原）：`~/.qclaw/workspace`（且有未提交改动，风险最高）。
- ⚠️ **有未提交改动**（14 个）：`atr/atr-marketing`、`foundation/iap-center`、`foundation/jccoin`、`foundation/passgo_portal`、`igetserver/odob`、`igetserver/vip_cards_business`、`rock/iap`、`shzf/bcp-admin`、`shzf/bcp-rule`、`shzf/goblin-metrics`、`shzf/gosupload`、`~/.config/yazi`、`~/.hermes/hermes-agent`。→ 迁移前先 commit/push 或单独备份。
- 🧹 清理项：`foundation/warehouse.git`（目录名多 `.git` 后缀，与 `foundation/warehouse` 重复）；`shzf/bcp-admin` 路径名与 remote（`goblin-admin`）不一致；`rock/go_center_bill` 与 `~/Desktop/deskcloud/go_center_bill` 是同一 remote 两处克隆。
- 已从清单剔除的"工具仓库"（由别的机制管理，不进 projects）：`.nvm` `.oh-my-zsh` `.codex/.tmp/plugins`。
- 所有 go 业务仓库均无 `.env/.mise/.envrc` → 环境大概率靠 Consul/k8s 注入，per-project env 模块对这批用处不大（主要服务个人项目）。

---

## 7. 映射到 Roost 模块

| Roost 模块 | 对应本盘点 | 种子文件 |
|---|---|---|
| dotfiles（chezmoi） | §1 track + §2 明文 env | — |
| 密钥（age/sops） | §1 encrypt + §5 | — |
| packages（Brewfile） | §3 | `Brewfile.draft` |
| appconfig（Learn Mode） | §4 | （P2 生成） |
| projects（清单 + mise） | §6 | `projects.draft.yaml` |

> 下一步建议：① 先处理 §6 的未提交改动与无 remote 仓库；② 把本盘点的分类固化进 Roost 设计文档（spec）；③ 进入 writing-plans 出实施计划。
