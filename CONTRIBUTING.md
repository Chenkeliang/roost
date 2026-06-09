# Contributing to Roost

Thanks for helping! A few rules keep the project coherent and the design stable.

## Dev setup
```bash
pnpm install
pnpm -r build      # build first: dependents resolve dep types via built dist
pnpm -r typecheck
pnpm test          # vitest
pnpm lint          # eslint (typescript-eslint), pnpm format for prettier
```
Requires Node 24 (see `.nvmrc`) and pnpm 9. Run a single package's tests with `pnpm vitest run packages/<name>`.

## Ground rules
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, …).
- **Branch off into `feat_*`** — never commit directly to `main`.
- **Every module ships three kinds of tests:** unit, dry-run (no writes in dry-run), and idempotency (re-apply has no side effects).
- **Add capability as a module, not by editing `core`.** `core` holds no domain logic — new functionality implements the `SyncModule` contract (or another extension point). See `docs/superpowers/specs/2026-05-30-roost-architecture.md` §7.
- **All external commands go through the `exec` adapter.** No direct `child_process`/network in `core`.
- **Never log or display secret values.** Sensitive data goes through the secret pipeline.

## Changing the architecture
The design is **locked** (see `docs/superpowers/specs/` and `docs/adr/`). Any change to architecture, scope, or data schema requires a new **ADR** in `docs/adr/NNNN-*.md` (template in the architecture doc §13). No ADR → no architectural change. Anything outside the frozen scope is out until an ADR opens it.

## License & contributions (DCO)
Roost is **open-core**: the engine (CLI + libraries in this repo) is open source under **MIT**; a signed desktop app and optional "pro" features may be offered commercially (see `docs/adr/0003-license-and-business-model.md`).

By contributing you agree that:
- your contribution is licensed to the project under the repository's **MIT** license, **and**
- the maintainer may include it in commercial distributions of Roost (the signed app / pro features), consistent with the open-core model.

Sign off every commit with the **Developer Certificate of Origin** ([DCO](https://developercertificate.org/)) by adding a `Signed-off-by` line — use `git commit -s`. PRs without sign-off can't be merged.

## Before opening a PR
Run `pnpm lint && pnpm -r build && pnpm -r typecheck && pnpm test && pnpm --filter @roost/web test` — all green. Keep changes surgical and scoped to one concern.
