import { useEffect, useState } from "react";
import { postLoad } from "../../api";
import type { ApplyResult } from "../../api";
import type { HudMessage } from "../../components/Hud";

const primary: React.CSSProperties = { appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" };
const linkBtn: React.CSSProperties = { appearance: "none", border: "none", background: "none", color: "var(--accent)", fontFamily: "var(--font)", fontSize: 12.5, padding: 0, cursor: "pointer" };

export function StepRestore({ t, showHud, onComplete, onOpenSync }: {
  t: (k: string) => string;
  showHud?: (m: HudMessage) => void;
  onComplete: () => void;
  onOpenSync?: () => void;
}) {
  const [preview, setPreview] = useState<ApplyResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<{ name: string; detail?: string }[] | null>(null);

  useEffect(() => {
    postLoad(false).then((r) => setPreview(r.results)).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const apply = async () => {
    setBusy(true); setErr(null); setBlockers(null);
    try {
      const r = await postLoad(true);
      if (r.blocked) { setBlockers(r.blockers ?? []); }
      else { showHud?.({ text: t("onboard.restore.done"), type: "success" }); onComplete(); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const plan = (preview ?? []).map((r) => ({ module: r.module, count: r.applied.length + r.skipped.length })).filter((p) => p.count > 0);

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("onboard.restore.heading")}</div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>{t("onboard.restore.help")}</p>

      {preview === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("onboard.restore.loading")}</div>
      ) : plan.length === 0 ? (
        <div style={{ color: "var(--amber)", fontSize: 13, marginBottom: 12 }}>{t("onboard.restore.empty")}</div>
      ) : (
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden", marginBottom: 12 }}>
          {plan.map((p) => (
            <div key={p.module} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13.5 }}>
              <span style={{ minWidth: 120, textTransform: "capitalize" }}>{p.module}</span>
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{p.count}</span>
            </div>
          ))}
        </div>
      )}

      {blockers && (
        <div style={{ background: "rgba(251,191,36,0.10)", border: "1px solid var(--amber)", borderRadius: "var(--rc)", padding: "9px 12px", marginBottom: 12, fontSize: 12.5, color: "#e8cd8a" }}>
          <div style={{ marginBottom: 6 }}>{t("onboard.restore.blocked")}</div>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            {blockers.map((b, i) => (<li key={i}>{b.name}{b.detail ? ` — ${b.detail}` : ""}</li>))}
          </ul>
          <button onClick={() => onOpenSync?.()} style={linkBtn}>{t("onboard.restore.openSync")}</button>
        </div>
      )}

      {err && <div style={{ color: "var(--accent)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => void apply()} disabled={busy || preview === null} style={primary}>{busy ? "…" : t("onboard.restore.applyAll")}</button>
        <button onClick={() => onOpenSync?.()} style={linkBtn}>{t("onboard.restore.openSync")}</button>
      </div>
    </div>
  );
}
