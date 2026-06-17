# ADR-0025: Local reveal of encrypted previews (relax I6 "never in UI")

- Status: Accepted
- Date: 2026-06-17
- Touches invariant: I6 (secrets: never plaintext in repo · never shown in UI · never in logs)

## Context

I6 forbade showing secret content in the UI **at all**. In practice a user often
needs to inspect their own encrypted config locally — e.g. to see what's inside
`~/.claude.json` (`mcpServers`, env keys) without leaving Roost. The masked
structural preview (ADR-adjacent, shipped in v0.2.1) shows the shape with every
value `••••`, but the owner of the data, on their own machine, with their own
key, legitimately wants to see the real values sometimes. The acute point the
user raised: "what's uploaded to the remote must always be ciphertext, but local
display can have a reveal toggle."

## Decision

Relax **only** the "never shown in UI" clause of I6, into:

> Secret values are **masked by default** in the UI. The real (plaintext) value
> is shown **only** on an explicit, per-view user action (an eye toggle), is
> **local-only**, and is **never written to logs**.

The other two clauses of I6 are unchanged and remain hard invariants:
- **Never plaintext in repo / remote.** `capture` always encrypts; nothing about
  this feature touches the storage path. The repo/remote copy stays ciphertext.
- **Never in logs.** Revealed values are returned to the local UI only; not logged.

Scope of "reveal":
- Applies to **encrypt-marked entries whose local file is plaintext** (catalog
  `policy:"encrypt"` + user-marked `dotfiles-encrypt`). Revealing reads that local
  plaintext file and returns it unmasked.
- **`skip` / credential entries are never revealed** (still refused outright).
- **`.age` true-ciphertext artifacts** (the encrypted repo copies) are **out of
  scope** here — revealing those would require decrypting with the age key in the
  UI; deferred to a later ADR if needed.

Mechanics:
- `GET /api/file-preview?reveal=1` returns the unmasked local content for an
  encrypt-marked path; without `reveal` it returns the masked structure (default).
- The web preview pane shows a leading **eye** toggle when a preview is maskable;
  clicking re-fetches with/without `reveal`. Default state is masked.

## Consequences

- Roost moves from "stricter than typical secret tools" to a **password-manager-like
  reveal posture**: hidden by default, shown only when the user explicitly asks.
- Residual risk: a revealed value can be shoulder-surfed / screenshotted / screen-shared.
  Mitigated by: masked-by-default, explicit per-view opt-in, local-only, never-logged,
  and skip/credential entries never revealed.
- The remote/repo guarantee — the whole point of Roost's secret handling — is
  **unchanged**: secrets are always ciphertext at rest and in transit.
