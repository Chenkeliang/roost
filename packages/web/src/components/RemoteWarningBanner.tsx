import { useState } from "react";
import { Warning } from "@phosphor-icons/react";
import { setGitRemote } from "../api";

export function RemoteWarningBanner({ t, onConfigured }: { t: (k: string) => string; onConfigured: () => void }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!url.trim()) return;
    setBusy(true); setErr(null);
    try { await setGitRemote(url.trim()); onConfigured(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const cta: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e" };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface)", border: "1px solid #4a3a1e", borderRadius: "var(--rc)", marginBottom: 14, fontSize: 13.5, flexWrap: "wrap" }}>
      <Warning size={16} weight="duotone" style={{ color: "var(--amber)", flexShrink: 0 }} />
      <span>{t("onboard.remote.warning")}</span>
      <span style={{ flex: 1 }} />
      {editing ? (
        <>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("onboard.remote.placeholder")} style={{ minWidth: 240, fontSize: 12.5, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)" }} />
          <button onClick={() => void save()} disabled={busy} style={cta}>{t("onboard.remote.save")}</button>
        </>
      ) : (
        <button onClick={() => setEditing(true)} style={cta}>{t("onboard.remote.set")}</button>
      )}
      {err && <span style={{ color: "var(--accent)", fontSize: 12, width: "100%" }}>{err}</span>}
    </div>
  );
}
