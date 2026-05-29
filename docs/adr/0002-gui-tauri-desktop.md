# ADR-0002: GUI 采用 Tauri 桌面应用 + Node 引擎 sidecar

- 状态: 接受
- 日期: 2026-05-30
- 背景: 原定 GUI 为"本地 web 仪表盘"(`roost serve` → 浏览器 localhost)。用户质疑"web 能否管理/备份 APP",并希望对非 CLI 用户更像原生应用、贴近 Raycast 体感。澄清:真正特权操作由**本地 Node 引擎**执行,浏览器只是渲染层,故 web 技术不阻碍能力;真正要选的是 **UI 外壳如何打包**。
- 决定: GUI(P3)打包为 **Tauri 桌面应用**,内嵌现有 React/Vite UI(系统 webview);Roost 的 **Node 引擎(core)作为 sidecar 进程**提供全部特权能力,UI 经本地 IPC/HTTP 调用。保留 `roost serve`(浏览器模式)作为轻量回退。**CLI 引擎仍为 P1 核心、独立可用**。
- 触及不变量: 不破坏 I1–I10;分层 UI→core→adapters 不变(Tauri 仅替换 UI 外壳与分发形态)。语言锁定(TS)不变——特权逻辑留 Node,Rust 侧只做窗口/托盘/通知/更新等原生外壳,不承载业务。
- 影响: `web` 产物由"被 Fastify 托管的页面"变为"被 Tauri 打包的桌面应用";新增分发依赖——**Apple Developer ID 签名/公证、Tauri updater**。core 仍是 Node 引擎,与 CLI 共用。
- 替代方案: (A) 仅 CLI + 浏览器 web UI——最轻但非原生体感,留作回退;(B) Electron——Node 原生但 ~100MB+,否决;(C) 原生 SwiftUI——丢弃已锁 TS 栈,否决。
