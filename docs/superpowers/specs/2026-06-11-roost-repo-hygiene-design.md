# Roost Repo Hygiene — Design Spec

**Date:** 2026-06-11
**Status:** Approved (brainstorming) — ready for implementation plan
**Branch:** `feat_repo_hygiene` (based on `origin/main`)
**ADR:** `docs/adr/0021-repo-hygiene.md`

## Goal

Stop the config repo from bloating, and tell users when it would. Three product
changes plus one operational task, born from a real incident (a 2.6 GiB config
repo whose push appeared to hang):

A. **Skip re-encryption when plaintext is unchanged** — age encryption is
   non-deterministic, so every capture re-encrypted every encrypted file into a
   brand-new blob even when nothing changed (25 MB × every capture, daily under
   auto-backup).
B. **Push concurrency guard** — two pushes can run at once today (banner button
   resets on remount; scheduler may overlap), competing for bandwidth.
C. **Large-file detection** (user decision: *gate new, advise stock*) — files
   over a threshold entering the repo are blocked pending user confirmation;
   files already in the repo are listed with a remove action.
D. **Operational**: squash the user's own config-repo history to a single
   commit (user decision; bundle backup first) — 2.6 GiB → tens of MB.

**Hard invariant (user's red line):** every action in this feature touches ONLY
the repo and `selection.yaml`. **No user file on disk is ever modified or
deleted** (`chezmoi forget` removes from the source repo only). UI copy states
this on every action ("不影响本地文件 / never touches your local file").

## A. Skip re-encrypt when unchanged

- New per-host record `encHashes` under the dotfiles module entry in
  `state/<host>.json` — `{ absoluteFilePath: sha256(plaintext) }`. Kept
  **separate from `baseline`** (ADR-0018's three-way sync bag) to avoid key
  collisions; readers of `baseline` are unaffected.
- Helpers in `packages/core/src/sync-baseline.ts`: `readEncHashes(repoDir,
  host, module)` / `recordEncHashes(repoDir, host, module, hashes)` (merge
  semantics, same defensive style as the baseline helpers).
- In `dotfiles.capture`, for a `wantsEncrypt` id: hash the plaintext file(s)
  (for a directory id: every regular file beneath it, skipping symlinks). If
  **all** hashes equal the recorded ones **and** the id is already managed in
  the source, skip `chezmoi.add` entirely (no new ciphertext). Otherwise add
  and record the new hashes.
- Unencrypted ids are untouched (git already dedupes identical plaintext).

## B. Push concurrency guard

- Module-scope in-flight lock around `runGitPush` in `server.ts`, shared by
  `POST /api/git/push` and the auto-backup scheduler's `runPush`.
- A push attempted while one is running returns immediately:
  `{ ok: false, output: "push already in progress", hint: "busy" }`.
- `GitOpResult.hint` union gains `"busy"`; the unpushed banner shows
  「已有推送在进行,稍候再试」 for it.

## C. Large-file detection

Threshold: `LARGE_FILE_MB = 10` (single constant in core; a setting later if
ever needed). Two new selection convention lists (same mechanism as
`dotfiles-encrypt`, ADR-0010):
- `dotfiles-exclude` — paths never captured (and removed from the source if
  present): the sticky "移出管理/移出备份" record.
- `dotfiles-large-ok` — large files the user explicitly approved.

**Gate new large files (capture-time):** before adding an id, scan its regular
files; offenders = files > threshold that are NOT in `dotfiles-large-ok` and
NOT already managed in the source (stock files keep flowing), plus everything
under `dotfiles-exclude`. After `chezmoi.add(id)`, `chezmoi.forget` each
offender from the source. New-large offenders are reported as blocked with the
new reason `"large"` (detail = size in MB); excluded ones are silent. Local
files are never touched.

**Advise stock large files:** `GET /api/backup/status` gains
`largeItems: { path: string; mb: number }[]` — a walk of the repo source tree
(skipping `.git/`, `roost/`, `state/`) for files > threshold, mapped back to
their target paths. Overview shows a collapsible advisory banner (lowest
priority, below stale): 「备份中有 N 个大文件(共 X MB)」 → expanded rows
`path · size · [移出备份(不影响本地文件)]`.

**Actions:**
- Blocked "large" item (Overview blocked list, alongside secret/too-large):
  「仍要备份」 → `POST /api/selection/add {module:"dotfiles-large-ok", id}` —
  included next capture; 「移出管理」 → `POST /api/dotfiles/exclude {path}`.
- Stock large item: 「移出备份」 → `POST /api/dotfiles/exclude {path}`.
- New endpoint `POST /api/dotfiles/exclude {path}`: `chezmoi forget --force`
  the path (tolerating not-managed), append to `dotfiles-exclude`, commit via
  `finalizeCapture`, invalidate cache. Repo-side only.

## D. Operational (after A lands)

On the user's `roost-config` repo: 1) `git bundle` full backup to a local
file; 2) squash all history into one initial commit (tree = current HEAD);
3) force-push; 4) verify fresh clone + app Timeline works (starts from the new
commit). Expected 2.6 GiB → tens of MB. Performed manually by the assistant
with the user watching, not product code.

## Error handling

- Hashing failures (unreadable file) → treat as changed (re-encrypt); never
  block capture on the optimization.
- `chezmoi forget` of an unmanaged path → tolerated (treated as success).
- Exclude endpoint failures → HTTP 500 with message; UI Hud + stays listed.
- Busy push → banner hint, no error state.

## Testing

- core: encHashes round-trip + merge; capture skips `chezmoi add` when hashes
  match (fake exec call assertions), re-adds on change/new file; large gate
  blocks new >10MB with reason "large", allows `dotfiles-large-ok`, forgets
  `dotfiles-exclude`; never touches local files (assert no fs deletion).
- server: busy lock (second concurrent push → `hint:"busy"`); backup/status
  largeItems shape; exclude endpoint (forget called, selection updated,
  commit happens).
- web: blocked-"large" actions wire the two endpoints; advisory banner
  renders/expands/acts; busy hint copy. i18n en+zh.
- Final (by the assistant): full suites + live churn test on the real repo —
  two back-to-back captures must produce no new encrypted blobs the second
  time; then D.

## File-touch map

**Modified:** `packages/shared/src/types.ts` (BlockReason + "large"),
`packages/core/src/sync-baseline.ts` (+encHashes helpers),
`packages/core/src/modules/dotfiles.ts` (skip-unchanged + large gate),
`packages/cli/src/server.ts` (push lock, largeItems, exclude endpoint),
`packages/web/src/api.ts`, `packages/web/src/views/Overview.tsx`,
`packages/web/src/components/FreshnessBanners.tsx` (or a sibling
`LargeFilesAdvisory.tsx`), `packages/web/src/i18n/strings.ts`.
**Out of scope:** configurable threshold UI; non-dotfiles modules (packages/
appconfig emit small text files); history rewriting as a product feature.
