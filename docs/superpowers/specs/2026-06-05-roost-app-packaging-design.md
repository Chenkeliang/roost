# Roost.app 桌面打包与分发 — 设计

- 日期: 2026-06-05
- 状态: 设计已确认(Phase 0 可行性已实测通过),待写实现计划
- 关联: architecture.md(I1 薄编排 / I3 严格单向分层 / I9 仅 macOS)、ADR-0011(本设计要求新增)

## 1. 目标与范围

把现有 `@roost/cli`(fastify 服务 + 内嵌 React 仪表盘)封装成一个**可双击启动**的 macOS `.app`,作为 GitHub Release 资产分发给用户。

**IN(本设计覆盖)**
- Node SEA(Single Executable Application)单文件二进制 `.app`,自包含 Node 运行时,用户**免装 Node**。
- 双击启动 → 选空闲端口启动现有 fastify server → 打开默认浏览器访问仪表盘。
- 浏览器内「退出 Roost」能力(`POST /api/quit`)干净结束进程。
- 双架构产物:`arm64` 与 `x86_64`(Intel)各一个包。
- 不签名(ad-hoc),配 README 首次打开指引(右键→打开 / `xattr -dr`)。

**OUT(明确不做)**
- 原生 UI 壳(Tauri/Electron):会新增 UI 层,违反 I1/I3,本期不做。
- Apple 开发者签名 + 公证:将来有开发者号再加,**不改本设计结构**。
- 自动更新、菜单栏常驻、Dock 图标交互菜单。
- Mac App Store 上架。

## 2. 不变量符合性

- **I1 薄编排 / I3 分层**:纯外壳打包,`core`/`adapters`/`modules` **一行不改**;仅复用现有 `cli` + `web`。新增的 `roost app` 子命令与 `/api/quit` 落在 UI 层(cli/web),不向 core 加领域逻辑。
- **I9 仅 macOS**:只产 macOS 包,无跨平台分支。
- 不触碰 `selection.yaml` schema、不触碰模块契约。

## 3. Bundle 结构

```
Roost.app/
  Contents/
    Info.plist                 # CFBundleExecutable=Roost; LSUIElement=1(无 Dock 图标,后台型)
    MacOS/
      Roost                    # SEA 二进制 = 完整 @roost/cli + 内嵌 Node 24
    Resources/
      web/                     # 构建好的 web/dist
      AppIcon.icns
```

- web 资源**不塞进 SEA blob**,放 `Resources/web/`,由 fastify-static 从磁盘 serve。
- 运行时 web 目录解析:`path.join(dirname(process.execPath), '..', 'Resources', 'web')`。
  (Phase 0 已验证 `dirname(process.execPath)/web` 形态可用;`.app` 内按上面相对路径定位。)

## 4. 启动与退出行为

新增 `roost app` 子命令(Info.plist 不直接传参时,二进制检测「argv 为空且自身位于 `*.app/Contents/MacOS/` 内」自动进入 app 模式;CLI 用法不受影响)。

启动序列:
1. 解析 `Resources/web` 路径。
2. 选空闲端口(`server.listen({ port: 0 })` 让内核分配,**不写死 4317**,避免多实例/冲突)。
3. 启动现有 fastify server(复用 `packages/cli/src/server.ts`,不改其逻辑)。
4. `child_process` 调 `open http://127.0.0.1:<port>` 拉起默认浏览器。
5. 日志写 `~/Library/Logs/Roost/roost.log`(GUI 启动无终端)。
6. 进程常驻;`SIGTERM`/`SIGINT` 优雅关闭。

退出:
- 仪表盘页脚新增「退出 Roost」按钮 → `POST /api/quit` → server 关闭后 `process.exit(0)`。
- `/api/quit` 仅绑 `127.0.0.1`,且与现有 API 同源,不引入额外暴露面。

## 5. 构建流水线(`pnpm build:app`)

```
1. pnpm -r build                         # core/cli/web dist
2. esbuild 把 cli 入口打成单文件 CJS       # --bundle --platform=node --target=node24 --format=cjs
                                          # 把 fastify 等全部依赖 inline
3. node --experimental-sea-config sea-config.json   # 生成 sea-prep.blob
4. 对每个目标架构:
   a. 取该架构的 node 二进制基座
      - arm64: 本机 node(或下载 darwin-arm64)
      - x64:   下载 nodejs.org/dist/vX/node-vX-darwin-x64.tar.gz 的 node
   b. cp 基座 → Roost.app/Contents/MacOS/Roost
   c. codesign --remove-signature MacOS/Roost
   d. npx postject MacOS/Roost NODE_SEA_BLOB sea-prep.blob \
        --sentinel-fuse NODE_SEA_FUSE_<标准 fuse> --macho-segment-name NODE_SEA
   e. codesign --sign - --force MacOS/Roost      # ad-hoc 重签(Apple Silicon 必须)
5. 拷 web/dist → Resources/web;写 Info.plist;放 AppIcon.icns
6. codesign --force --deep --sign - Roost.app    # 整包 ad-hoc 签
7. ditto -c -k --keepParent Roost.app Roost-<ver>-macos-<arch>.zip
```

固定常量:postject 标准 fuse `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`(Phase 0 实测可用)。

## 6. 最大风险与兜底

**风险**:fastify 的动态 require/插件机制可能在 esbuild 全量 inline 或 SEA 运行时报 `Cannot find module`。

**Phase 0 已实测结果(2026-06-05,Node 24.8.0)**:
- esbuild 把 `fastify@5` + `@fastify/static@9` inline 进单文件 1.5MB CJS,**0 报错**。
- SEA blob 1.6MB;arm64 注入后 118MB,运行 `/ping` → `{"ok":true}` 200、静态文件 200,冷启 ~400ms。
- x64 用下载的 darwin-x64 node 同流水线注入,Rosetta 下运行 `/ping` 200(首启因 AOT 翻译 >5s,二次 ~300ms)。
- ⇒ **主方案成立,无需兜底。**

**兜底 B'(仅在真实 cli 入口因体量更大而出现 SEA 打包问题时启用)**:
`.app` 内放 `Resources/node`(完整 node 二进制)+ `Resources/app/`(cli dist + 精简 node_modules),`MacOS/Roost` 为极小启动器调 `node app/index.js`。一样自包含、免装 Node,只是非单文件、体积稍大。此路径几乎必成,故方案整体无死局。

## 7. 分发与签名

- 不签名(ad-hoc)。Release 附 `Roost-<ver>-macos-arm64.zip` 与 `...-x64.zip`。
- README/Release notes 写首次打开指引:
  - 右键 `Roost.app` → 打开 → 在弹窗点「打开」;或
  - `xattr -dr com.apple.quarantine /Applications/Roost.app`。
- 将来加 Apple 开发者签名 + notarize:仅在流水线 4e/6 后追加 `codesign`(真实证书)+ `notarytool` + `stapler`,**不改 bundle 结构**。

## 8. 测试与验收(对应「打包后必须能用」)

- **单元**:`roost app` 模式的空闲端口选择、web 目录解析、app 模式自动检测、`/api/quit` 处理逻辑。
- **集成(打包冒烟,必须全绿才算打包成功)**:构建脚本产出 `.app` 后自动——
  1. 启动 `MacOS/Roost`;
  2. 轮询 `127.0.0.1:<port>` 直到 200(超时判失败);
  3. 校验返回的是 dashboard HTML(命中关键字);
  4. 调 `/api/quit`,确认进程在限定时间内退出。
  arm64 与 x64(经 `arch -x86_64`)各跑一遍。
- **真机冒烟**:`xattr -dr com.apple.quarantine` 后双击,确认浏览器拉起仪表盘、退出按钮可用。

## 9. 变更控制

新增分发形态与构建产物属范围扩张 → **需新增 ADR-0011(桌面 .app 打包与分发)**,声明:不引入原生 UI 壳、不改模块契约与数据 schema、仅复用现有 cli+web、仅 macOS。实现计划第一步即落 ADR-0011。

## 10. 实现阶段(交由 writing-plans 细化)

- Phase 0:可行性 spike(**已完成,通过**)。
- Phase 1:ADR-0011 + `roost app` 模式(子命令/自动检测/空闲端口/open 浏览器/日志)+ `/api/quit` + 页脚退出按钮 + 单测。
- Phase 2:`scripts/build-app.mjs` 构建流水线(双架构)+ Info.plist + 图标 + 打包冒烟集成测试。
- Phase 3:README/Release 文档(首次打开指引)、`pnpm build:app` 接线、CI(可选)。
