import { useState, useEffect } from "react";
import { ClockCounterClockwise, GitCommit } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getTimeline, type TimelineEntry } from "../api";

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return iso;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  // Fall back to ISO date portion
  return iso.slice(0, 10);
}

function SnapshotRow({ entry }: { entry: TimelineEntry }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-soft)",
        fontSize: 14,
      }}
    >
      <span
        style={{
          color: "var(--muted)",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <GitCommit size={14} />
      </span>
      <span
        className="mono"
        style={{
          color: "var(--accent)",
          fontSize: 12.5,
          flexShrink: 0,
          minWidth: 64,
          letterSpacing: ".02em",
        }}
      >
        {entry.sha.slice(0, 8)}
      </span>
      <span
        style={{
          flex: 1,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {entry.subject}
      </span>
      <span
        style={{
          color: "var(--muted)",
          fontSize: 13,
          flexShrink: 0,
          minWidth: 70,
          textAlign: "right",
        }}
      >
        {relativeDate(entry.date)}
      </span>
    </div>
  );
}

export function Timeline() {
  const { t } = useT();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getTimeline()
      .then((data) => {
        setEntries(data.entries);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div
        style={{
          fontSize: 12.5,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 600,
          marginBottom: 14,
        }}
      >
        {t("timeline.heading")}
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
          {[1, 2, 3, 4, 5].map((i) => (
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
              <Skeleton width={64} height={13} />
              <Skeleton width={220} height={13} />
              <Skeleton width={48} height={13} />
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
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<ClockCounterClockwise size={24} weight="duotone" />}
          title={t("timeline.emptyTitle")}
          subtitle={t("timeline.emptySubtitle")}
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
              gap: 12,
              padding: "9px 14px",
              borderBottom: "1px solid var(--border-soft)",
              fontSize: 12.5,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            <span style={{ minWidth: 64 }}>SHA</span>
            <span style={{ flex: 1 }}>Subject</span>
            <span style={{ minWidth: 70, textAlign: "right" }}>When</span>
          </div>
          {entries.map((entry) => (
            <SnapshotRow key={entry.sha} entry={entry} />
          ))}
        </section>
      )}
    </div>
  );
}
