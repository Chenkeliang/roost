import { useState, useEffect } from "react";
import { GitDiff, CaretDown, CaretRight } from "@phosphor-icons/react";
import type { DriftReport } from "@roost/shared";
import { EmptyState } from "../components/EmptyState";
import { StatusDot } from "../components/StatusDot";
import { Skeleton } from "../components/Skeleton";
import { getStatus, getDiff, type DiffEntry } from "../api";

// Derive a display status from a report's items
function deriveStatus(report: DriftReport): "synced" | "drift" | "conflict" {
  const items = report.items ?? [];
  if (items.some((i) => i.state === "conflict")) return "conflict";
  if (items.some((i) => i.state === "drift")) return "drift";
  return "synced";
}

// ── DiffPane — renders unified diff with +/- line coloring ─────────────────

function DiffLine({ line }: { line: string }) {
  let color = "var(--muted)";
  let bg = "transparent";
  if (line.startsWith("+") && !line.startsWith("+++")) {
    color = "var(--green)";
    bg = "rgba(52,211,153,.07)";
  } else if (line.startsWith("-") && !line.startsWith("---")) {
    color = "var(--red)";
    bg = "rgba(242,85,90,.07)";
  } else if (line.startsWith("@@")) {
    color = "var(--blue)";
  }
  return (
    <div
      style={{
        color,
        background: bg,
        paddingLeft: 8,
        paddingRight: 8,
        whiteSpace: "pre",
        minHeight: "1.4em",
        fontFamily: "var(--mono)",
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      {line || " "}
    </div>
  );
}

interface DiffPaneProps {
  moduleName: string;
  diffs: DiffEntry[] | null;
  loading: boolean;
}

function DiffPane({ moduleName, diffs, loading }: DiffPaneProps) {
  if (loading) {
    return (
      <div style={{ padding: "10px 14px" }}>
        <Skeleton width={320} height={14} />
      </div>
    );
  }

  const entry = diffs?.find((d) => d.module === moduleName);
  const text = entry?.text ?? "";

  if (!text.trim()) {
    return (
      <div
        style={{
          padding: "10px 14px",
          color: "var(--muted)",
          fontSize: 12,
          fontStyle: "italic",
        }}
      >
        No diff text available for this module.
      </div>
    );
  }

  const lines = text.split("\n");
  return (
    <div
      style={{
        background: "var(--surface-2)",
        borderTop: "1px solid var(--border-soft)",
        overflowX: "auto",
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 0",
          fontFamily: "var(--mono)",
          fontSize: 12,
        }}
      >
        {lines.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </pre>
    </div>
  );
}

// ── DriftedModuleRow ──────────────────────────────────────────────────────────

interface DriftedModuleRowProps {
  report: DriftReport;
  diffs: DiffEntry[] | null;
  diffsLoading: boolean;
  onRequestDiff: () => void;
}

function DriftedModuleRow({
  report,
  diffs,
  diffsLoading,
  onRequestDiff,
}: DriftedModuleRowProps) {
  const [showDiff, setShowDiff] = useState(false);
  const derivedStatus = deriveStatus(report);

  const handleToggleDiff = () => {
    if (!showDiff && diffs === null) {
      onRequestDiff();
    }
    setShowDiff((v) => !v);
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          fontSize: 13,
        }}
      >
        <span
          style={{ fontFamily: "var(--mono)", flex: 1 }}
        >
          {report.module}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 90 }}>
          <StatusDot status={derivedStatus} />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>{derivedStatus}</span>
        </span>
        <button
          onClick={handleToggleDiff}
          style={{
            appearance: "none",
            border: "1px solid var(--border)",
            background: showDiff ? "var(--raise)" : "transparent",
            color: showDiff ? "var(--text)" : "var(--muted)",
            fontFamily: "var(--font)",
            fontSize: 11,
            padding: "3px 9px",
            borderRadius: 6,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            transition: "background .12s, color .12s",
          }}
        >
          {showDiff ? <CaretDown size={11} /> : <CaretRight size={11} />}
          View diff
        </button>
      </div>
      {showDiff && (
        <DiffPane
          moduleName={report.module}
          diffs={diffs}
          loading={diffsLoading}
        />
      )}
    </div>
  );
}

// ── Drift ─────────────────────────────────────────────────────────────────────

export function Drift() {
  const [reports, setReports] = useState<DriftReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [diffs, setDiffs] = useState<DiffEntry[] | null>(null);
  const [diffsLoading, setDiffsLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getStatus()
      .then((data) => {
        setReports(data.reports);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const fetchDiffs = () => {
    if (diffs !== null || diffsLoading) return;
    setDiffsLoading(true);
    getDiff()
      .then((data) => setDiffs(data.diffs))
      .catch(() => setDiffs([]))
      .finally(() => setDiffsLoading(false));
  };

  const drifted = reports.filter((r) => {
    const s = deriveStatus(r);
    return s === "drift" || s === "conflict";
  });

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 600,
          marginBottom: 14,
        }}
      >
        Drift Overview
      </div>

      {loading ? (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--rc)",
            overflow: "hidden",
          }}
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 14px",
                borderBottom: "1px solid var(--border-soft)",
                alignItems: "center",
              }}
            >
              <Skeleton width={80} height={14} />
              <Skeleton width={120} height={14} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: "rgba(242,85,90,.1)",
            border: "1px solid var(--red)",
            borderRadius: "var(--rr)",
            color: "var(--red)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : drifted.length === 0 ? (
        <EmptyState
          icon={<GitDiff size={24} weight="duotone" />}
          title="No drift detected"
          subtitle="All modules are in sync between machines"
        />
      ) : (
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--rc)",
            overflow: "hidden",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.035)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              padding: "9px 14px",
              borderBottom: "1px solid var(--border-soft)",
              fontSize: 11,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            <span style={{ flex: 1 }}>Module</span>
            <span style={{ minWidth: 90 }}>Status</span>
            <span style={{ minWidth: 80 }} />
          </div>
          {drifted.map((r) => (
            <DriftedModuleRow
              key={r.module}
              report={r}
              diffs={diffs}
              diffsLoading={diffsLoading}
              onRequestDiff={fetchDiffs}
            />
          ))}
        </section>
      )}
    </div>
  );
}
