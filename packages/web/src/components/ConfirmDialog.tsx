import { TriangleAlert } from "lucide-react";

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-soft)",
  borderRadius: "var(--rc)",
};

// Modal confirm dialog. Replaces window.confirm(), which the Tauri webview
// silently suppresses (returns false, no dialog) — see Settings rotate-key.
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}
    >
      <div style={{ ...card, maxWidth: 460, width: "100%", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          <TriangleAlert size={18} style={{ color: danger ? "var(--accent)" : "var(--amber)" }} />
          {title}
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 14px" }}>{body}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{ padding: "7px 16px", borderRadius: "var(--rr)", border: "1px solid var(--border-soft)", background: "var(--surface)", color: "var(--text)", fontSize: 14, cursor: "pointer" }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{ padding: "7px 16px", borderRadius: "var(--rr)", border: 0, background: danger ? "var(--accent)" : "var(--amber)", color: "#0b0b0d", fontSize: 14, fontWeight: 560, cursor: "pointer" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
