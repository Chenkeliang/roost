import { useState } from "react";
import { ArrowSquareOut, DownloadSimple, UploadSimple, ClockCounterClockwise, X } from "@phosphor-icons/react";
import { gitPush, gitPull } from "../api";
import type { GitStatus } from "../api";
import type { HudMessage } from "./Hud";
import { openExternal } from "../openExternal";
import type { UpdateInfo } from "../updateCheck";

export const STALE_DAYS = 7;

const banner: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface)", border: "1px solid #4a3a1e", borderRadius: "var(--rc)", marginBottom: 14, fontSize: 13.5, flexWrap: "wrap" };
const cta: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", flexShrink: 0, fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e" };
const dot = (color: string): React.CSSProperties => ({ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 });

export function FreshnessBanners({ t, locale, gitStatus, lastCaptureAt, update, onDismissUpdate, onRefresh, showHud }: {
  t: (k: string) => string;
  locale: string;
  gitStatus: GitStatus | null;
  lastCaptureAt: string | null;
  update: UpdateInfo | null;
  onDismissUpdate: () => void;
  onRefresh: () => void;
  showHud?: (m: HudMessage) => void;
}) {
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [pushErrKey, setPushErrKey] = useState<string | null>(null);
  const [pullFailed, setPullFailed] = useState(false);

  // Onboarding owns the no-repo state; while git status is unknown, stay quiet.
  if (!gitStatus || !gitStatus.isRepo) return null;

  const pull = async () => {
    setBusy("pull"); setPullFailed(false);
    try {
      const r = await gitPull();
      if (r.ok) { showHud?.({ text: t("fresh.behind.pulled"), type: "success" }); onRefresh(); }
      else setPullFailed(true);
    } catch { setPullFailed(true); }
    finally { setBusy(null); }
  };

  const push = async () => {
    setBusy("push"); setPushErrKey(null);
    try {
      const r = await gitPush();
      if (r.ok) { showHud?.({ text: t("fresh.ahead.pushed"), type: "success" }); onRefresh(); }
      else {
        const hint = r.hint;
        setPushErrKey(hint === "auth" ? "fresh.ahead.authHint" : hint === "pull-first" ? "fresh.ahead.pullFirstHint" : "fresh.ahead.pushFailed");
      }
    } catch { setPushErrKey("fresh.ahead.pushFailed"); }
    finally { setBusy(null); }
  };

  const staleDays = lastCaptureAt === null
    ? Infinity
    : Math.floor((Date.now() - new Date(lastCaptureAt).getTime()) / (24 * 60 * 60 * 1000));
  void locale; // reserved for future relative-time formatting

  return (
    <>
      {update && (
        <div style={banner} role="status">
          <ArrowSquareOut size={15} style={{ color: "var(--amber)", flexShrink: 0 }} />
          <span>{t("fresh.update.title")} <span className="mono">{update.version}</span></span>
          <span style={{ flex: 1 }} />
          <button onClick={() => void openExternal(update.url)} style={cta}>{t("fresh.update.download")}</button>
          <button onClick={onDismissUpdate} aria-label={t("fresh.update.dismiss")} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2 }} title={t("fresh.update.dismiss")}>
            <X size={14} />
          </button>
        </div>
      )}

      {gitStatus.behind > 0 && (
        <div style={banner} role="status">
          <span style={dot("var(--amber)")} />
          <span>{t("fresh.behind.title")} {gitStatus.behind} {t("fresh.behind.commits")}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => void pull()} disabled={busy !== null} style={{ ...cta, opacity: busy ? 0.7 : 1, cursor: busy ? "default" : "pointer" }}><DownloadSimple size={13} />{busy === "pull" ? t("fresh.behind.pulling") : t("fresh.behind.pull")}</button>
          {pullFailed && <span style={{ color: "var(--red)", fontSize: 12.5, width: "100%" }}>{t("fresh.behind.pullFailed")}</span>}
        </div>
      )}

      {gitStatus.ahead > 0 && gitStatus.remote !== null && (
        <div style={banner} role="status">
          <span style={dot("var(--amber)")} />
          <span>{t("fresh.ahead.title")} {gitStatus.ahead} {t("fresh.ahead.commits")}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => void push()} disabled={busy !== null} style={{ ...cta, opacity: busy ? 0.7 : 1, cursor: busy ? "default" : "pointer" }}><UploadSimple size={13} />{busy === "push" ? t("fresh.ahead.pushing") : t("fresh.ahead.push")}</button>
          {pushErrKey && <span style={{ color: "var(--red)", fontSize: 12.5, width: "100%" }}>{t(pushErrKey)}</span>}
        </div>
      )}

      {staleDays >= STALE_DAYS && (
        <div style={banner} role="status">
          <ClockCounterClockwise size={15} style={{ color: "var(--amber)", flexShrink: 0 }} />
          <span>
            {lastCaptureAt === null
              ? t("fresh.stale.never")
              : `${t("fresh.stale.title")} ${staleDays} ${t("fresh.stale.daysAgo")}`}
          </span>
        </div>
      )}
    </>
  );
}
