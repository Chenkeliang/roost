# Roost

> Settle into any Mac. Back up your config on your main machine, load it onto another — you choose exactly what.

Roost is an open-source macOS configuration backup & migration tool. On your main Mac you **select** what to manage (dotfiles, packages, app config, projects, secrets); Roost stores it in **your own private git repo**; on another Mac you **load** it back with one command — with a visual manager for what's backed up.

## Why it's safe
- **Your data stays yours.** Config lives in **your** private git repository. No server, no account, **no telemetry**, nothing phoned home.
- **Secrets are optional.** Most setups — dotfiles, packages, app config, projects — need no key at all. *If* you back up secret files, they're encrypted with your own [age](https://github.com/FiloSottile/age) key, never shown in the UI or logs, and a pre-commit scanner blocks plaintext secrets from entering the repo.
- **No required password manager.** Getting your age key onto a second Mac is your choice — copy it once manually, or pull it from **1Password** or **rbw** (free, open-source) — and if you skip all that, each machine just generates its own key. **None is required.** See [SECURITY.md](./SECURITY.md).
- **Reversible by default.** `load` previews changes (dry-run) and backs up existing files before overwriting.

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

## Documentation
User-facing docs live in [`website/`](./website) — a Starlight (Astro) site, standalone from the pnpm workspace. Run it locally:
```bash
pnpm --dir website install
pnpm --dir website dev     # or: pnpm --dir website build
```

## Built on
[chezmoi](https://www.chezmoi.io/) (dotfiles + age encryption), Homebrew, [mise](https://mise.jdx.dev/), TypeScript. macOS only (v1).

## License & commercial
The engine (CLI + libraries in this repo) is open source under the **MIT** license — see [LICENSE](./LICENSE) and [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md). Roost follows an **open-core** model: a signed desktop app and optional "pro" features may be offered commercially. Contributions require a DCO sign-off (`git commit -s`). See [docs/adr/0003-license-and-business-model.md](./docs/adr/0003-license-and-business-model.md).
