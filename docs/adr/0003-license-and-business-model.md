# ADR-0003: License & business model

- **状态**: 提议(PROPOSED — 待 owner 拍板)。**在选定前:仓库维持 MIT + 私有 + 暂不合并外部 PR / 不接受外部贡献者。**
- **日期**: 2026-05-30

## 背景
Owner 希望保留未来商业化的可能(尤其把打磨好的桌面 App 收费),同时项目计划开源。两个**时间敏感**的约束:

1. ADR-0001 把 license 锁成 **MIT**。MIT 允许 owner 收费,**但也允许任何人 fork 后转卖或免费再分发** —— 对"靠卖 App 变现"形成抄袭/被白嫖风险。
2. **改 license 必须在"公开 / 接受外部贡献者"之前定**。一旦有外部贡献者,relicense 需要**全体贡献者同意**,几乎不可逆。

依赖侧无障碍:`pnpm licenses` 扫描显示生产依赖**全部宽松**(MIT/ISC/BSD-3/BlueOak/Apache-2.0/Python-2.0,零 copyleft);底层工具 chezmoi(MIT)、age(BSD-3)亦允许商用,且 Roost 是**薄编排、独立进程调用**它们(不内嵌代码)。**结论:"能不能收费"只取决于 Roost 自己的 license。**

## 决定(三选一,待 owner 拍板)

- **A. 维持 MIT** — 最大化采纳与社区善意;但**无法阻止闭源商业克隆**(别人可拿你代码做一模一样的付费 App)。适合"以影响力/赞助为主、不强求卖 App"。
- **B. Open-core(推荐)** — **引擎/CLI/core 保持开源**(MIT 或 Apache-2.0),**桌面 App 成品(签名分发 + 自动更新)与/或 "pro" 功能作为专有产品收费**。卖的是**便利、品牌、支持**,而非代码;护城河是打磨与分发,不是算法。绝大多数"开源工具 + 付费 App"走这条。
- **C. 引擎 AGPL-3.0 + 商业双授权** — 引擎用 **AGPL/GPL**(强 copyleft,劝退闭源/SaaS 克隆:谁拿去做闭源必须开源其改动),同时对不愿受 copyleft 约束者**出售商业授权**。变现保护最强,但对纯社区采纳略有摩擦,且要求 owner 持有版权(贡献者须签 CLA/DCO)。

**推荐:B(open-core)。** 理由:与现有架构天然契合(core 本就是独立引擎,App 是其上一层);对社区最友好;变现路径清晰(直卖签名 App + 支持);无需把整库 copyleft。若你预期会有"竞品拿去做闭源 SaaS"的具体威胁,再升级到 C(AGPL)。

## 触及不变量
取代/细化 ADR-0001 的 MIT 决定;影响 architecture §13「开源就绪」。

## 影响
- license 文件、(可选)每文件 license 头、README 徽章与商业条款说明。
- `CONTRIBUTING.md` 需加贡献者协议:**B/C(尤其 C)需 DCO 或 CLA**,以保住未来 relicense / 商业授权的权利。
- **商标**:建议注册 **"Roost" 文字商标** —— 别人能 fork 代码,但不能用你的名字(品牌即护城河的一部分)。
- **Apple**:卖 Mac App 需 **Apple Developer Program($99/年)**;直卖(Gumroad / Paddle / 官网)省 App Store 15–30% 抽成。
- **无服务器**设计 → 边际成本近零,利润结构好。
- `THIRD-PARTY-NOTICES.md` 已就位,满足分发时的署名义务。

## 替代方案
即上面的 A / C(及其权衡)。

## 后续(一旦 owner 选定)
将本 ADR 状态改为「接受」,据此执行:换/拆 license 文件 → 加 CLA/DCO → README 写明开源范围与商业条款 → 列商标待办。**在此之前,仓库保持私有、MIT、不接受外部贡献。**
