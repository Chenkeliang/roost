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
  postLoad,
  addSelection,
  type HealthResponse,
  type MachinesResponse,
  type StatusResponse,
} from "../api";

interface OverviewProps {
  showHud: (msg: HudMessage) => void;
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
        fontSize: 12,
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

export function Overview({ showHud }: OverviewProps) {
  const { t } = useT();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [machines, setMachines] = useState<MachinesResponse | null>(null);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);

  const fetchData = useCallback(async () => {
    setLoadingData(true);
    setError(null);
    try {
      const [h, m, s] = await Promise.allSettled([
        getHealth(),
        getMachines(),
        getStatus(),
      ]);
      if (h.status === "fulfilled") setHealth(h.value);
      if (m.status === "fulfilled") setMachines(m.value);
      if (s.status === "fulfilled") setStatusData(s.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const result = await postCapture();
      const blockedPaths = result.changes.flatMap((c) => c.blocked ?? []);
      setBlocked(blockedPaths);
      const written = result.changes.reduce((n, c) => n + c.written.length + c.encrypted.length, 0);
      showHud({
        text: blockedPaths.length > 0
          ? `Captured ${written} · ${blockedPaths.length} blocked (potential secrets)`
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

  const handleLoad = async () => {
    setLoading(true);
    try {
      const result = await postLoad(false);
      showHud({ text: `Load preview: ${result.results.length} result${result.results.length === 1 ? "" : "s"}`, type: "success" });
    } catch (e) {
      showHud({ text: e instanceof Error ? e.message : "Load failed", type: "error" });
    } finally {
      setLoading(false);
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

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
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
            fontSize: 13,
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
              fontSize: 13,
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
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
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
            fontSize: 13,
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
          onClick={() => void handleLoad()}
          disabled={loading}
          style={{
            appearance: "none",
            fontFamily: "var(--font)",
            fontSize: 13,
            fontWeight: 540,
            cursor: loading ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 13px",
            borderRadius: "var(--rr)",
            background: "var(--raise)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            opacity: loading ? 0.7 : 1,
            transition: "transform .08s, background .12s",
          }}
          onMouseDown={(e) =>
            (e.currentTarget.style.transform = "scale(.975)")
          }
          onMouseUp={(e) => (e.currentTarget.style.transform = "none")}
        >
          <DownloadSimple size={16} weight={loading ? "duotone" : "regular"} />
          {loading ? t("overview.loading") : t("overview.load")}
        </button>

        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>
          ↵ to capture · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>⌘K actions</span>
        </span>
      </div>

      {/* Blocked-on-capture panel (ADR-0010): secret-bearing items skipped. */}
      {blocked.length > 0 && (
        <section style={{ border: "1px solid var(--amber)", borderRadius: "var(--rc)", padding: "13px 14px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Lock size={14} style={{ color: "var(--amber)" }} />
            <span style={{ fontSize: 13, fontWeight: 540, color: "var(--text)" }}>
              {blocked.length} {t("overview.blockedTitle")}
            </span>
            <button
              onClick={() => void handleEncryptRetry(blocked)}
              disabled={retrying}
              style={{ marginLeft: "auto", appearance: "none", border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12, padding: "5px 11px", borderRadius: "var(--rr)", cursor: retrying ? "default" : "pointer" }}
            >
              <Lock size={12} weight="fill" style={{ marginRight: 5, verticalAlign: "-1px" }} />
              {retrying ? t("overview.encrypting") : t("overview.encryptRetryAll")}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{t("overview.blockedHint")}</div>
          {blocked.map((p) => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border-soft)", fontSize: 12.5 }}>
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>{p}</span>
              <button
                onClick={() => void handleEncryptRetry([p])}
                disabled={retrying}
                style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 11, padding: "4px 9px", borderRadius: 6, cursor: retrying ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Lock size={11} />{t("overview.encryptRetry")}
              </button>
            </div>
          ))}
        </section>
      )}

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
            fontSize: 11,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--muted)",
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {t("overview.moduleHealth")}
        </div>
        {loadingData ? (
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
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {t("overview.noStatus")}
          </div>
        )}
      </section>
    </div>
  );
}
