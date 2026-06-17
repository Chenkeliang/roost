import { useState } from "react";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { getFilePreview } from "../api";
import { useT } from "../i18n";

export type PreviewState = { open: boolean; loading: boolean; content?: string; reason?: string; masked?: boolean; revealed?: boolean };

// Per-row preview state + lazy fetch (cached after first open). Not previewable
// rows (encrypted/credential) get a no-op toggle. setReveal re-fetches with the
// ADR-0025 reveal flag (masked structure by default; plaintext only on explicit
// local reveal).
export function useFilePreview(filePath: string, previewable: boolean) {
  const [preview, setPreview] = useState<PreviewState>({ open: false, loading: false });

  const fetchInto = async (reveal: boolean): Promise<void> => {
    setPreview((q) => ({ ...q, open: true, loading: true }));
    try {
      const r = await getFilePreview(filePath, reveal);
      setPreview({
        open: true,
        loading: false,
        content: r.ok ? r.content : undefined,
        reason: r.ok ? undefined : (r.reason ?? "failed"),
        masked: r.ok ? r.masked : undefined,
        revealed: r.ok ? r.revealed : undefined,
      });
    } catch {
      setPreview({ open: true, loading: false, reason: "failed" });
    }
  };

  const toggle = async (): Promise<void> => {
    if (!previewable) return;
    if (preview.open) { setPreview((q) => ({ ...q, open: false })); return; }
    if (preview.content !== undefined || preview.reason) { setPreview((q) => ({ ...q, open: true })); return; }
    await fetchInto(false);
  };

  // Reveal/hide the real local plaintext (encrypt-marked files). Always re-fetches.
  const setReveal = (reveal: boolean): void => { void fetchInto(reveal); };

  return { preview, toggle, setReveal };
}

// Inline caret before a file name. verticalAlign keeps the SVG centered on the
// text line (default baseline alignment sits it too low next to row icons).
// `placeholder` reserves the same width on non-previewable rows so file names
// stay column-aligned with previewable ones.
export function PreviewCaret({ open, placeholder }: { open: boolean; placeholder?: boolean }) {
  if (placeholder) return <span style={{ display: "inline-block", width: 15, flexShrink: 0 }} />;
  return <ChevronRight size={10} style={{ display: "inline-block", marginRight: 5, verticalAlign: "middle", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", flexShrink: 0 }} />;
}

export function FilePreviewPane({ preview, onReveal }: { preview: PreviewState; onReveal?: (reveal: boolean) => void }) {
  const { t } = useT();
  if (!preview.open) return null;
  const reasonKey = preview.reason === "too-large" ? "preview.tooLarge" : `preview.${preview.reason}`;
  const secretFile = preview.masked || preview.revealed; // encrypt-marked file with a reveal toggle
  return (
    <div style={{ margin: "0 14px 10px", padding: "8px 10px", background: "var(--raise)", border: "1px solid var(--border-soft)", borderRadius: 7, fontSize: 12, maxHeight: 260, overflow: "auto" }}>
      {preview.loading
        ? <span style={{ color: "var(--muted)" }}>{t("preview.loading")}</span>
        : preview.reason
          ? <span style={{ color: "var(--muted)" }}>{t(reasonKey)}</span>
          : <>
              {secretFile && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  {onReveal && (
                    <button
                      type="button"
                      onClick={() => onReveal(!preview.revealed)}
                      aria-label={preview.revealed ? t("preview.hideAria") : t("preview.revealAria")}
                      style={{ appearance: "none", border: 0, background: "none", padding: 0, cursor: "pointer", color: "var(--muted)", display: "inline-flex", alignItems: "center" }}
                    >
                      {preview.revealed ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  )}
                  <span style={{ fontSize: 11.5, color: preview.revealed ? "var(--green)" : "var(--amber)" }}>
                    {preview.revealed ? t("preview.revealedNote") : t("preview.masked")}
                  </span>
                </div>
              )}
              <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--text)" }}>{preview.content}</pre>
            </>}
    </div>
  );
}
