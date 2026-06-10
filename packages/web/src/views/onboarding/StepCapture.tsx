import { useEffect, useState } from "react";
import { getSelection, getKey, generateKey, postCapture } from "../../api";
import type { HudMessage } from "../../components/Hud";
import { KeyBackupConfirm } from "../../components/KeyBackupConfirm";

const SECRET_MODULES = new Set(["env"]);

export function StepCapture({ t, showHud, onDone }: { t: (k: string) => string; showHud?: (m: HudMessage) => void; onDone: () => void }) {
  const [modules, setModules] = useState<Record<string, string[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [keygen, setKeygen] = useState<{ recipient: string | null; keyPath: string } | null>(null);

  useEffect(() => {
    getSelection().then((s) => setModules(s.modules)).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const doCapture = async () => {
    setBusy(true); setErr(null);
    try {
      await postCapture();
      showHud?.({ text: t("onboard.capture.done"), type: "success" });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const onCaptureClick = async () => {
    const needsSecret = modules ? Object.entries(modules).some(([m, ids]) => SECRET_MODULES.has(m) && ids.length > 0) : false;
    if (needsSecret) {
      setBusy(true);
      try {
        const k = await getKey();
        if (!k.exists) {
          const gen = await generateKey();
          setKeygen({ recipient: gen.recipient, keyPath: gen.keyPath });
          setBusy(false);
          return; // wait for backup ack → doCapture
        }
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); return; }
      setBusy(false);
    }
    await doCapture();
  };

  const summary = modules ? Object.entries(modules).filter(([, ids]) => ids.length > 0) : [];

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>{t("onboard.capture.help")}</p>
      {modules === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>…</div>
      ) : summary.length === 0 ? (
        <div style={{ color: "var(--amber)", fontSize: 13, marginBottom: 12 }}>{t("onboard.capture.empty")}</div>
      ) : (
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden", marginBottom: 12 }}>
          {summary.map(([m, ids]) => (
            <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13.5 }}>
              <span style={{ minWidth: 120, textTransform: "capitalize" }}>{m}</span>
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{ids.length} {t("onboard.select.found")}</span>
            </div>
          ))}
        </div>
      )}
      {err && <div style={{ color: "var(--accent)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <button onClick={() => void onCaptureClick()} disabled={busy || summary.length === 0} style={{ appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: busy ? "default" : "pointer", opacity: summary.length === 0 ? 0.6 : 1 }}>{busy ? "…" : t("onboard.capture.btn")}</button>

      {keygen && (
        <KeyBackupConfirm
          recipient={keygen.recipient}
          keyPath={keygen.keyPath}
          t={t}
          onConfirm={() => { setKeygen(null); void doCapture(); }}
        />
      )}
    </div>
  );
}
