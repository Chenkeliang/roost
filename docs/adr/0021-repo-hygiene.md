# ADR-0021: Repo hygiene — encryption churn control and large-file gating

- Status: Accepted
- Date: 2026-06-11
- Spec: `docs/superpowers/specs/2026-06-11-roost-repo-hygiene-design.md`

## Context

A real config repo reached 2.6 GiB and its push appeared to hang. Two causes:
(1) age encryption is non-deterministic, so every capture re-encrypted every
encrypted file into a new blob even when the plaintext was unchanged — daily
auto-backup (ADR-0020) compounds this; (2) regenerable multi-MB binaries and
"backup-of-backup" directories were captured wholesale with no warning. Fixing
this touches governed surfaces: the `state/<host>.json` schema (§6), the
selection conventions (ADR-0010), and the shared `BlockReason` type.

## Decision

1. **Plaintext-hash short-circuit for encrypted captures.** The dotfiles module
   records `encHashes` (`{ filePath: sha256(plaintext) }`) under its module
   entry in `state/<host>.json`, **separate from** the ADR-0018 `baseline` bag.
   Capture skips `chezmoi add --encrypt` when all hashes match and the source
   already holds the ciphertext. Hash failures fall back to re-encrypting —
   the optimization may never block a capture.
2. **Large-file policy: gate new, advise stock, never touch local files.**
   `LARGE_FILE_MB = 10` (constant). New >10MB files are kept out of the source
   (post-add `chezmoi forget`) and surfaced as blocked reason `"large"`
   (added to the shared `BlockReason` union) until the user decides. Files
   already in the repo are only advised. Two new selection convention lists —
   `dotfiles-exclude` (sticky never-capture) and `dotfiles-large-ok`
   (user-approved large files) — following the `dotfiles-encrypt` precedent.
   **Invariant: all remediation acts on the repo/selection only; user files on
   disk are never modified or deleted.**
3. **Single-flight pushes.** One push at a time process-wide (API route and
   auto-backup share the lock); concurrent attempts return `hint: "busy"`
   (added to the git-op hint union) instead of racing for bandwidth.

## Consequences

- Encrypted files produce new blobs only when their content actually changes;
  daily auto-backup no longer grows the repo on idle days.
- Users learn about repo-bloating files at the moment of capture (new) or on
  the Overview (stock), with one-click repo-side remediation.
- `state/<host>.json` gains an optional per-module `encHashes` field (older
  builds ignore it; missing field = re-encrypt as before — fully compatible).
- History rewriting stays an operational task, not product behavior.
