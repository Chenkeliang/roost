// Flat i18n string table. Keyed by dotted keys; each entry holds en + zh.
// Default render locale is "en" — the en values are the source of truth and
// match the strings the views shipped with, so English-default tests are
// unaffected.

export type Locale = "en" | "zh";

export const STRINGS: Record<string, { en: string; zh: string }> = {
  // ── Shared across module pages (discover / select / manage) ──────────────
  "common.discovered": { en: "Discovered", zh: "发现" },
  "common.added": { en: "Added", zh: "已添加" },
  "common.remove": { en: "Remove", zh: "移除" },
  "common.selected": { en: "selected", zh: "已选" },
  "common.addSelected": { en: "Add selected", zh: "添加选中" },
  "common.removeSelected": { en: "Remove selected", zh: "移除选中" },
  "common.stopManaging": { en: "Stop managing", zh: "停止管理" },
  "common.managed": { en: "Managed", zh: "已纳管" },
  "common.shownItems": { en: "shown", zh: "项" },
  "common.captured": { en: "captured", zh: "已捕获" },
  "common.pending": { en: "pending capture", zh: "待捕获" },
  "common.selectedTab": { en: "Selected", zh: "已选" },
  "common.discoveredTab": { en: "Discovered", zh: "未选/发现" },
  "common.allAddedTitle": { en: "All discovered items added", zh: "发现项已全部添加" },
  "common.allAddedSubtitle": { en: "Everything found is already in your selection.", zh: "扫描到的都已在你的选单里。" },

  // ── App shell: sidebar nav ──────────────────────────────────────────────
  "nav.overview": { en: "Overview", zh: "总览" },
  "nav.dotfiles": { en: "Dotfiles", zh: "Dotfiles" },
  "nav.packages": { en: "Packages", zh: "软件包" },
  "nav.projects": { en: "Projects", zh: "项目" },
  "nav.appconfig": { en: "App Config", zh: "应用配置" },
  "nav.env": { en: "Aliases & Env", zh: "别名与环境变量" },
  "nav.drift": { en: "Drift", zh: "偏移" },
  "nav.timeline": { en: "Timeline", zh: "时间线" },
  "nav.settings": { en: "Settings", zh: "设置" },
  "nav.modulesGroup": { en: "Modules", zh: "模块" },
  "app.docs": { en: "Docs", zh: "文档" },

  // ── Overview ─────────────────────────────────────────────────────────────
  "overview.capture": { en: "Capture", zh: "捕获" },
  "overview.capturing": { en: "Capturing…", zh: "捕获中…" },
  "overview.load": { en: "Load (dry-run)", zh: "加载（预演）" },
  "overview.loading": { en: "Loading…", zh: "加载中…" },
  "overview.moduleHealth": { en: "Module Health", zh: "模块健康度" },
  "overview.noStatus": {
    en: "No module status available. Is the Roost server running?",
    zh: "暂无模块状态。Roost 服务是否在运行？",
  },
  "overview.noOtherMachine": {
    en: "No other machine yet — run roost load on a second Mac to see it here.",
    zh: "暂无其他设备 —— 在第二台 Mac 上运行 roost load 即可在此显示。",
  },

  // ── Manage ─────────────────────────────────────────────────────────────────
  "manage.noModulesTitle": { en: "No modules tracked", zh: "尚未跟踪任何模块" },
  "manage.noModulesSubtitle": {
    en: "Run roost init to set up module tracking",
    zh: "运行 roost init 以设置模块跟踪",
  },

  // ── Projects ─────────────────────────────────────────────────────────────
  "projects.explainer": {
    en: "Git projects Roost can re-clone on a new Mac.",
    zh: "Roost 可在新 Mac 上重新克隆的 Git 项目。",
  },
  "projects.scan": { en: "Scan for git projects", zh: "扫描 Git 项目" },
  "projects.scanning": { en: "Scanning…", zh: "扫描中…" },
  "projects.noScanTitle": { en: "No scan yet", zh: "尚未扫描" },
  "projects.saved": { en: "Saved", zh: "已保存" },
  "projects.noScanSubtitle": {
    en: 'Click "Scan for git projects" to find repositories on this Mac.',
    zh: "点击「扫描 Git 项目」以查找此 Mac 上的仓库。",
  },
  "projects.emptyTitle": { en: "Nothing here", zh: "暂无内容" },
  "projects.emptySubtitle": {
    en: "No repositories match this host filter.",
    zh: "没有仓库匹配此主机筛选。",
  },

  // ── Packages ─────────────────────────────────────────────────────────────
  "packages.explainer": {
    en: "Homebrew formulae, casks & Mac App Store apps Roost can reinstall on a new Mac.",
    zh: "Roost 可在新 Mac 上重新安装的 Homebrew 配方、cask 及 Mac App Store 应用。",
  },
  "packages.noBrewTitle": { en: "Homebrew not installed", zh: "未安装 Homebrew" },
  "packages.noBrewSubtitle": {
    en: "Install Homebrew to manage packages — Roost won't run brew until it's available.",
    zh: "安装 Homebrew 以管理软件包 —— 在可用前 Roost 不会运行 brew。",
  },
  "packages.emptyTitle": { en: "No packages tracked yet", zh: "尚未跟踪任何软件包" },
  "packages.emptySubtitle": {
    en: "Import your installed Homebrew packages into the repo to manage them.",
    zh: "将已安装的 Homebrew 软件包导入仓库以进行管理。",
  },
  "packages.import": { en: "Import from this Mac", zh: "从此 Mac 导入" },
  "packages.importing": { en: "Importing…", zh: "导入中…" },

  // ── Dotfiles ─────────────────────────────────────────────────────────────
  "dotfiles.explainer": {
    en: "Config files Roost backs up & restores on a new Mac.",
    zh: "Roost 在新 Mac 上备份与恢复的配置文件。",
  },
  "dotfiles.scan": { en: "Scan for dotfiles", zh: "扫描 Dotfiles" },
  "dotfiles.scanning": { en: "Scanning…", zh: "扫描中…" },
  "dotfiles.addPath": { en: "Add path", zh: "添加路径" },
  "dotfiles.customPathPlaceholder": {
    en: "Back up any absolute path — e.g. /Users/you/Library/Application Support/JetBrains/DataGrip2024.1/options",
    zh: "备份任意绝对路径 — 例如 /Users/你/Library/Application Support/JetBrains/DataGrip2024.1/options",
  },
  "dotfiles.discovered": { en: "Discovered", zh: "发现" },
  "dotfiles.added": { en: "Added", zh: "已添加" },
  "dotfiles.remove": { en: "Remove", zh: "移除" },
  "dotfiles.selected": { en: "selected", zh: "已选" },
  "dotfiles.addSelected": { en: "Add selected", zh: "添加选中" },
  "dotfiles.removeSelected": { en: "Remove selected", zh: "移除选中" },
  "dotfiles.noChezmoiTitle": { en: "chezmoi not installed", zh: "未安装 chezmoi" },
  "dotfiles.noChezmoiSubtitle": {
    en: "Install chezmoi to manage dotfiles — Roost won't run chezmoi until it's available.",
    zh: "安装 chezmoi 以管理 dotfiles —— 在可用前 Roost 不会运行 chezmoi。",
  },
  "dotfiles.emptyMatchTitle": { en: "Nothing here", zh: "暂无内容" },
  "dotfiles.emptyMatchSubtitle": { en: "No dotfiles match this filter.", zh: "没有 dotfiles 匹配此筛选。" },
  "dotfiles.emptyTitle": { en: "No dotfiles selected yet", zh: "尚未选择任何 dotfiles" },
  "dotfiles.emptySubtitle": {
    en: 'Click "Scan for dotfiles" to find config files on this Mac, then Add them.',
    zh: "点击「扫描 Dotfiles」找到此 Mac 上的配置文件,再添加它们。",
  },

  // ── App Config ───────────────────────────────────────────────────────────
  "appconfig.explainer": {
    en: "App preference domains Roost backs up & restores on a new Mac.",
    zh: "Roost 在新 Mac 上备份与恢复的应用偏好域。",
  },
  "appconfig.scan": { en: "Scan app preferences", zh: "扫描应用偏好" },
  "appconfig.scanning": { en: "Scanning…", zh: "扫描中…" },
  "appconfig.unavailableTitle": { en: "defaults unavailable", zh: "defaults 不可用" },
  "appconfig.unavailableSubtitle": {
    en: "App preferences are read with macOS `defaults` — unavailable on this machine.",
    zh: "应用偏好通过 macOS `defaults` 读取 —— 此设备上不可用。",
  },
  "appconfig.emptyMatchTitle": { en: "Nothing here", zh: "暂无内容" },
  "appconfig.emptyMatchSubtitle": { en: "No domains match this filter.", zh: "没有域匹配此筛选。" },
  "appconfig.emptyTitle": { en: "No app config managed yet", zh: "尚未管理任何应用配置" },
  "appconfig.emptySubtitle": {
    en: "Scan to find app preference domains on this Mac.",
    zh: "扫描以查找此 Mac 上的应用偏好域。",
  },

  // ── Aliases & Env ──────────────────────────────────────────────────────────
  "env.explainer": {
    en: "Portable aliases & environment Roost manages for you and carries across Macs — your existing dotfiles stay untouched.",
    zh: "Roost 为你管理并跨 Mac 携带的可移植别名与环境变量 —— 你现有的 dotfiles 不受影响。",
  },
  "env.save": { en: "Save", zh: "保存" },
  "env.saving": { en: "Saving…", zh: "保存中…" },
  "env.importFromShell": { en: "Import from your shell", zh: "从你的 shell 导入" },
  "env.applyToMachine": { en: "Apply to this machine", zh: "应用到本机" },
  "env.applying": { en: "Applying…", zh: "应用中…" },
  "env.appliedHint": {
    en: "Saved & regenerated env.sh. New terminals are already set. To update THIS terminal without reopening it, run:",
    zh: "已保存并重新生成 env.sh。新开的终端已生效。要让当前这个终端不重开也生效，运行：",
  },
  "env.copy": { en: "Copy", zh: "复制" },
  "env.emptyManaged": {
    en: "Nothing managed yet. Add an item or import from your shell.",
    zh: "尚未管理任何内容。添加一项或从你的 shell 导入。",
  },
  "env.noMatches": {
    en: "No matches. Try a different search or chip.",
    zh: "无匹配项。换个搜索词或筛选标签试试。",
  },

  // ── Drift ─────────────────────────────────────────────────────────────────
  "drift.heading": { en: "Drift Overview", zh: "偏移总览" },
  "drift.noDriftTitle": { en: "No drift detected", zh: "未检测到偏移" },
  "drift.noDriftSubtitle": {
    en: "All modules are in sync between machines",
    zh: "所有模块在设备间均已同步",
  },

  // ── Timeline ─────────────────────────────────────────────────────────────
  "timeline.heading": { en: "Timeline", zh: "时间线" },
  "timeline.emptyTitle": { en: "No snapshots yet", zh: "尚无快照" },
  "timeline.emptySubtitle": {
    en: "Run roost capture to create the first snapshot in your repo",
    zh: "运行 roost capture 以在你的仓库中创建第一个快照",
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  "settings.heading": { en: "Settings", zh: "设置" },
  "settings.repository": { en: "Repository", zh: "仓库" },
  "settings.registeredModules": { en: "Registered modules", zh: "已注册模块" },
  "settings.privacy": { en: "Privacy", zh: "隐私" },
  "settings.privacyTitle": { en: "Local — no telemetry", zh: "本地运行 —— 无遥测" },
  "settings.privacyBody": {
    en: "Roost runs entirely on your machine. No data is sent to any server. Your config repo is private git — you own it.",
    zh: "Roost 完全在你的设备上运行。不向任何服务器发送数据。你的配置仓库是私有 git —— 归你所有。",
  },
  "settings.documentation": { en: "Documentation", zh: "文档" },
  "settings.git.heading": { en: "Git remote & sync", zh: "Git 远端与同步" },
  "settings.git.push": { en: "Push", zh: "推送" },
  "settings.git.pull": { en: "Pull", zh: "拉取" },
  "settings.git.noRemote": {
    en: "No remote — run `roost init --github` to create a private repo",
    zh: "无远端 —— 运行 `roost init --github` 以创建私有仓库",
  },
  "settings.git.inSync": { en: "in sync", zh: "已同步" },
  "settings.git.pushed": { en: "Pushed", zh: "已推送" },
  "settings.git.pulled": { en: "Pulled", zh: "已拉取" },
  "settings.key.heading": { en: "Age key (encryption)", zh: "Age 密钥(加密)" },
  "settings.key.recipient": { en: "Recipient", zh: "公钥" },
  "settings.key.none": { en: "no key yet", zh: "尚无密钥" },
  "settings.key.encryptedFiles": { en: "encrypted files", zh: "个加密文件" },
  "settings.key.generate": { en: "Generate key", zh: "生成密钥" },
  "settings.key.rotate": { en: "Rotate / replace key", zh: "更换密钥" },
  "settings.key.rotateConfirm": {
    en: "Rotate the age key? A new key is generated and ALL encrypted files are re-encrypted to it. The old key is backed up. You must back up the NEW key — it is the only way to decrypt your data. Continue?",
    zh: "更换 age 密钥?将生成新钥并把所有加密文件重新加密到它,旧钥会被备份。你必须备份新钥——它是解密数据的唯一凭据。继续?",
  },
  "settings.key.backupWarning": {
    en: "The age private key is the ONLY way to decrypt your data. Back it up offline (e.g. a password manager). Lose it and every encrypted file is unrecoverable.",
    zh: "age 私钥是解密你数据的唯一凭据。请离线备份(如密码管理器)。丢失后所有加密文件将无法恢复。",
  },
};
