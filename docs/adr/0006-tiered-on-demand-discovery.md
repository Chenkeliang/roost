# ADR-0006: 分层按需发现(SyncModule.index)

- **状态**: 提议(PROPOSED · 2026-05-31)。配套设计:`docs/superpowers/specs/2026-05-31-dashboard-redesign-design.md`。
- **日期**: 2026-05-31

## 背景

仪表盘进页面即对**所有**模块调 `discover()`(全量:扫整个 home 找 git repo、`brew bundle` 等)+ `statusAll`(无条件外呼 brew/chezmoi)。后果:冷调 24s、"没问就扫整盘"、页面只能用计数充内容。

`SyncModule` 当前只有一档发现:`discover(ctx): Promise<Candidate[]>`(贵、全量)。缺少一档**便宜的"已纳管内容/可用性"**用于进页面即时渲染,导致要么空、要么贵。

## 决定

给 `SyncModule` 增加**一个可选方法** `index?(ctx)`,确立**两档发现**:

```ts
// @roost/shared
export interface ModuleIndex {
  available: boolean;                              // 工具在否 / 模块在此机器有意义否(T0)
  reason?: string;                                 // 不可用原因(如 "Homebrew 未安装")
  managed: number;                                 // 已纳管条数(从仓库读)
  summary?: Record<string, number | string>;       // 模块自定义抬头
}

export interface SyncModule {
  // ...既有 discover/status/capture/apply/diff/unmanage/doctor 不变...
  index?(ctx: ModuleContext): Promise<ModuleIndex>; // 新增,可选
}
```

**规则(实现时为 MUST):**
- `index()` **必须便宜且有界**:只读仓库文件 + 便宜本机探测(`which`/`existsSync`/读 `.git/config`)。**禁止**全盘扫描、禁止 `brew bundle`、禁止逐项 git 子进程、禁止任何可能秒级的外呼。
- `discover()` 语义不变(全量候选),但调用方**只在用户显式触发时**按模块调用;仍受 M4 体积守卫。
- `index` **可选 + 向后兼容**:未实现的模块退化为"无便宜索引,仅 discover"。
- 经唯一 `exec` 出口(I3);不在 core 加领域 if-else(I4)——逻辑落在各模块。

## 触及不变量
- **I4 模块为唯一扩展点**:能力以模块方法新增,core 编排只多调一个可选方法。
- **M4 discover 体积守卫**:`index` 强化"便宜有界"的精神;`discover` 维持守卫。
- **契约扩展**(`SyncModule` 增可选方法 + 新增 `ModuleIndex` 类型)——正因触及模块契约,故走本 ADR。
- 不触碰 I6 密钥模型、不改 `selection.yaml` schema。

## 影响
- `packages/shared`:`ModuleIndex` 类型 + `SyncModule.index?`。
- `packages/core`:各模块实现 `index()`(dotfiles/packages/appconfig/projects/env);新增 `indexAll` 编排(类比 `discoverAll`)。
- `packages/cli`:`GET /api/index`(全模块便宜索引,纳入 25s 缓存)、`GET /api/discover?module=`(按需单模块)。
- `packages/web`:进页面调 index(便宜);[扫描] 才调 discover。
- 测试:每模块 index 的 单元 + "便宜"约束(不触发禁用的外呼,可用 fake exec 断言未调用 brew/全盘扫)。

## 替代方案
- **A. 只改 UI 惰性(不动契约)**:`discover` 不变,仅"点了才调"。简单、无 ADR;但给不了"进页面即时的便宜已纳管内容",页面仍空或仍贵。
- **B. 全量分层(`available()`+`index()`+`discover()` 三法)**:最完整;但契约面更大、每模块多实现一个方法,收益不抵成本。
- **C.(本 ADR 选定)最小扩展**:仅加可选 `index()`(把 available 折进其返回值),`discover()` 改为按需。完整实现"内容优先 + 按需",改动聚焦、向后兼容。

## 后续(owner 批准后)
状态改「接受」,据此实现:`ModuleIndex` 类型 → 各模块 `index()` → `indexAll` + `/api/index` → web 进页面用 index、[扫描]用 discover → 补齐测试。**批准前仅为规范,行为不变。**
