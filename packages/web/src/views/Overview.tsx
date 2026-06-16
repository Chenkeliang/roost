import { useState, useEffect, useCallback } from "react";
import { FloppyDisk, DownloadSimple, FileCode, Package, SlidersHorizontal, GitBranch, Scan, Lock, Desktop } from "@phosphor-icons/react";
import { MachineCard } from "../components/MachineCard";
import { StatusDot } from "../components/StatusDot";
import { Tile } from "../components/Tile";
import { Skeleton } from "../components/Skeleton";
import type { HudMessage } from "../components/Hud";
import type { DriftReport } from "@roost/shared";
import { useT } from "../i18n";
import {
  getHealth,
  getMachines,
  getStatus,
  postCapture,
  getEnvironment,
  getGitStatus,
  getBackupStatus,
  getSettings,
  addSelection,
  removeSelection,
  excludeDotfile,
  type HealthResponse,
  type MachinesResponse,
  type StatusResponse,
  type BlockedItem,
  type GitStatus,
  type BackupStatus,
} from "../api";
import { FreshnessBanners } from "../components/FreshnessBanners";
import { LargeFilesAdvisory } from "../components/LargeFilesAdvisory";
import { checkForUpdate } from "../updateCheck";
import type { UpdateInfo } from "../updateCheck";
import { Onboarding } from "./onboarding/Onboarding";
import { RemoteWarningBanner } from "../components/RemoteWarningBanner";

interface OverviewProps {
  showHud: (msg: HudMessage) => void;
  onOpenSync?: () => void;
  onOpenSetup?: () => void;
}

interface ModuleHealthProps {
  report: DriftReport;
}

// Derive a single status string from a DriftReport's items
function deriveModuleStatus(report: DriftReport): "synced" | "drift" | "conflict" {
  const items = report.items ?? [];
  if (items.some((i) => i.state === "conflict")) return "conflict";
  if (items.some((i) => i.state === "drift")) return "drift";
  return "synced";
}

function moduleIcon(name: string) {
  switch (name) {
    case "dotfiles": return <FileCode size={14} />;
    case "packages": return <Package size={14} />;
    case "appconfig": return <SlidersHorizontal size={14} />;
    case "projects": return <GitBranch size={14} />;
    case "secrets": return <Lock size={14} />;
    default: return <Scan size={14} />;
  }
}

function moduleTileColor(name: string): "slate" | "amber" | "blue" | "violet" | "coral" {
  switch (name) {
    case "dotfiles": return "slate";
    case "packages": return "amber";
    case "appconfig": return "blue";
    case "projects": return "violet";
    case "secrets": return "coral";
    default: return "slate";
  }
}

function ModuleHealthChip({ report }: ModuleHealthProps) {
  const derivedStatus = deriveModuleStatus(report);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        background: "var(--surface)",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--rr)",
        fontSize: 13,
      }}
    >
      <Tile color={moduleTileColor(report.module)} size={20}>
        {moduleIcon(report.module)}
      </Tile>
      <span style={{ color: "var(--muted)" }}>{report.module}</span>
      <StatusDot status={derivedStatus} />
    </div>
  );
}

// "3 days ago / 2 小时前" — pick the largest sensible unit so an old backup never
// renders as "192 hours ago".
function formatAgo(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale === "zh" ? "zh" : "en", { numeric: "auto" });
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 48) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

export function Overview({ showHud, onOpenSync, onOpenSetup }: OverviewProps) {
  const { t, locale } = useT();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [machines, setMachines] = useState<MachinesResponse | null>(null);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [missingDeps, setMissingDeps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockedDetail, setBlockedDetail] = useState<(BlockedItem & { module: string })[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  const fetchData = useCallback(async () => {
    setLoadingData(true);
    setStatusLoading(true);
    setError(null);
    // /api/status is the slow call (statusAll shells out per module) — let it
    // land independently so it never holds the machine cards hostage. The
    // module-health section keeps its own skeleton via statusLoading.
    void getStatus()
      .then(setStatusData)
      .catch(() => {})
      .finally(() => setStatusLoading(false));
    void getEnvironment()
      .then((env) => setMissingDeps(env.checks.filter((c) => c.required && !c.ok).map((c) => c.id)))
      .catch(() => {});
    const [h, m, git, backup] = await Promise.allSettled([getHealth(), getMachines(), getGitStatus(), getBackupStatus()]);
    if (h.status === "fulfilled") setHealth(h.value);
    if (m.status === "fulfilled") setMachines(m.value);
    if (git.status === "fulfilled") setGitStatus(git.value);
    if (backup.status === "fulfilled") setBackupStatus(backup.value);
    setLoadingData(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    // Once per app session; browser/dev mode has no Tauri version — skip silently.
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSettings().catch(() => null);
        if (s && !s.checkUpdates) return;
        const { getVersion } = await import("@tauri-apps/api/app");
        const current = await getVersion();
        const info = await checkForUpdate(current);
        if (!cancelled && info && localStorage.getItem("roost.dismissedUpdate") !== info.version) setUpdate(info);
      } catch { /* not running under Tauri */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const result = await postCapture();
      const blockedPaths = result.changes.flatMap((c) => c.blocked ?? []);
      const details = result.changes.flatMap((c) =>
        (c.blockedDetail ?? []).map((b) => ({ ...b, module: c.module })),
      );
      setBlocked(blockedPaths);
      setBlockedDetail(details);
      const written = result.changes.reduce((n, c) => n + c.written.length + c.encrypted.length, 0);
      const hasSecret = details.some((b) => b.reason === "secret");
      showHud({
        text: blockedPaths.length > 0
          ? (hasSecret
              ? `Captured ${written} · ${blockedPaths.length} blocked (potential secrets)`
              : `Captured ${written} · ${blockedPaths.length} need attention`)
          : `Captured ${written} item${written === 1 ? "" : "s"}`,
        type: blockedPaths.length > 0 ? "error" : "success",
      });
      void fetchData();
    } catch (e) {
      showHud({ text: e instanceof Error ? e.message : "Capture failed", type: "error" });
    } finally {
      setCapturing(false);
    }
  };

  // Mark the blocked secret-bearing paths to encrypt, then re-capture so they
  // go in as encrypted_*.age instead of being skipped (ADR-0010).
  const handleEncryptRetry = async (paths: string[]) => {
    setRetrying(true);
    try {
      for (const p of paths) await addSelection("dotfiles-encrypt", p);
      const result = await postCapture();
      const stillBlocked = result.changes.flatMap((c) => c.blocked ?? []);
      setBlocked(stillBlocked);
      setBlockedDetail(result.changes.flatMap((c) =>
        (c.blockedDetail ?? []).map((b) => ({ ...b, module: c.module })),
      ));
      const enc = result.changes.reduce((n, c) => n + c.encrypted.length, 0);
      showHud({
        text: stillBlocked.length > 0
          ? `Encrypted & retried · ${stillBlocked.length} still blocked`
          : `Encrypted & captured (${enc} encrypted)`,
        type: stillBlocked.length > 0 ? "error" : "success",
      });
      void fetchData();
    } catch (e) {
      showHud({ text: e instanceof Error ? e.message : "Encrypt retry failed", type: "error" });
    } finally {
      setRetrying(false);
    }
  };

  // A too-large item can't be encrypted away — the fix is to stop tracking it
  // (or raise the limit in Settings). Drop it from the dotfiles selection.
  const handleRemoveBlocked = async (id: string) => {
    try {
      await removeSelection("dotfiles", id);
      setBlockedDetail((prev) => prev.filter((b) => b.id !== id));
      setBlocked((prev) => prev.filter((p) => p !== id));
      await fetchData();
    } catch (e) {
      showHud({ text: e instanceof Error ? e.message : "Remove failed", type: "error" });
    }
  };

  const primaryHost = machines?.hosts[0];
  const followerHost = machines?.hosts[1];

  // Derive overall status from items
  const hasConflict = statusData?.reports.some((r) => deriveModuleStatus(r) === "conflict") ?? false;
  const hasDrift = statusData?.reports.some((r) => deriveModuleStatus(r) === "drift") ?? false;
  const driftedCount = statusData?.reports.filter((r) => {
    const s = deriveModuleStatus(r);
    return s === "drift" || s === "conflict";
  }).length;
  const trackedCount = statusData?.reports.reduce((n, r) => n + (r.items?.length ?? 0), 0);

  if (gitStatus && !gitStatus.isRepo) {
    return <Onboarding t={t} showHud={showHud} onComplete={() => void fetchData()} onOpenSync={onOpenSync} />;
  }

  const noRemote = !!gitStatus?.isRepo && gitStatus.remote === null;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      {noRemote && <RemoteWarningBanner t={t} onConfigured={() => void fetchData()} />}
      {missingDeps.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            background: "var(--surface)",
            border: "1px solid #4a3a1e",
            borderRadius: "var(--rc)",
            marginBottom: 14,
            fontSize: 13.5,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f0b352", flexShrink: 0 }} />
          <span>{t("overview.depsMissing")} {missingDeps.join(" · ")}</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => onOpenSetup?.()}
            style={{ fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e" }}
          >
            {t("overview.depsFix")}
          </button>
        </div>
      )}
      <FreshnessBanners
        t={t}
        locale={locale}
        gitStatus={gitStatus}
        lastCaptureAt={backupStatus?.lastCaptureAt ?? null}
        update={update}
        onDismissUpdate={() => { if (update) localStorage.setItem("roost.dismissedUpdate", update.version); setUpdate(null); }}
        onRefresh={() => void fetchData()}
        showHud={showHud}
      />
      <LargeFilesAdvisory t={t} items={backupStatus?.largeItems ?? []} onChanged={() => void fetchData()} />
      {backupStatus?.lastRun?.error && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: "rgba(242,85,90,.08)", border: "1px solid var(--red)", borderRadius: "var(--rr)", color: "var(--red)", fontSize: 13 }}>
          {t("fresh.autoError")} {backupStatus.lastRun.error}
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "rgba(242,85,90,.1)",
            border: "1px solid var(--red)",
            borderRadius: "var(--rr)",
            color: "var(--red)",
            fontSize: 14,
          }}
        >
          {error} —{" "}
          <button
            onClick={() => void fetchData()}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              fontFamily: "var(--font)",
              fontSize: 14,
              padding: 0,
            }}
          >
            retry
          </button>
        </div>
      )}

      {/* Machine Cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <MachineCard
          type="primary"
          name={health?.name ?? primaryHost ?? "this machine"}
          hostname={primaryHost ?? health?.name}
          tracked={trackedCount}
          drift={driftedCount}
          lastActionLabel="capture"
          lastAction={primaryHost ? "now" : undefined}
          status={hasConflict ? "conflict" : hasDrift ? "drift" : "synced"}
          loading={loadingData}
        />
        {followerHost ? (
          <MachineCard
            type="follower"
            name={followerHost}
            hostname={followerHost}
            tracked={trackedCount}
            drift={driftedCount}
            lastActionLabel="load"
            status="drift"
            loading={loadingData}
          />
        ) : (
          <article
            style={{
              background: "var(--surface)",
              border: "1px dashed var(--border)",
              borderRadius: "var(--rc)",
              padding: 16,
              display: "flex",
              alignItems: "center",
              gap: 11,
              color: "var(--muted)",
            }}
          >
            <Desktop size={18} style={{ flexShrink: 0 }} />
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              {t("overview.noOtherMachine")}
            </div>
          </article>
        )}
      </section>

      {/* Primary Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
        <button
          onClick={() => void handleCapture()}
          disabled={capturing}
          style={{
            appearance: "none",
            fontFamily: "var(--font)",
            fontSize: 14,
            fontWeight: 540,
            cursor: capturing ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 13px",
            borderRadius: "var(--rr)",
            background: "var(--accent)",
            color: "#1a0c0c",
            border: "none",
            opacity: capturing ? 0.7 : 1,
            transition: "transform .08s, opacity .12s",
          }}
          onMouseDown={(e) =>
            (e.currentTarget.style.transform = "scale(.975)")
          }
          onMouseUp={(e) => (e.currentTarget.style.transform = "none")}
        >
          <FloppyDisk size={16} weight={capturing ? "duotone" : "regular"} />
          {capturing ? t("overview.capturing") : t("overview.capture")}
        </button>

        <button
          onClick={() => onOpenSync?.()}
          style={{
            appearance: "none",
            fontFamily: "var(--font)",
            fontSize: 14,
            fontWeight: 540,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 13px",
            borderRadius: "var(--rr)",
            background: "var(--raise)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            transition: "transform .08s, background .12s",
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(.975)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "none")}
        >
          <DownloadSimple size={16} weight="regular" />
          {t("overview.review")}
        </button>

        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 13 }}>
          {backupStatus?.lastCaptureAt && (
            <>
              {t("fresh.lastBackup")} {formatAgo(backupStatus.lastCaptureAt, locale)}
              {backupStatus.lastRun && backupStatus.lastRun.captured > 0 && new Date(backupStatus.lastRun.at) >= new Date(backupStatus.lastCaptureAt) ? ` ${t("fresh.lastBackup.auto")}` : ""}
              {" · "}
            </>
          )}
          ↵ to capture · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>⌘K actions</span>
        </span>
      </div>

      {/* Blocked-on-capture panel: items skipped during capture, each with its
          reason. secret → encrypt-retry (ADR-0010); too-large → remove. */}
      {blockedDetail.length > 0 ? (
        <section style={{ border: "1px solid var(--amber)", borderRadius: "var(--rc)", padding: "13px 14px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Lock size={14} style={{ color: "var(--amber)" }} />
            <span style={{ fontSize: 14, fontWeight: 540, color: "var(--text)" }}>
              {blockedDetail.length}{" "}
              <span>
                {blockedDetail.some((b) => b.reason === "secret")
                  ? t("overview.blockedTitle")
                  : t("overview.blockedTitleNeutral")}
              </span>
            </span>
            {blockedDetail.some((b) => b.reason === "secret") && (
              <button
                onClick={() => void handleEncryptRetry(blockedDetail.filter((b) => b.reason === "secret").map((b) => b.id))}
                disabled={retrying}
                style={{ marginLeft: "auto", appearance: "none", border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 13, padding: "5px 11px", borderRadius: "var(--rr)", cursor: retrying ? "default" : "pointer" }}
              >
                <Lock size={12} weight="fill" style={{ marginRight: 5, verticalAlign: "-1px" }} />
                {retrying ? t("overview.encrypting") : t("overview.encryptRetryAll")}
              </button>
            )}
          </div>
          {blockedDetail.map((item) => {
            const reasonLabel =
              item.reason === "secret" ? t("overview.blocked.secret")
              : item.reason === "too-large" ? t("overview.blocked.tooLarge")
              : item.reason === "managed" ? t("overview.blocked.managed")
              : item.reason === "large" ? t("overview.blocked.large")
              : t("overview.blocked.error");
            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border-soft)", fontSize: 13.5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>{item.id}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {reasonLabel}{item.detail ? ` · ${item.detail}` : ""}
                    {item.reason === "too-large" ? ` · ${t("overview.blocked.raiseLimit")}` : ""}
                  </div>
                </div>
                {item.reason === "secret" && (
                  <button
                    onClick={() => void handleEncryptRetry([item.id])}
                    disabled={retrying}
                    style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 9px", borderRadius: 6, cursor: retrying ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Lock size={11} />{t("overview.encryptRetry")}
                  </button>
                )}
                {item.reason === "too-large" && (
                  <button
                    onClick={() => void handleRemoveBlocked(item.id)}
                    style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 9px", borderRadius: 6, cursor: "pointer" }}
                  >
                    {t("overview.blocked.remove")}
                  </button>
                )}
                {item.reason === "large" && (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button
                      onClick={() => {
                        void addSelection("dotfiles-large-ok", item.id).then(() => {
                          setBlockedDetail((d) => d.filter((b) => b.id !== item.id));
                          showHud?.({ text: t("overview.blocked.largeKept"), type: "success" });
                        });
                      }}
                      style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 9px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      {t("overview.blocked.keepLarge")}
                    </button>
                    <button
                      onClick={() => {
                        void excludeDotfile(item.id).then(() => {
                          setBlockedDetail((d) => d.filter((b) => b.id !== item.id));
                          showHud?.({ text: t("overview.blocked.largeExcluded"), type: "success" });
                        });
                      }}
                      style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 9px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      {t("overview.blocked.excludeLarge")}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </section>
      ) : blocked.length > 0 ? (
        <section style={{ border: "1px solid var(--amber)", borderRadius: "var(--rc)", padding: "13px 14px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Lock size={14} style={{ color: "var(--amber)" }} />
            <span style={{ fontSize: 14, fontWeight: 540, color: "var(--text)" }}>
              {blocked.length} {t("overview.blockedTitle")}
            </span>
            <button
              onClick={() => void handleEncryptRetry(blocked)}
              disabled={retrying}
              style={{ marginLeft: "auto", appearance: "none", border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 13, padding: "5px 11px", borderRadius: "var(--rr)", cursor: retrying ? "default" : "pointer" }}
            >
              <Lock size={12} weight="fill" style={{ marginRight: 5, verticalAlign: "-1px" }} />
              {retrying ? t("overview.encrypting") : t("overview.encryptRetryAll")}
            </button>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>{t("overview.blockedHint")}</div>
          {blocked.map((p) => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border-soft)", fontSize: 13.5 }}>
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>{p}</span>
              <button
                onClick={() => void handleEncryptRetry([p])}
                disabled={retrying}
                style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 9px", borderRadius: 6, cursor: retrying ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Lock size={11} />{t("overview.encryptRetry")}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {/* Module Health */}
      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--rc)",
          padding: "13px 14px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.035)",
        }}
      >
        <div
          style={{
            fontSize: 12.5,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--muted)",
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {t("overview.moduleHealth")}
        </div>
        {statusLoading ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} width={100} height={28} />
            ))}
          </div>
        ) : statusData?.reports.length ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {statusData.reports.map((r) => (
              <ModuleHealthChip key={r.module} report={r} />
            ))}
          </div>
        ) : (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            {t("overview.noStatus")}
          </div>
        )}
      </section>
    </div>
  );
}
