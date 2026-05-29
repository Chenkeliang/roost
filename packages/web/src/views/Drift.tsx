import { useState, useEffect } from "react";
import { GitDiff } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState";
import { StatusDot } from "../components/StatusDot";
import { Skeleton } from "../components/Skeleton";
import { getStatus, type StatusReport } from "../api";

export function Drift() {
  const [reports, setReports] = useState<StatusReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const drifted = reports.filter(
    (r) => r.status === "drift" || r.status === "conflict"
  );

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
        <span
          style={{
            marginLeft: 8,
            fontSize: 10,
            background: "var(--raise)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "1px 5px",
            color: "var(--muted)",
            fontWeight: 400,
          }}
        >
          Full diff view: Phase P4
        </span>
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
            <div key={i} style={{ display: "flex", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border-soft)", alignItems: "center" }}>
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
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border-soft)",
              fontSize: 11,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            <span>Module</span>
            <span>Status</span>
          </div>
          {drifted.map((r) => (
            <div
              key={r.module}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                padding: "10px 14px",
                borderBottom: "1px solid var(--border-soft)",
                alignItems: "center",
                fontSize: 13,
              }}
            >
              <span style={{ fontFamily: "var(--mono)" }}>{r.module}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <StatusDot status={r.status} />
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{r.status}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      <div
        style={{
          marginTop: 20,
          padding: "12px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--rc)",
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        Side-by-side Monaco diff viewer is planned for Phase P4.
      </div>
    </div>
  );
}
