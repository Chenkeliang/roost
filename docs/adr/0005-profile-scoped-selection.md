# ADR-0005: profile-scoped selection(机器画像差异化纳管)

- **状态**: 提议(PROPOSED · 2026-05-30)。**未实现**。owner 未批准前,本 ADR 仅为规范,`selection.yaml` schema 与解析行为一字不改。
- **日期**: 2026-05-30

## 背景

设计 §14 P1 列出 **Profiles(base + 机器画像)**,定位是"用于跨机差异化"(术语表 §3:`base`→`personal`→`primary`/`follower`)。本期已落地 Profile 的 **非 schema 部分**:

- `loadProfiles(repoDir)` 读取**可选**、增量数据文件 `roost/profiles.yaml`(形如 `{ name, hostnames?: string[] }`)。
- `resolveProfile({ flag?, env?, hostname, profiles })` 解析优先级:`--profile` > `ROOST_PROFILE` > hostname 匹配 > `"base"`。
- `buildCtx` 已把解析结果填入 `ctx.profile`(替换原硬编码 `"base"`),`roost profile` / `roost profile list` 可见当前画像与解析来源。

**但目前 `ctx.profile` 仍无任何消费者**:`selection.yaml` 是扁平的 `modules: Record<string, string[]>`,**所有机器共享同一份纳管清单**。也就是说,画像被解析出来了,却无法"差异化"——`primary` 与 `follower` 无法各自纳管不同的项。要真正兑现 §14 P1 "跨机差异化"的产品价值,需要让 **selection 可按 profile 分片**。这触及数据 schema,故按 architecture §11–§13 走本 ADR,且**在此停手、不实现 schema 变更**。

## 决定(待批准)

给 `selection.yaml` 增加一个**可选的、向后兼容的 profile 覆盖层**,`schemaVersion` 升一位(1 → 2):

```ts
// 现状(v1,保持可读):base 清单 = 顶层 modules
interface SelectionDocV1 {
  schemaVersion: 1;
  modules: Record<string, string[]>;
}

// 提议(v2):顶层 modules 仍是 base;新增可选 profiles 覆盖层
interface SelectionDocV2 {
  schemaVersion: 2;
  modules: Record<string, string[]>;              // = base(所有机器的公共基线)
  profiles?: Record<string, {                     // 缺省 ⇒ 行为同 v1
    add?: Record<string, string[]>;               // 该画像额外纳管
    remove?: Record<string, string[]>;            // 该画像从 base 排除
  }>;
}
```

**解析规则(实现时为 MUST):**

- 有效纳管清单 = `base.modules` ∪ `profiles[active].add` − `profiles[active].remove`,其中 `active = ctx.profile`(由本期已实现的 `resolveProfile` 给出)。
- `active === "base"` 或 `profiles` 缺省 ⇒ 等同 v1,**一字不差**。
- 所有读取纳管清单的入口(`capture`/`load`/`status`/`diff`/`list`/`unmanage`,以及 `GET /api/selection`)统一经一个 `resolveSelection(doc, profile)` 纯函数取得"该机有效清单"——**core 不加 if-else,模块契约不变**(I4)。
- 写入(`addItem`/`removeItem`、Web 增删、`roost select`)需明确"写到 base 还是当前 profile":默认写 base;`--profile` 激活非 base 时写入 `profiles[active]`。
- `loadSelection` 对 v1 数据按"无 profiles 覆盖"解释并就地迁移到 v2(`migrate()` 已预留)。

## 触及不变量

- **数据 schema 扩展**(`selection.yaml` schemaVersion 1→2,新增 `profiles` 覆盖层)—— 正因触及"被管什么"的唯一真相源(§5–§6),故必须走本 ADR。
- **I4 core 零领域逻辑**:差异化收敛进单个 `resolveSelection` 纯函数 + selection schema,**不往 core/模块加 if-else**。
- **I2 单一事实源**:仍是用户私有 git 仓库内的 `selection.yaml`,无新增外部状态。

## 影响

- `packages/core`:`selection.ts`(类型 v2、校验、`migrate` v1→v2、`resolveSelection`、`addItem`/`removeItem` 增 profile 维度);`orchestrate.ts` 各入口改用 `resolveSelection(doc, ctx.profile)`。
- `packages/cli`:`select`/`list`/`unmanage` 等读写经解析层;沿用本期的 `--profile` 全局旗标决定写入目标。
- `packages/web`:`GET /api/selection` 返回"当前 profile 的有效清单"(或显式区分 base/overlay);增删需带 profile 维度。
- 测试:v1→v2 迁移幂等、`resolveSelection`(base/add/remove/未知 profile)、写入定向(base vs profile)、`active==="base"` 与 v1 行为等价、无 schema 倒退。
- 文档:README/设计补"profile 差异化纳管"说明。

## 替代方案

- **A. 维持扁平 selection(现状)**:最简、零迁移;画像仅影响"解析出哪个名字",但**所有机器纳管同一批项**。够用于"所有 Mac 装一样的东西",但兑现不了 §14 P1 "跨机差异化"。
- **B. 每 profile 一个独立 selection 文件**(`selection.<profile>.yaml`):隔离彻底,但**复制公共基线**、漂移难维护,且把"真相源"从单文件碎片化(削弱 §5–§6)。
- **C. base + 覆盖层(本 ADR 选定)**:单文件、单一真相源不变,base 为公共基线、profile 只记差异(add/remove),v1 平滑迁移;差异化逻辑收敛进一个纯函数(守 I4)。

## 后续(owner 批准后)

将状态改为「接受」,据此实现:`schemaVersion` 1→2 → 扩展 `SelectionDoc` + `migrate` → 新增 `resolveSelection` → 各编排入口与写入路径接入 profile 维度 → 补齐上述测试。**在批准前,本 ADR 仅为规范,selection 行为不变。**
