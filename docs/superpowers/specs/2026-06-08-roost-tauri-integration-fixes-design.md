# Tauri 集成修复 + 错误精细化 + 可配置上限 — 设计

- 日期: 2026-06-08
- 状态: 设计已确认,待写实现计划
- 关联: ADR-0013(Tauri 壳)、本设计新增 ADR-0015(opener 插件 + ChangeSet.blockedDetail 字段 + maxCaptureMB 设置,均为扩展不改架构)
- 背景: 用户实测原生桌面 app 发现一批"web 在浏览器里能用、在 Tauri WKWebView 里行为不同"的问题,外加错误信息不够具体、捕获上限写死。

## 1. 目标与范围(5 项)

**A. 外链能在系统浏览器打开**
Tauri WKWebView 默认不开 `<a target="_blank">` 外链(同 `window.confirm` 一类)。接入 Tauri opener,点击外链时在 Tauri 里走系统浏览器、在浏览器里走 `window.open`。

**B. 捕获拦截原因精细化**
当前 `ChangeSet.blocked: string[]` 只有路径、无原因,UI 笼统显示"疑似密钥"。**新增可选** `ChangeSet.blockedDetail?: { id: string; reason: BlockReason }[]`(`BlockReason = "secret" | "too-large" | "managed" | "error"`),保留 `blocked` 不破坏契约。模块(dotfiles/skills)填原因;Overview 按原因显示并给对应操作。

**C. 移除 `~/.config/raycast`**
它 160MB 且多为缓存/扩展,超上限无法备份。从 selection 移除(从未被捕获,纯清理)。

**D. 推送失败必须明确告知**
应用内 `git push`(sidecar 进程)很可能拿不到终端的 git 凭证而失败。push 结果要**显著**展示 git 报错,并提示"若鉴权失败请在终端 `git push`"。

**E. 可配置最大捕获大小**
`scanPathForSecrets` 的 `maxBytes`(默认 100MB)写死在代码。改为可配置 `maxCaptureMB`,Settings 提供输入框。

**OUT**
- 不试图在 GUI 进程里"破解"git 凭证(D 只做清晰报错 + 终端兜底,不假装能推)。
- 不改架构/模块契约的破坏性变更(B/E 均为可选扩展字段/参数)。仅 macOS(I9)。

## 2. A — 外链 opener

- 依赖:`@tauri-apps/plugin-opener`(JS)+ `tauri-plugin-opener`(Rust)+ capability `opener:allow-open-url`(或 `opener:default`)。
- `main.rs`:`.plugin(tauri_plugin_opener::init())`。
- web 新增 `openExternal(href: string)`(放 api.ts 或一个小 util):
  - Tauri(`"__TAURI_INTERNALS__" in window`)→ `await openUrl(href)`(来自 `@tauri-apps/plugin-opener`)。
  - 否则 → `window.open(href, "_blank", "noopener")`。
- `Settings.tsx` 文档 4 个链接 + 任意外链:改为 `<a>` 加 `onClick={(e)=>{e.preventDefault(); void openExternal(href);}}`(保留 href 以便浏览器模式/可访问性)。
- 同时检查底部 "Docs" 链接、GIT remote URL 等其它外链,一并用 `openExternal`。

## 3. B — 拦截原因精细化

- shared `types.ts`:
  ```ts
  export type BlockReason = "secret" | "too-large" | "managed" | "error";
  export interface BlockedItem { id: string; reason: BlockReason; detail?: string }
  // ChangeSet 追加可选字段(保留 blocked: string[]):
  // blockedDetail?: BlockedItem[]
  ```
- dotfiles capture:拦截时除 `blocked.push(id)` 外,`blockedDetail.push({id, reason})`:
  - 内容扫描命中密钥 → `secret`
  - `tooLarge`(超 maxFiles/maxBytes)→ `too-large`(`detail` 写实际大小)
  - `isRoostManaged` → `managed`
- skills capture 同理(secret / too-large)。
- Overview 拦截面板:按 `blockedDetail` 分组渲染(无 blockedDetail 时回退到旧 `blocked` 文案):
  - `secret` → 文案"疑似密钥",按钮「加密并重试」(现有逻辑)
  - `too-large` → 文案"太大(<size>),超过上限无法备份",**不给加密重试**,给「移除」按钮(调 removeSelection/unmanage)+ 提示可在设置调高上限
  - `managed` → "已被 Roost 管理"
  - `error` → 显示 detail
- i18n 加对应文案(en+zh)。

## 4. C — 移除 raycast

- `roost unmanage dotfiles /Users/alex/.config/raycast`(从 selection.yaml 移除 + chezmoi forget 容错)。一次性操作。
- 实现计划里作为一步执行并验证 selection 不再含该路径。

## 5. D — 推送失败告知

- 服务端 `/api/git/push` 已返回 `{ ok, output(stdout+stderr) }`。增强:`ok=false` 时,若 output 命中常见鉴权特征(`Authentication failed`/`could not read Username`/`Permission denied`/`fatal: could not read`)→ 在响应里附 `hint: "auth"`。
- `Settings.tsx` push 结果:
  - 失败时**显著**展示(放大、保留不自动消失、可复制),显示完整 git 报错;
  - 若 `hint==="auth"` 或检测到鉴权关键字 → 追加一行明确提示:"应用内推送可能拿不到 git 凭证;请在终端运行 `cd <repoPath> && git push`"。
- 不改变 push 机制本身(GUI 凭证问题不强行解决)。

## 6. E — 可配置最大捕获大小

- 存储:仓库数据文件 `roost/settings.yaml`(新,可共享)`{ maxCaptureMB: number }`,默认 100。读写小工具 `loadRoostSettings/saveRoostSettings`(core)。
- dotfiles capture 调 `scanPathForSecrets` 时传 `maxBytes = maxCaptureMB * 1024 * 1024`(也作为 H3 size guard 的阈值,保持一致)。
- server:`GET/POST /api/settings`(读写 `maxCaptureMB`)。
- `Settings.tsx`:数字输入框"最大捕获大小 (MB)",保存即写;旁注"调高会让仓库/推送变大;raycast 类缓存目录不建议备份"。
- i18n 文案。

## 7. 变更控制
新增 **ADR-0015(Tauri opener + blockedDetail + maxCaptureMB)**:声明均为扩展(新插件 / 可选字段 / 新设置文件),不改分层架构、不破坏模块契约、不改 selection schema;仅 macOS。

## 8. 测试
- A:web 单元 — `openExternal` 在 mock Tauri(注入 `__TAURI_INTERNALS__` + mock openUrl)时调 openUrl、否则 window.open;`cargo check` 通过(插件注册)。
- B:core 单元 — dotfiles/skills capture 对 secret/too-large/managed 三种各产正确 `blockedDetail`;Overview 组件按 reason 渲染不同文案/按钮。
- D:Settings 组件 — push 失败渲染完整 output;鉴权错误渲染终端提示。server inject — 鉴权 output 附 `hint:"auth"`。
- E:core 单元 — load/save settings 往返、默认 100;capture 用配置的 maxBytes(小 maxCaptureMB 让一个中等目录判 too-large);server inject GET/POST。
- C:执行后 selection.yaml 不含 raycast。
- 现有套件保持绿;真机验证外链可开 + 桌面 app 重建。

## 9. 实现阶段(交由 writing-plans)
- Phase 1:ADR-0015。
- Phase 2:A 外链 opener(JS+Rust+capability+web openExternal+Settings 链接)+ cargo check + 真机外链验证。
- Phase 3:B blockedDetail(shared 类型 + dotfiles/skills capture + Overview UI + i18n)+ 测试。
- Phase 4:E maxCaptureMB(core settings + capture 接线 + /api/settings + Settings UI)+ 测试。
- Phase 5:D push 报错增强(server hint + Settings 显著报错+终端提示)+ 测试。
- Phase 6:C 移除 raycast + 桌面 app 重建 + 真机回归(外链/拦截文案/设置/push 提示)。
