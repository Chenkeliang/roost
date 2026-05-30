import { useState, useEffect, useCallback } from "react";
import { FloppyDisk, DownloadSimple, FileCode, Package, SlidersHorizontal, GitBranch, Scan, Lock, Desktop } from "@phosphor-icons/react";
import { MachineCard } from "../components/MachineCard";
import { StatusDot } from "../components/StatusDot";
import { Tile } from "../components/Tile";
import { Skeleton } from "../components/Skeleton";
import type { HudMessage } from "../components/Hud";
import type { DriftReport } from "@roost/shared";
import {
  getHealth,
  getMachines,
  getStatus,
  postCapture,
  postLoad,
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
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [machines, setMachines] = useState<MachinesResponse | null>(null);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      showHud({ text: `Captured ${result.changes.length} item${result.changes.length === 1 ? "" : "s"}`, type: "success" });
      void fetchData();
    } catch (e) {
      showHud({ text: e instanceof Error ? e.message : "Capture failed", type: "error" });
    } finally {
      setCapturing(false);
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
              No other machine yet — run <span className="mono">roost load</span> on a second Mac to see it here.
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
          {capturing ? "Capturing…" : "Capture"}
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
          {loading ? "Loading…" : "Load (dry-run)"}
        </button>

        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>
          ↵ to capture · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>⌘K actions</span>
        </span>
      </div>

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
          Module Health
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
            No module status available. Is the Roost server running?
          </div>
        )}
      </section>
    </div>
  );
}
