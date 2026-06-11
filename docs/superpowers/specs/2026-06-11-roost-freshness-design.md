# Roost Backup Freshness — Design Spec

**Date:** 2026-06-11
**Status:** Approved (brainstorming) — ready for implementation plan
**Branch:** `feat_freshness` (based on `origin/main`)
**ADR:** `docs/adr/0020-backup-freshness-automation.md`

## Goal

Three features that keep backups fresh and users on fixed builds, unified by one
prompt-and-action interaction system: **auto-backup** (scheduled capture while the
app runs), **update check** (GitHub latest vs local version), and **repo-newer /
unpushed / stale banners** on the Overview. Decisions locked with the user:
app-runtime scheduling (no launchd in v1) · auto-capture with push-reminder
(auto-push opt-in, default off) · on-launch + every 24h (default "daily",
configurable off/daily/weekly) · update prompt = dismissible Overview banner +
a manual check button in Settings.

## 0. Unified banner system (the interaction backbone)

One banner area at the top of Overview, reusing the existing missing-deps banner
visual language (amber accent border `#4a3a1e`, dot, single sentence + one action
button). Banners render in priority order; each is one line + one clear action:

| Pri | Banner | Condition | Copy (zh sketch) | Action |
|---|---|---|---|---|
| 1 | missing deps (existing) | required env check failed | 缺少必需工具: … | 去环境检查 |
| 2 | update available | latest > local && not dismissed-for-this-version | 新版本 vX.Y.Z 可用 | 去下载 (opener → release page) · ✕ 关闭 |
| 3 | repo newer | `git/status.behind > 0` | 另一台机器推送了新备份(落后 N 个提交) | 拉取 (`gitPull`, ff-only) → success Hud |
| 4 | unpushed | `git/status.ahead > 0 && remote !== null` | 有 N 个本地备份还没推送到远端 | 推送 (`gitPush`) → failure shows classifyGitError hint |
| 5 | stale backup | last capture (any machine-state `capturedAt` for this host) older than 7 days, or never | 上次备份已是 N 天前 / 还没有过备份 | 立即备份 (existing capture flow) |

Implementation: a small shared `FreshnessBanners` component (props: gitStatus,
backupStatus, updateInfo, callbacks) rendered by Overview above the machine
cards. All copy via `t()` (`fresh.*` namespace, en+zh). Multiple banners may be
true simultaneously (rare); they stack in priority order — no caps, no modal,
no notification spam.

## 1. Auto-backup (scheduler in the sidecar)

**Where:** the engine (`runServe` in `packages/cli/src/server.ts`), not the web
page — alive as long as the app runs, independent of tabs/webview reloads.

**Behavior:**
- On server boot: if `settings.autoBackup !== "off"` and a usable repo exists
  (`git rev-parse --is-inside-work-tree` succeeds), schedule the first run after
  a **60s delay** (never competes with first-paint requests), then every 24h
  (`daily`) or 7d (`weekly`). Timers are `unref`'d where applicable and cleared
  on server close.
- A run = `loadSelection` → `captureAll` → `finalizeCapture` (the same path as
  `POST /api/capture`), with the secret-scanner gate intact. Empty selection or
  no-change runs are silent no-ops.
- If `settings.autoPush === true` and capture committed something: run the
  existing push logic (with the first-push upstream handling). Push failure
  never throws — it lands in the run result for the UI to surface.
- The scheduler stores its last run in memory: `{ at, captured, blocked,
  blockedDetail, pushed?, pushHint?, error? }`. Settings changes via
  `POST /api/settings` reconfigure the scheduler immediately (clear + reschedule).

**New endpoint:** `GET /api/backup/status` → `{ autoBackup, autoPush, lastRun:
{...} | null, lastCaptureAt: string | null }` where `lastCaptureAt` comes from
this host's `MachineState.capturedAt` (covers manual captures too). Overview
fetches it alongside its other fast calls.

**Surfacing (honest, quiet):**
- Overview machine card area shows "上次备份: x 前 · 自动/手动" (relative time).
- Auto-run blocked items reuse the existing blocked-reasons UI (from
  `lastRun.blockedDetail`) — never silently swallowed.
- Auto-run error → one-line retryable error row (existing error style).

## 2. Settings additions

`RoostSettings` (in `roost/settings.yaml`, repo-wide — policy follows your repo
across machines):

```ts
export interface RoostSettings {
  maxCaptureMB: number;            // existing
  autoBackup: "off" | "daily" | "weekly"; // default "daily"
  autoPush: boolean;               // default false — never silent network writes
  checkUpdates: boolean;           // default true — the app's ONLY outbound call
}
```

`loadRoostSettings` gains per-field validation with defaults (same defensive
style as `maxCaptureMB`). `GET/POST /api/settings` passes the new fields through.
Settings UI adds an "自动备份" section: frequency select (关闭/每天/每周),
"自动推送" toggle with helper text (默认关;开启后备份完成直接推送,失败会在总览
提醒), "检查更新" toggle + a "立即检查" button showing the result inline
(已是最新 / 新版 vX.Y.Z 可用 → 去下载 / 检查失败).

## 3. Update check (web-side)

- On app mount (once per session, and only when `checkUpdates`): fetch
  `https://api.github.com/repos/Chenkeliang/roost/releases/latest`, compare
  `tag_name` against the app version from `@tauri-apps/api/app` `getVersion()`
  (browser mode: skip silently — no Tauri, no version).
- Pure helper `isNewerVersion(latest: string, current: string): boolean`
  (semver-ish numeric compare of `x.y.z`, tolerant of a leading `v`).
- Newer → priority-2 banner. Dismiss (✕) writes `localStorage
  roost.dismissedUpdate = "vX.Y.Z"`; the same version never re-prompts; a newer
  one does. "去下载" opens the release page via the existing opener pattern
  (`@tauri-apps/plugin-opener`).
- Check failures are silent on launch (console only); the Settings manual button
  surfaces errors inline.
- **CSP:** add `https://api.github.com` to `connect-src` in `tauri.conf.json`.
- **Privacy:** this is the app's only outbound request (GitHub only, no payload
  beyond the HTTP request itself, no telemetry); it is user-disableable. Recorded
  in ADR-0020 to keep the "no telemetry" promise auditable.

## 4. Error handling

- Auto-capture failure → `lastRun.error`, retry via the normal Capture button.
- Auto-push / manual banner-push failure → `classifyGitError` hint (auth → "在终端
  跑一次 git push 完成认证"; pull-first → 指向拉取横幅).
- Pull non-ff → message directing to Sync Review.
- Update-check failure → silent at launch; inline error on manual check.
- No repo (`isRepo:false`) → scheduler stays idle; no banners except onboarding.

## 5. Testing

- **core:** settings defaults/validation round-trip for the three new fields.
- **server:** scheduler with injectable timer/trigger — runs capture, records
  lastRun, respects "off", reschedules on settings POST, autoPush on/off paths,
  blocked items recorded; `GET /api/backup/status` shape.
- **web:** `isNewerVersion` table test; `FreshnessBanners` per-banner
  show/hide conditions (behind/ahead/stale/update/dismissed); dismiss
  persistence; Settings section interactions (select/toggles/manual check with
  mocked fetch); Overview integration (banners render with mocked statuses).
- Full suites + lint + sidecar build; real-machine smoke (banners against the
  live repo state).

## File-touch map

**New:** `packages/cli/src/autoBackup.ts` (scheduler; pure logic + injected deps),
`packages/web/src/components/FreshnessBanners.tsx`,
`packages/web/src/updateCheck.ts` (fetch + isNewerVersion),
tests for each.
**Modified:** `packages/core/src/settings.ts` (+fields), `packages/cli/src/server.ts`
(scheduler wiring, `/api/backup/status`, settings passthrough),
`packages/web/src/api.ts` (BackupStatus type + wrapper, settings type),
`packages/web/src/views/Overview.tsx` (banners + last-backup line),
`packages/web/src/views/Settings.tsx` (自动备份 section),
`packages/web/src-tauri/tauri.conf.json` (CSP),
`packages/web/src/i18n/strings.ts` (`fresh.*` en+zh).

## Out of scope (v1)

- launchd / menu-bar resident agent (revisit if "app not open" gap proves real).
- macOS native notifications.
- Tauri auto-updater (download-and-install); the banner links to the release page.
