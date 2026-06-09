# ADR-0001: 基础技术与产品决策

- 状态: 接受
- 日期: 2026-05-30
- 背景: Roost 立项,需锁定底座与技术栈以防后续漂移。
- 决定: 见 `../superpowers/specs/2026-05-30-roost-architecture.md` §13 决策表——chezmoi 底座 / age+sops(密钥托管 1Password·rbw)/ 单一 git 源·主力→从机 / TypeScript + pnpm / commander / mise(per-project env)/ chezmoi `run_onchange_` 幂等 / Raycast 珊瑚红 + Geist / Phosphor + 圆角方形图标 tile / 克制动效(Variance3·Motion4·Density5)/ MIT。
- 触及不变量: 确立 I1–I10。
- 影响: 全项目基线。
- 替代方案: nix-darwin(重)、Stow+自研(重写成熟能力)、mackup 引擎(注册表不全 + Sonoma plist 坑)——均在 design 调研中否决。
