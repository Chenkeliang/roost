import { useCallback, useEffect, useState } from "react";
import { getKey } from "../../api";
import type { KeyStatus } from "../../api";

const primary: React.CSSProperties = { appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" };
const ghost: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 13, padding: "7px 12px", borderRadius: 8, cursor: "pointer" };

export function StepAgeKey({ t, onDone }: { t: (k: string) => string; onDone: () => void }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const recheck = useCallback(() => {
    setChecking(true);
    getKey().then(setStatus).catch(() => {}).finally(() => setChecking(false));
  }, []);
  useEffect(() => { recheck(); }, [recheck]);

  if (!status) return <div style={{ color: "var(--muted)", fontSize: 13 }}>…</div>;

  const ready = status.encryptedFiles === 0 || status.exists;
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("onboard.restore.key.heading")}</div>
      {ready ? (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
            {status.encryptedFiles === 0 ? t("onboard.restore.key.none") : t("onboard.restore.key.ready")}
          </p>
          <button onClick={onDone} style={primary}>{t("onboard.next")}</button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>{t("onboard.restore.key.body")}</p>
          <div style={{ fontSize: 12.5, marginBottom: 12 }}>
            <span style={{ color: "var(--muted)" }}>{t("onboard.restore.key.path")} </span>
            <span className="mono" style={{ color: "var(--text)", wordBreak: "break-all" }}>{status.keyPath}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={recheck} disabled={checking} style={primary}>{checking ? "…" : t("onboard.restore.key.recheck")}</button>
            <button onClick={onDone} style={ghost}>{t("onboard.restore.key.skip")}</button>
          </div>
        </>
      )}
    </div>
  );
}
