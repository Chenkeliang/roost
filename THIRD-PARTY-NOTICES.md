# Third-Party Notices

Roost is built on, and orchestrates, third-party software. **Every component in Roost's production dependency tree is under a permissive license** (MIT / ISC / BSD-3-Clause / BlueOak-1.0.0 / Apache-2.0 / Python-2.0) — there is **no copyleft (GPL/LGPL/AGPL) code distributed with Roost**. This permits commercial use and distribution, provided the notices below are preserved.

> This is a curated summary. For an authoritative, machine-generated list of the exact versions and licenses in the current build, run:
> `pnpm licenses list --long`

## A. External tools Roost invokes (NOT bundled / not redistributed)

By design (invariant I1 "thin orchestration", I3 "single exec adapter"), Roost runs these tools as **separate processes** — their code is **not linked into or redistributed by** Roost. The user installs them (typically via Homebrew). Listed for credit and clarity.

| Tool | Project | License |
|---|---|---|
| chezmoi | twpayne/chezmoi | MIT |
| age | FiloSottile/age | BSD-3-Clause |
| Homebrew | Homebrew/brew | BSD-2-Clause |
| git | git/git | GPL-2.0 — invoked as a separate process only; inter-process invocation does **not** trigger copyleft obligations on Roost |
| mise | jdx/mise | MIT |
| sops | getsops/sops | Apache-2.0 |
| mas | mas-cli/mas | MIT |
| rbw (optional) | doy/rbw | MIT |
| 1Password CLI (optional) | AgileBits | Proprietary — invoked only if the user has it; never bundled |
| `defaults` | Apple macOS | System tool (not redistributed) |

## B. Bundled libraries (part of Roost's distributed code)

These npm packages are compiled into Roost's `core` / `cli` / `web` bundles and are therefore redistributed. Production-tree license summary (from `pnpm licenses list --prod`):

- **83 × MIT**, 8 × ISC, 5 × BlueOak-1.0.0, 3 × BSD-3-Clause, 1 × Apache-2.0, 1 × Python-2.0 — **all permissive, none copyleft**.

Notable direct dependencies (all MIT unless noted): `execa`, `commander`, `fastify`, `@fastify/static`, `js-yaml`, `@clack/prompts`, `react`, `react-dom`, `@phosphor-icons/react`, `tailwindcss`, `vite`, `@vitejs/plugin-react`.

Each package's full license text ships in its `node_modules/<pkg>/LICENSE` and in its source repository.

## C. Desktop shell (optional)

The Tauri desktop app uses **Tauri** (dual-licensed Apache-2.0 OR MIT) and Rust crates under permissive licenses.

## Obligations when you distribute Roost (e.g., a paid app)

1. Keep this `THIRD-PARTY-NOTICES.md` (or equivalent) in the distribution.
2. If you choose to **bundle** any external binaries (chezmoi/age/etc.) instead of relying on user-installed copies, include their `LICENSE` / copyright text.
3. Preserve the `NOTICE` file for any Apache-2.0 components you bundle (e.g., sops).
4. Do not use the names/marks of these projects to imply their endorsement.

**None of the above prevents charging for Roost.** What Roost itself may be sold/licensed as is a separate decision — see `docs/adr/0003-license-and-business-model.md`.

## Thanks

Roost stands on the shoulders of chezmoi, age, Homebrew, mise, sops, and the wider open-source ecosystem. Thank you.
