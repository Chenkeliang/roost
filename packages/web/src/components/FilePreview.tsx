import { useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { getFilePreview } from "../api";
import { useT } from "../i18n";

export type PreviewState = { open: boolean; loading: boolean; content?: string; reason?: string };

// Per-row preview state + lazy fetch (cached after first open). Not previewable
// rows (encrypted/credential) get a no-op toggle.
export function useFilePreview(filePath: string, previewable: boolean) {
  const [preview, setPreview] = useState<PreviewState>({ open: false, loading: false });
  const toggle = async (): Promise<void> => {
    if (!previewable) return;
    if (preview.open) { setPreview((q) => ({ ...q, open: false })); return; }
    if (preview.content !== undefined || preview.reason) { setPreview((q) => ({ ...q, open: true })); return; }
    setPreview({ open: true, loading: true });
    try {
      const r = await getFilePreview(filePath);
      setPreview({ open: true, loading: false, content: r.ok ? r.content : undefined, reason: r.ok ? undefined : (r.reason ?? "failed") });
    } catch {
      setPreview({ open: true, loading: false, reason: "failed" });
    }
  };
  return { preview, toggle };
}

export function PreviewCaret({ open }: { open: boolean }) {
  return <CaretRight size={10} style={{ marginRight: 5, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", flexShrink: 0 }} />;
}

export function FilePreviewPane({ preview }: { preview: PreviewState }) {
  const { t } = useT();
  if (!preview.open) return null;
  const reasonKey = preview.reason === "too-large" ? "preview.tooLarge" : `preview.${preview.reason}`;
  return (
    <div style={{ margin: "0 14px 10px", padding: "8px 10px", background: "var(--raise)", border: "1px solid var(--border-soft)", borderRadius: 7, fontSize: 12, maxHeight: 260, overflow: "auto" }}>
      {preview.loading
        ? <span style={{ color: "var(--muted)" }}>{t("preview.loading")}</span>
        : preview.reason
          ? <span style={{ color: "var(--muted)" }}>{t(reasonKey)}</span>
          : <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--text)" }}>{preview.content}</pre>}
    </div>
  );
}
