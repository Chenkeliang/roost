# Security Policy

Roost manages configuration and secrets, so trust is the product. Please read the model below.

## Reporting a vulnerability
Report privately via a [GitHub security advisory](https://docs.github.com/en/code-security/security-advisories) on this repository, or open a minimal issue asking for a private contact channel — do **not** disclose details in public issues. We aim to acknowledge within a few days.

## Trust model
- **age key is the root of trust — but only if you back up secrets.** If you don't use the secrets module, there is no key to worry about. If you do, secret files are encrypted to your age key; lose it (and any recovery copy) and that encrypted data is unrecoverable — so back it up offline.
- **No telemetry, no server.** Roost never transmits your data anywhere. Your config repo and remotes are entirely under your control.
- **Secrets never surface.** Secret values are never shown in the UI or written to logs; `capture` is gated by a plaintext-secret scanner that blocks unencrypted secrets from entering the repo.
- **Plugins run with full user privileges.** A Roost module/plugin can read and execute as you. Only install plugins you trust; Roost will require explicit confirmation before installing a plugin (planned for the plugin loader, P2).

## Encrypting secrets — optional, and the key backend is your choice

Roost supports pluggable secret backends for retrieving the age private key at bootstrap.  **Secrets are an optional module** — if you only sync dotfiles, packages, app config, and projects, none of this applies. *When* you do encrypt secret files, they are encrypted with **[age](https://github.com/FiloSottile/age)** (a single-file, open-source tool — no password manager required). The only real question is how a **second** Mac obtains the **same** age private key. Pick one:

- **(A) Manual — zero extra tools.** `age-keygen` once, then copy `~/.config/sops/age/keys.txt` to the other Mac yourself (AirDrop / USB / Keychain).
- **(B) 1Password** (`op`) — if you already use it. Store the key; set `ROOST_AGE_OP_REF`.
- **(C) rbw** (free, open-source Bitwarden CLI) — the recommended *free + automatic* option, detailed below. Set `ROOST_AGE_RBW_REF`.

`bootstrap.sh` tries them in order and **falls back to generating a fresh local key** if none is configured. **rbw is never required** — it is just option C.

### How it works

1. **One-time setup** — `brew install rbw`, then `rbw login` (enters your Bitwarden master password; this is the single manual authentication step).
2. **Bootstrap** — `bootstrap.sh` calls `rbw get <ref>` to fetch the age private key from your Bitwarden vault before running `chezmoi apply`.  Set `ROOST_AGE_RBW_REF` to the vault item name/UUID that holds the age key.
3. **Runtime** — the key is written to `~/.config/sops/age/keys.txt` (mode `0600`) and is used by chezmoi for all subsequent encrypt/decrypt operations.

### Setup example

```sh
brew install rbw
rbw login                          # one-time: enter Bitwarden credentials
rbw add roost-age-key              # store your age private key in Bitwarden
export ROOST_AGE_RBW_REF=roost-age-key
./scripts/bootstrap.sh             # pulls the key via rbw and applies dotfiles
```

If rbw is not installed (or `ROOST_AGE_RBW_REF` is not set), `bootstrap.sh` falls back to generating a new age key locally.

The 1Password CLI (`op`) is the alternative backend for users already on 1Password; set `ROOST_AGE_OP_REF` instead.

## Scope
v1 targets macOS only. Roost orchestrates trusted tools (chezmoi, Homebrew, age, rbw, mise, git) through a single audited exec gateway; it does not bypass their security properties.
