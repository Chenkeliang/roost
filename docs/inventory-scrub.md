# `inventory/` 公开前清洗规范(going-public hard gate)

> **状态**:规范先行(2026-05-30)。仓库**当前私有**,正因为 `inventory/` 含真机审计的内部数据。
> **本规范是仓库公开前的硬门:未通过本规范的验证门,不得 `gh repo edit --visibility public`。**

## 1. 为什么 `inventory/` 敏感
`inventory/` 是**首台真机审计**的产物,夹带了用户所在公司的内部信息(内网 Git 主机 `gitlab.luojilab.com`、内部仓库名等)。当前已知敏感面(`grep -rc luojilab inventory/`):

| 文件 | 命中 `luojilab` | 性质 |
|---|---|---|
| `inventory/projects.draft.yaml` | 58 | 重度:大量内部仓库 URL/名 |
| `inventory/INVENTORY.md` | 2 | 审计正文 |
| `inventory/Brewfile.draft` | 1 | 注释/源 |

## 2. 红线规则(绑定,违反即不合规)
- **I8 零个人硬编码**:产品出厂不含任何用户私有数据;策展数据必须是**可覆盖的数据文件**。
- `inventory/` **仅作测试夹具**,**绝不进产品逻辑、绝不被硬编码**(见 `CLAUDE.md`)。
- 公开 = 连**完整 git 历史**一起公开 → 仅删文件不够,**历史里的副本必须一并清除**(与 `unmanage` 不清历史是同一课)。

## 3. 处置策略:夹具化,而非简单删除
模块测试依赖这些草稿做夹具,**不能直接 `rm`**。策略 = **用合成数据替换真实数据**:

- 内网主机 `gitlab.luojilab.com` → `git.example.com`(或 `github.com/acme`)。
- 内部仓库/组织名 → 通用占位(`acme/web-app`、`acme/api` …)。
- 真实用户名 / 邮箱 / 绝对家目录(`/Users/<name>/…`)→ `youruser` / `you@example.com` / `$HOME/…`。
- 任何 token / 私有 URL / 内网 IP → 删除或占位。
- **真机审计原件**(若想留存)移出仓库到本地私有位置,公开仓库内只保留**合成夹具**。

夹具瘦身到"能跑测试"即可,不必复刻 58 条。

## 4. 步骤
1. **盘点**:跑下方"敏感标记清单",列出所有命中点(不止 `luojilab`)。
2. **替换工作树**:按 §3 把三文件里的真实数据换成合成占位。
3. **测试仍绿**:`pnpm test`(尤其依赖 inventory 夹具的用例)必须全绿——证明夹具化没破坏测试契约。
4. **清 git 历史**:用 `git filter-repo`(优先)或 BFG 把历史中含敏感标记的 blob 一并改写/移除;改写后 `git push --force-with-lease`(注意:有外部贡献者后历史改写代价高,**务必在公开/接受贡献之前做**)。
5. **双重验证**(见 §5)。

## 5. 验证门(全部通过才算清洗完成)
```bash
# (a) 工作树:所有敏感标记必须为 0 命中
grep -rIn -e luojilab -e '@.*\.luojilab' -e '/Users/keliang' -e '<你的真实用户名>' . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist

# (b) git 历史:全历史搜索敏感标记,必须无任何 blob 命中
git rev-list --all --objects | git cat-file --batch-check='%(objectname) %(rest)' >/dev/null
git log -p --all -S 'luojilab' | head    # 应为空
git grep -I 'luojilab' $(git rev-list --all) | head   # 应为空

# (c) 门禁仍绿
pnpm lint && pnpm -r build && pnpm -r typecheck && pnpm test && pnpm --filter @roost/web test
```
(a)(b) 均 0 命中 **且** (c) 全绿 → 通过。

> **敏感标记清单**(每次清洗前按需补充):内网域名 `*.luojilab.com`、公司/组织名、内部仓库名、真实用户名、邮箱、绝对家目录 `/Users/<name>`、内网 IP、任何 token/密钥、私有 Git remote URL。

## 6. 与发布的关系
本规范是 **ADR-0003「公开前待办」之一的落地**。公开前完整门 = 本清洗门 +(注册「Roost」文字商标)+(README 开源范围与商业条款,已就位)。**三者未齐,仓库保持私有。**
