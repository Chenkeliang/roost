import { useState, useEffect, useCallback } from "react";
import { getSyncState, postResolve, getItemDiff } from "../api";
import type {
  SyncStateResponse,
  SyncItem,
  SyncExceptionKind,
  SyncDirection,
  ResolveAction,
  ItemDiffResponse,
} from "../api";
import { useT } from "../i18n";

// Automation-first review surface (ADR-0016 §6). Plain-language labels via i18n;
// raw direction enums are never shown.

type Translate = (key: string) => string;

const ACTIONS: Record<SyncExceptionKind, { action: ResolveAction; primary: boolean }[]> = {
  diverged: [
    { action: "keep-local", primary: false },
    { action: "take-repo", primary: true },
  ],
  // Destructive (repo deleted): only the safe no-op inline; explicit delete-confirm
  // is intentionally not wired here.
  destructive: [{ action: "keep-local", primary: true }],
  blocked: [],
};

const DOT: Record<SyncExceptionKind, string> = {
  diverged: "var(--accent)",
  blocked: "#b79af0",
  destructive: "#ff8c8c",
};
const GROUP_KEY: Record<SyncExceptionKind, string> = {
  diverged: "sync.group.diverged",
  blocked: "sync.group.blocked",
  destructive: "sync.group.destructive",
};

function actionLabel(t: Translate, a: ResolveAction): string {
  return a === "take-repo" ? t("sync.useRepo") : t("sync.keepLocal");
}
function dirLabel(t: Translate, dir: SyncDirection): string {
  return t(`sync.dir.${dir}`);
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color, border: `1px solid ${color}` }}>
      {text}
    </span>
  );
}

function DiffPane({ label, text, accent }: { label: string; text: string | null; accent: string }) {
  const { t } = useT();
  return (
    <div style={{ flex: 1, minWidth: 0, border: `1px solid ${accent}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", padding: "4px 8px", borderBottom: "1px solid var(--border-soft)" }}>
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          fontSize: 12.5,
          fontFamily: "var(--font-mono, monospace)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 260,
          overflow: "auto",
          color: text === null ? "var(--muted)" : "var(--text)",
        }}
      >
        {text === null ? t("sync.absent") : text || t("sync.emptyContent")}
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
  const { t } = useT();
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

  const summaryText = (code: string | undefined): string =>
    code === "dir-or-binary" ? t("sync.summary.dirOrBinary") : t("sync.summary.noText");

  // Localize known detail codes (e.g. "needs-age-key"); pass other details through.
  const detailText = (() => {
    if (!item.detail) return null;
    const key = `sync.detail.${item.detail}`;
    const tr = t(key);
    return tr === key ? item.detail : tr;
  })();

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 14px",
          borderBottom: open ? "none" : "1px solid var(--border-soft)",
          fontSize: 13.5,
          opacity: busy ? 0.5 : 1,
        }}
      >
        <span style={{ color: "var(--muted)", fontSize: 12.5, minWidth: 72, flexShrink: 0 }}>{item.module}</span>
        <span style={{ fontFamily: "var(--font-mono, monospace)", flex: 1, minWidth: 0, wordBreak: "break-all" }}>{item.id}</span>
        {detailText ? <span style={{ color: "var(--muted)", fontSize: 12.5, flexShrink: 0 }}>{detailText}</span> : null}
        <button
          onClick={toggleDiff}
          style={{ fontSize: 12, padding: "3px 9px", borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {open ? t("sync.collapse") : `${t("sync.diff")} ▸`}
        </button>
        {item.exception === "blocked" && onOpenSettings ? (
          <button
            onClick={onOpenSettings}
            style={{ fontSize: 12, fontWeight: 600, padding: "3px 11px", borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid #b79af0", color: "#b79af0", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {t("sync.goSettings")} ▸
          </button>
        ) : null}
        {actions.map((a) => (
          <button
            key={a.action}
            disabled={busy}
            onClick={() => onResolve(item, a.action)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "3px 11px",
              borderRadius: 7,
              cursor: busy ? "default" : "pointer",
              background: "transparent",
              border: a.primary ? "1px solid var(--accent)" : "1px solid var(--border)",
              color: a.primary ? "var(--accent)" : "var(--muted)",
              minWidth: a.primary ? 72 : undefined,
              textAlign: "center",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {actionLabel(t, a.action)}
          </button>
        ))}
      </div>
      {open ? (
        <div style={{ padding: "0 14px 12px", borderBottom: "1px solid var(--border-soft)" }}>
          {diffErr ? (
            <div style={{ color: "#ff8c8c", fontSize: 13 }}>{diffErr}</div>
          ) : diff === null ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("sync.loadingDiff")}</div>
          ) : diff.kind === "summary" ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{summaryText(diff.summary)}</div>
          ) : diff.keys && diff.keys.length > 0 ? (
            <div style={{ border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ display: "flex", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", padding: "5px 10px", borderBottom: "1px solid var(--border-soft)" }}>
                <span style={{ flex: 1.2 }}>{t("sync.key")}</span>
                <span style={{ flex: 1, color: "#9ec5f0" }}>{t("sync.local")}</span>
                <span style={{ flex: 1, color: "#f0a0a0" }}>{t("sync.repo")}</span>
              </div>
              {diff.keys.map((k) => (
                <div key={k.key} style={{ display: "flex", fontSize: 12.5, fontFamily: "var(--font-mono, monospace)", padding: "4px 10px", borderBottom: "1px solid var(--border-soft)" }}>
                  <span style={{ flex: 1.2, color: "var(--text)", wordBreak: "break-all" }}>{k.key}</span>
                  <span style={{ flex: 1, color: "#9ec5f0", wordBreak: "break-all" }}>{k.local ?? t("sync.none")}</span>
                  <span style={{ flex: 1, color: "#f0a0a0", wordBreak: "break-all" }}>{k.repo ?? t("sync.none")}</span>
                </div>
              ))}
              <div style={{ fontSize: 12, color: "var(--muted)", padding: "5px 10px" }}>{t("sync.perKeyNote")}</div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <DiffPane label={t("sync.local")} text={diff.local} accent="#5aa9f033" />
              <DiffPane label={t("sync.repo")} text={diff.repo} accent="#FF636333" />
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

function Group({
  titleKey,
  dot,
  items,
  busyId,
  onResolve,
  onOpenSettings,
}: {
  titleKey: string;
  dot?: string;
  items: SyncItem[];
  busyId: string | null;
  onResolve: (item: SyncItem, action: ResolveAction) => void;
  onOpenSettings?: () => void;
}) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600, margin: "0 0 6px" }}>
        {dot ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} /> : null}
        {t(titleKey)} · {items.length}
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" }}>
        {items.map((it) => {
          const key = `${it.module}:${it.id}`;
          return (
            <Row key={key} item={it} busy={busyId === key} onResolve={onResolve} onOpenSettings={onOpenSettings} />
          );
        })}
      </div>
    </div>
  );
}

export function SyncState({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  const { t } = useT();
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
              ? `${t("sync.notice.keptLocal")}:${item.id}${t("sync.notice.keptSuffix")}`
              : `${t("sync.notice.usedRepo")}:${item.id}${t("sync.notice.usedSuffix")}`,
          );
          refresh();
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusyId(null));
    },
    [refresh, t],
  );

  const items = data?.items ?? [];
  const auto = items.filter((i) => i.exception === null && i.direction !== "synced");
  const diverged = items.filter((i) => i.exception === "diverged");
  const blocked = items.filter((i) => i.exception === "blocked");
  const destructive = items.filter((i) => i.exception === "destructive");
  const needDecision = diverged.length + blocked.length + destructive.length;

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
    setNotice(`${t("sync.notice.batchDone")} ${done} ${t("sync.notice.itemsWord")} ${t("sync.notice.batchSuffix")}`);
    refresh();
  }, [data, policy, refresh, t]);

  const POLICY_OPTS: { v: ResolveAction; labelKey: string }[] = [
    { v: "take-repo", labelKey: "sync.useRepo" },
    { v: "keep-local", labelKey: "sync.keepLocal" },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ fontSize: 12.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600, marginBottom: 14 }}>
        {t("nav.sync")}
      </div>

      {loading && !data ? (
        <div style={{ color: "var(--muted)", fontSize: 14 }}>{t("sync.loading")}</div>
      ) : error ? (
        <div role="alert" style={{ padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", color: "#ff8c8c", fontSize: 14, marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {notice ? (
        <div style={{ padding: "8px 14px", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", color: "#5fd08a", fontSize: 13.5, marginBottom: 12 }}>
          {notice}
        </div>
      ) : null}

      {data ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", marginBottom: 16, fontSize: 13.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />
            <span>{t("sync.defaultAction")}</span>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
              {POLICY_OPTS.map((o) => {
                const active = policy === o.v;
                return (
                  <button
                    key={o.v}
                    onClick={() => setPolicy(o.v)}
                    style={{ appearance: "none", border: 0, background: active ? "var(--raise)" : "transparent", color: active ? "var(--text)" : "var(--muted)", fontSize: 12.5, padding: "3px 11px", cursor: "pointer" }}
                  >
                    {t(o.labelKey)}
                  </button>
                );
              })}
            </div>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
              {t("sync.backupNote")} · {t("sync.autoLabel")} {data.counts.auto} · {t("sync.decideLabel")} {needDecision}
            </span>
            <span style={{ flex: 1 }} />
            {diverged.length + destructive.length > 0 ? (
              <button
                onClick={runBatch}
                disabled={batching}
                style={{ fontSize: 12.5, fontWeight: 700, padding: "5px 13px", borderRadius: 8, cursor: batching ? "default" : "pointer", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e" }}
              >
                {batching ? t("sync.busy") : `${t("sync.applyAll")}(${diverged.length + destructive.length})`}
              </button>
            ) : null}
            <Pill text={`${t("sync.statusLabel")}: ${dirLabel(t, data.overall)}`} color={data.overall === "synced" ? "#5fd08a" : "var(--accent)"} />
          </div>

          {items.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 14 }}>{t("sync.empty")}</div>
          ) : (
            <>
              <Group titleKey="sync.group.auto" items={auto} busyId={busyId} onResolve={onResolve} />
              <Group titleKey={GROUP_KEY.diverged} dot={DOT.diverged} items={diverged} busyId={busyId} onResolve={onResolve} />
              <Group titleKey={GROUP_KEY.blocked} dot={DOT.blocked} items={blocked} busyId={busyId} onResolve={onResolve} onOpenSettings={onOpenSettings} />
              <Group titleKey={GROUP_KEY.destructive} dot={DOT.destructive} items={destructive} busyId={busyId} onResolve={onResolve} />
              {needDecision === 0 && auto.length === 0 ? (
                <div style={{ color: "#5fd08a", fontSize: 14 }}>{t("sync.allSynced")}</div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
