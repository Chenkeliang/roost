import { useState, useEffect, useCallback } from "react";
import { getSyncState, postResolve, getItemDiff } from "../api";
import type {
  SyncStateResponse,
  SyncItem,
  SyncExceptionKind,
  ResolveAction,
  ItemDiffResponse,
} from "../api";

// Automation-first review surface (ADR-0016 §6): non-conflicts auto-resolve;
// only three typed exceptions need a human. Per-item resolve hits POST /api/resolve.

type ActionBtn = { label: string; action: ResolveAction; primary: boolean };

// Which actions each exception offers, and which is the (coral, anchored-right) default.
const ACTIONS: Record<SyncExceptionKind, ActionBtn[]> = {
  diverged: [
    { label: "保留本地", action: "keep-local", primary: false },
    { label: "取仓库", action: "take-repo", primary: true },
  ],
  // Destructive (repo deleted): only the safe no-op is offered here; an explicit
  // delete-confirm flow is intentionally not wired to avoid unconfirmed deletes.
  destructive: [{ label: "保留本地", action: "keep-local", primary: true }],
  // Blocked needs a prerequisite (age key / tool); not resolvable inline.
  blocked: [],
};

const DOT: Record<SyncExceptionKind, string> = {
  diverged: "var(--accent)",
  blocked: "#b79af0",
  destructive: "#ff8c8c",
};
const LABEL: Record<SyncExceptionKind, string> = {
  diverged: "两边都改了",
  blocked: "需先设置(缺 age 私钥 / 工具)",
  destructive: "破坏性(仓库已删除)",
};

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color, border: `1px solid ${color}` }}
    >
      {text}
    </span>
  );
}

function DiffPane({ label, text, accent }: { label: string; text: string | null; accent: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, border: `1px solid ${accent}`, borderRadius: 8, overflow: "hidden" }}>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          color: "var(--muted)",
          padding: "4px 8px",
          borderBottom: "1px solid var(--border-soft)",
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          fontSize: 11,
          fontFamily: "var(--font-mono, monospace)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 260,
          overflow: "auto",
          color: text === null ? "var(--muted)" : "var(--text)",
        }}
      >
        {text === null ? "(不存在)" : text || "(空)"}
      </pre>
    </div>
  );
}

function Row({
  item,
  busy,
  onResolve,
  onOpenSettings,
}: {
  item: SyncItem;
  busy: boolean;
  onResolve: (item: SyncItem, action: ResolveAction) => void;
  onOpenSettings?: () => void;
}) {
  const actions = item.exception ? ACTIONS[item.exception] : [];
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<ItemDiffResponse | null>(null);
  const [diffErr, setDiffErr] = useState<string | null>(null);

  const toggleDiff = () => {
    const next = !open;
    setOpen(next);
    if (next && diff === null && diffErr === null) {
      getItemDiff(item.module, item.id)
        .then(setDiff)
        .catch((e) => setDiffErr(e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 14px",
          borderBottom: open ? "none" : "1px solid var(--border-soft)",
          fontSize: 12.5,
          opacity: busy ? 0.5 : 1,
        }}
      >
        <span style={{ color: "var(--muted)", fontSize: 11, minWidth: 72 }}>{item.module}</span>
        <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{item.id}</span>
        {item.detail ? <span style={{ color: "var(--muted)", fontSize: 11 }}>{item.detail}</span> : null}
        <span style={{ flex: 1 }} />
        <button
          onClick={toggleDiff}
          style={{
            fontSize: 10.5,
            padding: "3px 9px",
            borderRadius: 7,
            cursor: "pointer",
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--muted)",
          }}
        >
          {open ? "收起" : "diff ▸"}
        </button>
        {item.exception === "blocked" && onOpenSettings ? (
          <button
            onClick={onOpenSettings}
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              padding: "3px 11px",
              borderRadius: 7,
              cursor: "pointer",
              background: "transparent",
              border: "1px solid #b79af0",
              color: "#b79af0",
            }}
          >
            去设置 ▸
          </button>
        ) : null}
        {actions.map((a) => (
          <button
            key={a.action}
            disabled={busy}
            onClick={() => onResolve(item, a.action)}
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              padding: "3px 11px",
              borderRadius: 7,
              cursor: busy ? "default" : "pointer",
              background: "transparent",
              border: a.primary ? "1px solid var(--accent)" : "1px solid var(--border)",
              color: a.primary ? "var(--accent)" : "var(--muted)",
              minWidth: a.primary ? 64 : undefined,
              textAlign: "center",
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      {open ? (
        <div style={{ padding: "0 14px 12px", borderBottom: "1px solid var(--border-soft)" }}>
          {diffErr ? (
            <div style={{ color: "#ff8c8c", fontSize: 12 }}>{diffErr}</div>
          ) : diff === null ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>加载 diff…</div>
          ) : diff.kind === "summary" ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{diff.summary}</div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <DiffPane label="本地" text={diff.local} accent="#5aa9f033" />
              <DiffPane label="仓库" text={diff.repo} accent="#FF636333" />
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

function Group({
  title,
  dot,
  items,
  busyId,
  onResolve,
  onOpenSettings,
}: {
  title: string;
  dot?: string;
  items: SyncItem[];
  busyId: string | null;
  onResolve: (item: SyncItem, action: ResolveAction) => void;
  onOpenSettings?: () => void;
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
        {dot ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} /> : null}
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
        {items.map((it) => {
          const key = `${it.module}:${it.id}`;
          return (
            <Row
              key={key}
              item={it}
              busy={busyId === key}
              onResolve={onResolve}
              onOpenSettings={onOpenSettings}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SyncState({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  const [data, setData] = useState<SyncStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [policy, setPolicy] = useState<ResolveAction>("take-repo");
  const [batching, setBatching] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    getSyncState()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onResolve = useCallback(
    (item: SyncItem, action: ResolveAction) => {
      const key = `${item.module}:${item.id}`;
      setBusyId(key);
      setError(null);
      postResolve(item.module, item.id, action)
        .then(() => {
          setNotice(
            action === "keep-local"
              ? `已保留本地:${item.id}(该项仍与仓库不同,直到你 capture 上传)`
              : `已取仓库:${item.id}(覆盖前已备份)`,
          );
          refresh();
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusyId(null));
    },
    [refresh],
  );

  const items = data?.items ?? [];
  const auto = items.filter((i) => i.exception === null && i.direction !== "synced");
  const diverged = items.filter((i) => i.exception === "diverged");
  const blocked = items.filter((i) => i.exception === "blocked");
  const destructive = items.filter((i) => i.exception === "destructive");
  const needDecision = diverged.length + blocked.length + destructive.length;

  // Batch-resolve every exception by the chosen basis. Destructive stays safe
  // (keep-local, never auto-delete); blocked is skipped (needs setup first).
  const runBatch = useCallback(async () => {
    const targets = (data?.items ?? []).filter((i) => i.exception === "diverged" || i.exception === "destructive");
    if (targets.length === 0) return;
    setBatching(true);
    setError(null);
    let done = 0;
    for (const it of targets) {
      const action: ResolveAction = it.exception === "destructive" ? "keep-local" : policy;
      try {
        await postResolve(it.module, it.id, action);
        done += 1;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    setBatching(false);
    setNotice(`批量完成:处理 ${done} 项(基调:${policy === "take-repo" ? "以仓库为准" : "保留本地"};破坏性项已保留本地)`);
    refresh();
  }, [data, policy, refresh]);

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

      {loading && !data ? (
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
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div
          style={{
            padding: "8px 14px",
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--rc)",
            color: "#5fd08a",
            fontSize: 12.5,
            marginBottom: 12,
          }}
        >
          {notice}
        </div>
      ) : null}

      {data ? (
        <>
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
            <span>基调</span>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
              {([
                { v: "take-repo", label: "以仓库为准" },
                { v: "keep-local", label: "保留本地" },
              ] as { v: ResolveAction; label: string }[]).map((o) => {
                const active = policy === o.v;
                return (
                  <button
                    key={o.v}
                    onClick={() => setPolicy(o.v)}
                    style={{
                      appearance: "none",
                      border: 0,
                      background: active ? "var(--raise)" : "transparent",
                      color: active ? "var(--text)" : "var(--muted)",
                      fontSize: 11.5,
                      padding: "3px 11px",
                      cursor: "pointer",
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <span style={{ color: "var(--muted)", fontSize: 11.5 }}>
              覆盖前全部备份 · 自动 {data.counts.auto} 项,需你决定 {needDecision} 项
            </span>
            <span style={{ flex: 1 }} />
            {diverged.length + destructive.length > 0 ? (
              <button
                onClick={runBatch}
                disabled={batching}
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: "5px 13px",
                  borderRadius: 8,
                  cursor: batching ? "default" : "pointer",
                  background: "var(--accent)",
                  border: "1px solid var(--accent)",
                  color: "#1b1b1e",
                }}
              >
                {batching ? "处理中…" : `全部应用基调(${diverged.length + destructive.length})`}
              </button>
            ) : null}
            <Pill text={`整体:${data.overall}`} color={data.overall === "synced" ? "#5fd08a" : "var(--accent)"} />
          </div>

          {items.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>没有被管理的项,或尚未选择。</div>
          ) : (
            <>
              <Group title="已自动就绪(Behind / 新机)" items={auto} busyId={busyId} onResolve={onResolve} />
              <Group title={LABEL.diverged} dot={DOT.diverged} items={diverged} busyId={busyId} onResolve={onResolve} />
              <Group title={LABEL.blocked} dot={DOT.blocked} items={blocked} busyId={busyId} onResolve={onResolve} onOpenSettings={onOpenSettings} />
              <Group title={LABEL.destructive} dot={DOT.destructive} items={destructive} busyId={busyId} onResolve={onResolve} />
              {needDecision === 0 && auto.length === 0 ? (
                <div style={{ color: "#5fd08a", fontSize: 13 }}>全部同步,无需处理。</div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
