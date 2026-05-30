# Security Policy

Roost manages configuration and secrets, so trust is the product. Please read the model below.

## Reporting a vulnerability
Report privately via a [GitHub security advisory](https://docs.github.com/en/code-security/security-advisories) on this repository, or open a minimal issue asking for a private contact channel — do **not** disclose details in public issues. We aim to acknowledge within a few days.

## Trust model
- **age key is the root of trust.** All secrets in your config repo are encrypted to your age key. If you lose it (and its recovery code / password-manager entry), encrypted data cannot be recovered. Back it up offline.
- **No telemetry, no server.** Roost never transmits your data anywhere. Your config repo and remotes are entirely under your control.
- **Secrets never surface.** Secret values are never shown in the UI or written to logs; `capture` is gated by a plaintext-secret scanner that blocks unencrypted secrets from entering the repo.
- **Plugins run with full user privileges.** A Roost module/plugin can read and execute as you. Only install plugins you trust; Roost will require explicit confirmation before installing a plugin (planned for the plugin loader, P2).

## Recommended free secret backend: rbw (open-source Bitwarden CLI)

Roost supports pluggable secret backends for retrieving the age private key at bootstrap.  The recommended zero-cost backend is **[rbw](https://github.com/doy/rbw)** — an open-source, unofficial Bitwarden CLI.

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
