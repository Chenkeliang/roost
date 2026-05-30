# ADR-0004: secret env 取值与解析(1Password / rbw / age)

- **状态**: 接受(ACCEPTED · 2026-05-30)。owner 已批准;本 ADR 锁定的契约与数据形状已据此实现。
- **日期**: 2026-05-30

## 背景

`env` 模块(「Aliases & Env」)已能管理 secret 环境变量,但目前**只有一种取值来源**:

- 用户输入明文 → 经 age 加密为 `roost/env-secrets/<NAME>.age` 写入仓库 → `apply` 时用本机 age 私钥(`~/.config/sops/age/keys.txt`)解密 → 内联进本地 `~/.config/roost/env.sh`(chmod 600,不入库)。

这条对"无密码管理器"用户友好,但有两个局限:

1. **仍把密文入库**。对"密钥只想留在 1Password / Bitwarden、一个字节都不进 git 仓库"的用户,age 方案并不理想。
2. **`SecretBackend` 已存在但未接通**。`packages/core/src/secrets/backend.ts` 已实现 `createOpBackend`(`op read <ref>`)、`createRbwBackend`(`rbw get <ref>`),契约是 `get(ref): Promise<string>`;但 env 模块的 secret 流程**尚未调用它**。

诉求:让 secret env 的值**可以是一个指向 1Password / rbw 条目的引用**,在 `apply` 时即时取值,**仓库里连密文都不存**。

## 决定

给 secret `EnvVarItem` 增加一个**取值来源判别字段** `source`,支持两种来源(默认 `age`,向后兼容):

```ts
// @roost/shared — EnvVarItem 扩展(仅 secret 项使用 source;非 secret 不受影响)
type EnvSecretSource =
  | { kind: "age" }                               // 现状:密文入库,本机 age 私钥解密
  | { kind: "ref"; backend: "op" | "rbw"; ref: string }; // 新增:引用,apply 时经后端取值

interface EnvVarItem {
  kind: "env";
  name: string;
  value: string;            // secret 项:committed yaml / API 一律为 ""
  secret: boolean;
  source?: EnvSecretSource; // 缺省视为 { kind: "age" }(兼容既有数据)
  comment?: string;
  enabled: boolean;
}
```

**`source.kind === "ref"` 的规则(实现时为 MUST):**

- `env.yaml` 只存**引用**(`op://Vault/Item/field` 或 rbw 条目名)—— 引用是定位符、非密钥本身;**绝不存密文,也不写 `roost/env-secrets/`**。
- `apply` 时经**已有的** `SecretBackend.get(ref)`(`op`/`rbw`,均走唯一 `exec` 出口,I1/I3)取值 → 内联进 chmod 600 的本地 `env.sh` → 用完即弃,不落其它盘、不入库、不进日志、不进 UI 响应(I6)。
- `op`/`rbw` 不可用或取值失败:`apply` 对该项**失败安全**(跳过 + 明确告警,不写半成品;I10),`doctor` 提前声明依赖(M5)。
- `status`/`diff`/`discover` 与 `GET /api/env` **永不**回显引用解析后的值;引用字符串本身可在 UI 显示(它是定位符,不是密钥)。

**`source.kind === "age"`(或缺省)** = 维持现状,一字不改。

`env.yaml` `schemaVersion` 升一位;`loadEnvData` 对旧数据(无 `source`)按 `age` 解释。

## 触及不变量

- **I6 密钥三禁**:`ref` 方案进一步收紧(密文都不入库);引用解析值全程内存、即用即弃。
- **I1 薄编排 / I3 唯一出口**:复用既有 `op`/`rbw` 后端,经 `exec`,不自造取值逻辑。
- **数据 schema 扩展**(`EnvVarItem` 增 `source`、`env.yaml` schemaVersion +1)—— 正因触及 schema,故按 §11–§13 走本 ADR。

## 影响

- `packages/shared`:`EnvVarItem` + `EnvSecretSource` 类型。
- `packages/core`:env 模块 `capture`(ref 项不加密、只存引用)、`apply`(按 `source` 分流:age 解密 vs 后端取值)、`doctor`(检测 `op`/`rbw` 可用性)、`env-data`(schemaVersion + 校验 `ref`/`backend` 合法、引用串做注入安全校验,沿用 C1–C3 的转义/白名单)。
- `packages/web`:secret env 编辑增"来源"选择(age 加密 / 1Password 引用 / rbw 引用)+ 引用输入框;值输入仅在 age 模式出现。
- 测试:单元 / dry-run / 幂等(M1/M2)+ ref 取值成功/失败/不可用 + **无泄露**(引用解析值不入库/不显形/不进日志)。
- 文档:README/SECURITY 增"secret env 三种来源"说明。

## 替代方案

- **A. 维持 age-only(现状)**:简单、零新依赖;但密文入库、且要求 age 私钥落地。够用,但满足不了"密钥只留密码管理器"诉求。
- **B. 强制 ref(去掉 age)**:最干净(仓库零密钥),但把 1Password/rbw 变成硬门槛,违背"无需密码管理器"的产品承诺(README 已明确三后端 + 各自生成密钥皆可)。
- **C. 混合(本 ADR 选定)**:`age` 与 `ref` 并存、用户逐项选来源 —— 兼顾"无密码管理器"与"密钥不入库"两类用户;复用现有后端,改动集中在一个判别字段。

## 后续(owner 批准后)

将状态改为「接受」,据此实现:`schemaVersion` +1 → 扩展 `EnvVarItem` → 把 `SecretBackend` 接进 env `apply` 的 ref 分支 → web 增来源选择 → 补齐上述测试。**在批准前,本 ADR 仅为规范,env 模块行为不变。**
