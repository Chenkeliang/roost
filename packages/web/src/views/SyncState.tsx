import { useState, useEffect } from "react";
import { getSyncState } from "../api";
import type { SyncStateResponse, SyncItem, SyncExceptionKind } from "../api";

// Automation-first review surface (ADR-0016 §6): non-conflicts auto-resolve;
// only three typed exceptions need a human. Read-only first cut — the per-item
// resolve actions land with the generic resolve endpoint (Plan 4 follow-up).

const EXC: Record<SyncExceptionKind, { label: string; dot: string; defaultAction: string }> = {
  diverged: { label: "两边都改了", dot: "var(--accent)", defaultAction: "取仓库" },
  blocked: { label: "需先设置", dot: "#b79af0", defaultAction: "去设置" },
  destructive: { label: "破坏性(仓库已删除)", dot: "#ff8c8c", defaultAction: "保留本地" },
};

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        color,
        border: `1px solid ${color}`,
      }}
    >
      {text}
    </span>
  );
}

function Row({ item }: { item: SyncItem }) {
  const exc = item.exception ? EXC[item.exception] : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px",
        borderBottom: "1px solid var(--border-soft)",
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: 11, minWidth: 72 }}>{item.module}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{item.id}</span>
      {item.detail ? (
        <span style={{ color: "var(--muted)", fontSize: 11 }}>{item.detail}</span>
      ) : null}
      <span style={{ flex: 1 }} />
      {exc ? (
        // Default action anchored right (coral), to align into one column.
        <span
          title="逐项处置将在 resolve 端点接入后可点击"
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            padding: "3px 11px",
            borderRadius: 7,
            border: "1px solid var(--accent)",
            color: "var(--accent)",
            opacity: 0.55,
            minWidth: 64,
            textAlign: "center",
          }}
        >
          {exc.defaultAction}
        </span>
      ) : null}
    </div>
  );
}

function Group({
  title,
  dot,
  items,
}: {
  title: string;
  dot?: string;
  items: SyncItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 600,
          margin: "0 0 6px",
        }}
      >
        {dot ? (
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
        ) : null}
        {title} · {items.length}
      </div>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--rc)",
          overflow: "hidden",
        }}
      >
        {items.map((it) => (
          <Row key={`${it.module}:${it.id}`} item={it} />
        ))}
      </div>
    </div>
  );
}

export function SyncState() {
  const [data, setData] = useState<SyncStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSyncState()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const items = data?.items ?? [];
  const auto = items.filter((i) => i.exception === null && i.direction !== "synced");
  const diverged = items.filter((i) => i.exception === "diverged");
  const blocked = items.filter((i) => i.exception === "blocked");
  const destructive = items.filter((i) => i.exception === "destructive");

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
        同步复核
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>加载中…</div>
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--rc)",
            color: "#ff8c8c",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : data ? (
        <>
          {/* Policy bar — pre-filled basis (the resolve wiring will make it interactive). */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--rc)",
              marginBottom: 16,
              fontSize: 12.5,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />
            <span>
              基调:<b>以仓库为准</b>(覆盖前全部备份)— 自动 {data.counts.auto} 项,需你决定{" "}
              {data.counts.diverged + data.counts.blocked + data.counts.destructive} 项
            </span>
            <span style={{ flex: 1 }} />
            <Pill
              text={`整体:${data.overall}`}
              color={data.overall === "synced" ? "#5fd08a" : "var(--accent)"}
            />
          </div>

          {items.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>没有被管理的项,或尚未选择。</div>
          ) : (
            <>
              <Group title="已自动就绪(Behind / 新机)" items={auto} />
              <Group title={EXC.diverged.label} dot={EXC.diverged.dot} items={diverged} />
              <Group title={EXC.blocked.label} dot={EXC.blocked.dot} items={blocked} />
              <Group title={EXC.destructive.label} dot={EXC.destructive.dot} items={destructive} />
              {auto.length + diverged.length + blocked.length + destructive.length === 0 ? (
                <div style={{ color: "#5fd08a", fontSize: 13 }}>全部同步,无需处理。</div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
