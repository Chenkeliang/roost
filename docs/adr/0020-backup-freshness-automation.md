# ADR-0020: Backup freshness automation (auto-capture, push policy, update check)

- Status: Accepted
- Date: 2026-06-11
- Spec: `docs/superpowers/specs/2026-06-11-roost-freshness-design.md`

## Context

Roost's value depends on backups being fresh, but every capture/push was manual —
a recipe for stale backups. Separately, users had no way to learn about new app
releases (which this week included critical fixes). Adding automation touches
two governed areas: the `roost/settings.yaml` data schema (§6) and the project's
automation/privacy posture (no telemetry, no silent outward writes — §9, I7).

## Decision

1. **Auto-capture, scheduled in the sidecar, while the app runs.** Default
   `daily` (first run 60s after boot, then every 24h), configurable
   `off | daily | weekly`. Capture is the machine→repo direction: local,
   reversible, secret-scanner-gated — safe to automate. No launchd/resident
   agent in v1; the "stale backup" banner covers the app-not-open gap.
2. **Push stays explicit by default.** Auto-backup commits locally; unpushed
   work surfaces as an Overview banner with a push action. `autoPush: true` is
   an explicit opt-in setting; its failures surface via the same banner with
   classified hints. Rationale: no silent network writes (§9) unless the user
   has opted in.
3. **Update check is the app's only outbound request.** On launch (and on a
   manual button), fetch GitHub's latest-release metadata and compare versions
   client-side. No payload, no identifiers beyond the HTTP request itself, no
   other endpoints. Disableable via `checkUpdates: false`. This preserves an
   auditable "no telemetry" stance: one documented, user-controllable call to
   github.com. CSP gains `https://api.github.com` in `connect-src`.
4. **Schema change** to `RoostSettings` (repo-wide, follows the user's repo
   across machines):
   `autoBackup: "off" | "daily" | "weekly" = "daily"`,
   `autoPush: boolean = false`, `checkUpdates: boolean = true`.
   Loader validates per-field and falls back to defaults (forward/backward
   compatible: older builds ignore unknown keys; missing keys get defaults).

## Consequences

- Backups stay fresh without user discipline; the riskier outward step (push)
  remains consent-based by default.
- One new server endpoint (`GET /api/backup/status`) exposes scheduler state to
  the UI; the scheduler reconfigures live on settings changes.
- The privacy promise narrows from "no outbound calls" to "exactly one,
  documented, disableable outbound call to GitHub for update metadata" — recorded
  here so future additions must clear the same bar.
- If the app-not-open gap proves real for users, a follow-up ADR may introduce a
  launchd agent; that is explicitly out of scope here.
