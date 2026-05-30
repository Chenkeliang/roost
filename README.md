# Roost

> Settle into any Mac. Back up your config on your main machine, load it onto another — you choose exactly what.

Roost is an open-source macOS configuration backup & migration tool. On your main Mac you **select** what to manage (dotfiles, packages, app config, projects, secrets); Roost stores it in **your own private git repo**; on another Mac you **load** it back with one command — with a visual manager for what's backed up.

## Why it's safe
- **Your data stays yours.** Config lives in **your** private git repository. No server, no account, **no telemetry**, nothing phoned home.
- **Secrets are encrypted with your own key** (age) and never printed in the UI or logs. A pre-commit scanner blocks plaintext secrets from entering the repo.
- **Reversible by default.** `load` previews changes (dry-run) and backs up existing files before overwriting.
- **Free secret backend: rbw.** The recommended zero-cost way to store and retrieve your age private key is [rbw](https://github.com/doy/rbw) (open-source Bitwarden CLI). After a one-time `rbw login`, `bootstrap.sh` fetches the key automatically via `rbw get <ref>`. See [SECURITY.md](./SECURITY.md) for full setup instructions.

## Two repos, don't mix them
- **Roost (this tool)** — the engine + CLI (+ desktop app later). Ships with zero personal data.
- **Your config repo** — your private git repo = the single source of truth (Roost's chezmoi source).

> Roost is to your config repo what git is to your code repo. We build the tool; you own the data.

## Status
Early development (P0 foundation). See `docs/ROADMAP.md` for phases (P0 scaffold → P1 MVP → P2 extend → P3 desktop app) and `docs/superpowers/specs/` for the locked design.

## Quick start (dev)
```bash
pnpm install
pnpm -r build
pnpm test
node packages/cli/dist/index.js doctor   # later: `roost doctor`
```

## Built on
[chezmoi](https://www.chezmoi.io/) (dotfiles + age encryption), Homebrew, [mise](https://mise.jdx.dev/), TypeScript. macOS only (v1).

## License
MIT — see [LICENSE](./LICENSE).
