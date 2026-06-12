import { useState, useEffect } from "react";
import { ClockCounterClockwise, GitCommit, CaretDown, CaretUp } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getTimeline, getFileHistory, restoreFileVersion, type TimelineEntry, type FileHistoryEntry } from "../api";
import type { HudMessage } from "../components/Hud";

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
  return iso.slice(0, 10);
}

function SnapshotRow({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasBody = Boolean(entry.body);

  return (
    <div style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          padding: "10px 14px",
          fontSize: 14,
        }}
      >
        <span style={{ color: "var(--muted)", flexShrink: 0, marginTop: 2 }}>
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
        {hasBody && (
          <button
            aria-label={expanded ? "▴" : "▾"}
            onClick={() => setExpanded((v) => !v)}
            style={{
              appearance: "none",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted)",
              padding: "0 4px",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
          </button>
        )}
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
      {hasBody && expanded && (
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: "6px 14px 10px 42px",
            fontSize: 12,
            color: "var(--muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {entry.body}
        </pre>
      )}
    </div>
  );
}

interface HistoryRowProps {
  entry: FileHistoryEntry;
  isCurrent: boolean;
  onRestore: (sha: string) => void;
  restoring: boolean;
}

function HistoryRow({ entry, isCurrent, onRestore, restoring }: HistoryRowProps) {
  const { t } = useT();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-soft)",
        fontSize: 14,
      }}
    >
      <span style={{ color: "var(--muted)", flexShrink: 0 }}>
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
      <span style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {entry.subject}
      </span>
      <span style={{ color: "var(--muted)", fontSize: 13, flexShrink: 0, minWidth: 70, textAlign: "right" }}>
        {relativeDate(entry.date)}
      </span>
      {isCurrent ? (
        <span style={{ color: "var(--muted)", fontSize: 12, flexShrink: 0, opacity: 0.7 }}>
          {t("history.current")}
        </span>
      ) : (
        <button
          onClick={() => onRestore(entry.sha)}
          disabled={restoring}
          style={{
            appearance: "none",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "3px 10px",
            fontSize: 12,
            cursor: restoring ? "not-allowed" : "pointer",
            color: "var(--text)",
            flexShrink: 0,
            opacity: restoring ? 0.5 : 1,
          }}
        >
          {restoring ? t("history.restoring") : t("history.restore")}
        </button>
      )}
    </div>
  );
}

interface TimelineProps {
  showHud?: (m: HudMessage) => void;
  onOpenSync?: () => void;
}

export function Timeline({ showHud, onOpenSync }: TimelineProps) {
  const { t } = useT();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // File history mode
  const [pathInput, setPathInput] = useState("");
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<FileHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringShа, setRestoringShа] = useState<string | null>(null);
  const [restoredNotice, setRestoredNotice] = useState(false);

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

  const showFileHistory = () => {
    const p = pathInput.trim();
    if (!p) return;
    setHistoryPath(p);
    setRestoredNotice(false);
    setHistoryLoading(true);
    getFileHistory(p)
      .then((data) => setHistoryEntries(data.entries))
      .catch(() => setHistoryEntries([]))
      .finally(() => setHistoryLoading(false));
  };

  const handleRestore = (sha: string) => {
    if (!historyPath) return;
    setRestoringShа(sha);
    restoreFileVersion(historyPath, sha)
      .then(() => {
        setRestoredNotice(true);
        if (showHud) showHud({ text: t("history.restored"), type: "success" });
      })
      .catch(() => {})
      .finally(() => setRestoringShа(null));
  };

  const handleBack = () => {
    setHistoryPath(null);
    setHistoryEntries([]);
    setRestoredNotice(false);
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      {/* File history search row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <input
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") showFileHistory(); }}
          placeholder={t("history.searchPlaceholder")}
          style={{
            flex: 1,
            height: 32,
            padding: "0 10px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 13,
            color: "var(--text)",
            fontFamily: "var(--font)",
          }}
        />
        <button
          onClick={showFileHistory}
          style={{
            appearance: "none",
            background: "var(--accent)",
            border: "none",
            borderRadius: 6,
            padding: "0 14px",
            height: 32,
            fontSize: 13,
            color: "#fff",
            cursor: "pointer",
            fontFamily: "var(--font)",
            flexShrink: 0,
          }}
        >
          {t("history.show")}
        </button>
      </div>

      {historyPath ? (
        /* File history view */
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <button
              onClick={handleBack}
              style={{
                appearance: "none",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "3px 10px",
                fontSize: 12,
                cursor: "pointer",
                color: "var(--text)",
                fontFamily: "var(--font)",
              }}
            >
              {t("history.back")}
            </button>
            <span className="mono" style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {historyPath}
            </span>
          </div>

          {restoredNotice && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(var(--accent-rgb, 255,99,99),.1)",
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--rr)",
                fontSize: 13,
                color: "var(--text)",
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ flex: 1 }}>{t("history.restored")}</span>
              {onOpenSync && (
                <button
                  onClick={onOpenSync}
                  style={{
                    appearance: "none",
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: 6,
                    padding: "3px 10px",
                    fontSize: 12,
                    color: "#fff",
                    cursor: "pointer",
                    fontFamily: "var(--font)",
                    flexShrink: 0,
                  }}
                >
                  {t("history.goSync")}
                </button>
              )}
            </div>
          )}

          {historyLoading ? (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border-soft)", alignItems: "center" }}>
                  <Skeleton width={64} height={13} />
                  <Skeleton width={220} height={13} />
                  <Skeleton width={48} height={13} />
                </div>
              ))}
            </div>
          ) : historyEntries.length === 0 ? (
            <EmptyState
              icon={<ClockCounterClockwise size={24} weight="duotone" />}
              title={t("history.empty")}
              subtitle=""
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
              {historyEntries.map((entry, idx) => (
                <HistoryRow
                  key={entry.sha}
                  entry={entry}
                  isCurrent={idx === 0}
                  onRestore={handleRestore}
                  restoring={restoringShа === entry.sha}
                />
              ))}
            </section>
          )}
        </div>
      ) : (
        /* Timeline view */
        <div>
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
      )}
    </div>
  );
}
