# Security Policy

Roost manages configuration and secrets, so trust is the product. Please read the model below.

## Reporting a vulnerability
Report privately via a [GitHub security advisory](https://docs.github.com/en/code-security/security-advisories) on this repository, or open a minimal issue asking for a private contact channel — do **not** disclose details in public issues. We aim to acknowledge within a few days.

## Trust model
- **age key is the root of trust.** All secrets in your config repo are encrypted to your age key. If you lose it (and its recovery code / password-manager entry), encrypted data cannot be recovered. Back it up offline.
- **No telemetry, no server.** Roost never transmits your data anywhere. Your config repo and remotes are entirely under your control.
- **Secrets never surface.** Secret values are never shown in the UI or written to logs; `capture` is gated by a plaintext-secret scanner that blocks unencrypted secrets from entering the repo.
- **Plugins run with full user privileges.** A Roost module/plugin can read and execute as you. Only install plugins you trust; Roost will require explicit confirmation before installing a plugin (planned for the plugin loader, P2).

## Scope
v1 targets macOS only. Roost orchestrates trusted tools (chezmoi, Homebrew, age, mise, git) through a single audited exec gateway; it does not bypass their security properties.
