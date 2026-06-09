# Roost 原生桌面应用 — 设计(Tauri 壳 + SEA sidecar)

- 日期: 2026-06-08
- 状态: 设计已确认,待写实现计划
- 关联: architecture.md(I1 薄编排 / I3 分层 / I9 仅 macOS)、ADR-0011(桌面打包,本设计**取代其方案选择**)、ADR-0013(本设计要求新增,取代 ADR-0011 的 approach B)
- 背景: 项目 5/30 即按 Tauri 脚手架(`packages/web/src-tauri/`)。之前 ADR-0011 选了 approach B(Node SEA + 系统浏览器),用户实测发现那是"网页端"而非原生桌面应用 → 改回 approach C(Tauri 原生窗口),复用现有脚手架,并把已做的 SEA 二进制重用为引擎 sidecar。

## 1. 目标与范围

把 Roost 打成**真·原生 macOS 桌面应用**:有自己的窗口(WKWebView),双击即用、无浏览器依赖、无"后台无窗口"困惑。复用现有 React web UI 与 fastify `serve` 引擎。

**IN**
- Tauri v2 原生窗口加载现有 `packages/web/dist`。
- 引擎 = 现有 SEA 自包含二进制,作为 Tauri **sidecar** 运行 `serve --port 4317`(用户免装 Node)。
- `tauri build` 产 `Roost.app` + `Roost.dmg`,arm64 + x64 双架构,不签名(ad-hoc)。
- app 退出时终止 sidecar(无孤儿进程)。
- 退役旧的 SEA+浏览器入口/打包。

**OUT**
- 不改 `core`/`cli`(除删除 `roost gui`)/模块契约/数据 schema/selection。
- 不引入跨平台(I9,仅 macOS)。
- 暂不做 Apple 签名+公证(将来加,不改结构)。
- 不做自动更新、菜单栏常驻。

## 2. 不变量符合性
- **I1/I3**:Tauri 仅新增 UI 外壳层;API 仍是现有 `serve`,UI 仍是现有 React。core/adapters/modules 不改。
- **I9**:仅 macOS 产物。
- 现有单测(core/cli 676 + web 72)逻辑不动,保持绿(退役 gui/quit 后相应删改对应用例)。

## 3. 现状(已就绪 vs 待做)

已就绪(5/30 脚手架):
- `src-tauri/tauri.conf.json`:窗口 1100×720;productName Roost;identifier dev.roost.app;bundle targets `["app","dmg"]`;图标已配;CSP 允许 `connect-src http://127.0.0.1:4317`;`externalBin: ["binaries/roost-server"]`。
- `src-tauri/Cargo.toml`:tauri v2 + `tauri-plugin-shell`。
- `src-tauri/icons/`:全套图标。
- web 依赖 `@tauri-apps/api`+`@tauri-apps/cli`;`api.ts` 在 Tauri 下把 `API_BASE` 指向 `http://127.0.0.1:4317`(检测 `__TAURI_INTERNALS__`)。
- Rust 工具链(cargo/rustc)已装。

待做:
- `src-tauri/binaries/roost-server-aarch64-apple-darwin` 现为 107B 占位 → 换成真 SEA 二进制;补 `-x86_64-apple-darwin`。
- `src/main.rs` 现为 dev 模式(spawn 系统 node,相对路径)→ 改用 sidecar API + 生命周期管理。
- SEA 构建脚本改造为产 sidecar(而非浏览器 .app)。
- ADR-0013 + 退役旧入口。

## 4. sidecar 接线
- 引擎二进制 = 现有 SEA 产物(内嵌 Node 24 + 打包后的 cli)。按 Tauri sidecar 命名规则放置:
  - `src-tauri/binaries/roost-server-aarch64-apple-darwin`
  - `src-tauri/binaries/roost-server-x86_64-apple-darwin`
- 运行参数:`serve --port 4317`(纯 API;前端由 Tauri 加载 `web/dist`,sidecar 不需 `--web`)。
- 构建脚本 `scripts/build-sidecar.mjs`(由现 `build-app.mjs` 改造):esbuild 打 cli → SEA blob → 注入对应架构 node 基座 → ad-hoc 签 → 输出到 `src-tauri/binaries/roost-server-<triple>`。双架构。

## 5. `src/main.rs` 改造
- release:用 `tauri_plugin_shell` 的 sidecar API 启动 `roost-server`,带 `serve --port 4317`。Tauri 托管该子进程,**app 退出时自动终止**(消除现有 std::process 孤儿问题)。
- dev:保留回退——若 sidecar 不存在(`tauri dev` 无打包二进制),spawn 系统 `node <repo>/packages/cli/dist/index.js serve --port 4317`(沿用现有 dev 便利)。
- 端口固定 4317(与 CSP、api.ts 一致)。端口被占用(极少:残留实例)→ sidecar 启动失败,UI 无法连 API;v1 接受此边界,日志记录;不做自动抢占。
- 窗口关闭 = app 退出 = sidecar 终止。

## 6. 构建与分发
- `pnpm tauri build`(根 `package.json` 加脚本 `"tauri": "pnpm --filter @roost/web exec tauri"`,或在 web 包内跑)→ 先跑 `beforeBuildCommand`(web build)→ 产 `Roost.app` + `Roost.dmg`。
- 双架构:arm64 本机直出;x64 经 `rustup target add x86_64-apple-darwin` + `tauri build --target x86_64-apple-darwin`,需对应 triple 的 sidecar 已就位。
- 不签名(`signingIdentity: null`):.dmg 拖入 Applications;首次右键打开或 `xattr -dr com.apple.quarantine /Applications/Roost.app`。
- 产物归集到 `dist-app/`(gitignored)。

## 7. 退役旧的 SEA+浏览器方案
移除(approach B 残留):
- `scripts/build-app.mjs`、`scripts/smoke-app.mjs`。
- `roost gui` 命令 + `index.ts` 的 `.app` 自动检测块 + `packages/cli/src/gui.ts`(及其测试)。
- `package.json` 的 `build:app`/`smoke:app` 脚本;`.claude/launch.json` 里浏览器型 preview(如指向旧 .app)。
- server 的 `/api/quit` + `appMode`,以及 Settings 的"退出 Roost"面板 + web `quitApp`/`appMode`(Tauri 用原生关闭按钮;清掉减少困惑)。相关测试一并删/改。

保留:
- `roost serve`(sidecar 依赖)、所有 `/api/*` 业务端点、ADR-0011 文件(标记为被 ADR-0013 取代)。

## 8. 变更控制
- 新增 **ADR-0013(Tauri 原生桌面壳 + SEA sidecar)**,声明:取代 ADR-0011 的 approach B;新增 UI 外壳层(Tauri/Rust),但不改 core/模块契约/schema;sidecar = 现有 SEA;仅 macOS;不签名(暂)。
- 将 **ADR-0011 状态改为 "Superseded by ADR-0013"**,正文保留(历史)。

## 9. 测试与验收(对应"必须能用")
- `cargo check`(src-tauri)通过;`pnpm tauri build` 产出 `.app` + `.dmg`。
- **真机冒烟(手动,核心验收)**:.dmg 装到 /Applications → 双击 → **原生窗口出现** → dashboard 渲染(Skills/Dotfiles 等可见)→ DevTools/网络确认 `/api/health` 经 sidecar(:4317)返回 → 关窗口后 `pgrep roost-server` 为空(sidecar 被终止,无孤儿)。
- 现有单测保持绿(删 gui/quit 相关用例后相应调整,净逻辑不回归)。
- sidecar 二进制本身可独立 `serve` 起来(冒烟:curl :4317/api/health)。

## 10. 实现阶段(交由 writing-plans 细化)
- Phase 1:ADR-0013 + 标记 ADR-0011 superseded。
- Phase 2:退役 approach B(删 build-app/smoke-app/gui/quit/appMode + 相关测试),保持套件绿。
- Phase 3:`scripts/build-sidecar.mjs`(SEA → `binaries/roost-server-<triple>`,双架构)+ 冒烟(sidecar 独立 serve)。
- Phase 4:`src/main.rs` sidecar 化(release sidecar / dev 回退 / 固定端口 / 退出杀引擎)+ `cargo check`。
- Phase 5:`pnpm tauri build` 接线(根脚本、dual-arch、dmg)+ 真机冒烟(原生窗口 + API + 无孤儿)+ 文档更新(README 下载段改为 .dmg/原生)。
