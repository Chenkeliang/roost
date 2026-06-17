import { useState } from "react";
import { ShieldCheck } from "lucide-react";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)" };

export function KeyBackupConfirm({ recipient, keyPath, t, onConfirm }: {
  recipient: string | null;
  keyPath: string;
  t: (k: string) => string;
  onConfirm: () => void;
}) {
  const [acked, setAcked] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={t("onboard.key.title")} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div style={{ ...card, maxWidth: 460, width: "100%", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          <ShieldCheck size={18} style={{ color: "var(--amber)" }} />
          {t("onboard.key.title")}
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 10px" }}>{t("onboard.key.body")}</p>
        <div style={{ fontSize: 12.5, marginBottom: 4 }}>
          <span style={{ color: "var(--muted)" }}>{t("onboard.key.recipient")} </span>
          <span className="mono" style={{ color: "var(--text)", wordBreak: "break-all" }}>{recipient ?? "—"}</span>
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 12 }}>
          <span style={{ color: "var(--muted)" }}>{t("onboard.key.path")} </span>
          <span className="mono" style={{ color: "var(--text)", wordBreak: "break-all" }}>{keyPath}</span>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 14 }}>
          <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
          {t("onboard.key.ack")}
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onConfirm}
            disabled={!acked}
            style={{ padding: "7px 16px", borderRadius: "var(--rr)", border: 0, fontSize: 14, fontWeight: 560, cursor: acked ? "pointer" : "not-allowed", background: acked ? "var(--accent)" : "var(--raise)", color: acked ? "#0b0b0d" : "var(--muted)", opacity: acked ? 1 : 0.7 }}
          >
            {t("onboard.key.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
