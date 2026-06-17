import { useState } from "react";
import { ChevronRight, Eye, EyeOff, Folder, FolderOpen, File as FileIcon } from "lucide-react";
import { getFilePreview } from "../api";
import { useT } from "../i18n";

export type DirEntry = { name: string; dir: boolean };
export type PreviewState = { open: boolean; loading: boolean; content?: string; reason?: string; masked?: boolean; revealed?: boolean; entries?: DirEntry[] };

// Per-path preview state + lazy fetch. A path resolves to a file (content, maybe
// masked) or a directory (entries → rendered as a lazy tree). setReveal re-fetches
// with the ADR-0025 reveal flag (plaintext only on explicit local request).
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
        entries: r.ok ? r.entries : undefined,
      });
    } catch {
      setPreview({ open: true, loading: false, reason: "failed" });
    }
  };

  const toggle = async (): Promise<void> => {
    if (!previewable) return;
    if (preview.open) { setPreview((q) => ({ ...q, open: false })); return; }
    if (preview.content !== undefined || preview.reason || preview.entries) { setPreview((q) => ({ ...q, open: true })); return; }
    await fetchInto(false);
  };

  const setReveal = (reveal: boolean): void => { void fetchInto(reveal); };

  return { preview, toggle, setReveal };
}

// Inline caret before a file/row name. Fixed width so previewable and
// non-previewable rows stay column-aligned.
export function PreviewCaret({ open, placeholder }: { open: boolean; placeholder?: boolean }) {
  if (placeholder) return <span style={{ display: "inline-block", width: 15, flexShrink: 0 }} />;
  return <ChevronRight size={10} style={{ display: "inline-block", marginRight: 5, verticalAlign: "middle", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", flexShrink: 0 }} />;
}

const eyeBtnStyle: React.CSSProperties = { appearance: "none", border: 0, background: "none", padding: 0, cursor: "pointer", color: "var(--muted)", display: "inline-flex", alignItems: "center" };
const preStyle: React.CSSProperties = { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--text)" };

// File content with the masked-by-default note + reveal eye (ADR-0025). Shared by
// the top-level pane and the tree's file nodes.
function MaskedContent({ preview, onReveal }: { preview: PreviewState; onReveal?: (reveal: boolean) => void }) {
  const { t } = useT();
  const secret = preview.masked || preview.revealed;
  return (
    <>
      {secret && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          {onReveal && (
            <button type="button" onClick={() => onReveal(!preview.revealed)} aria-label={preview.revealed ? t("preview.hideAria") : t("preview.revealAria")} style={eyeBtnStyle}>
              {preview.revealed ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
          <span style={{ fontSize: 11.5, color: preview.revealed ? "var(--green)" : "var(--amber)" }}>
            {preview.revealed ? t("preview.revealedNote") : t("preview.masked")}
          </span>
        </div>
      )}
      <pre className="mono" style={preStyle}>{preview.content}</pre>
    </>
  );
}

// One node in the lazy file tree. `dir`/`name` come from the parent listing so the
// icon + caret render before any fetch; expanding lazily fetches this path
// (directory → child entries, file → content). Caret slot is fixed-width so file
// and directory names align in one column regardless of the caret.
function FileTreeNode({ path, name, dir, depth }: { path: string; name: string; dir: boolean; depth: number }) {
  const { t } = useT();
  const { preview, toggle, setReveal } = useFilePreview(path, true);
  const childPad = 6 + (depth + 1) * 14;
  return (
    <div>
      <div onClick={() => void toggle()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", paddingLeft: 6 + depth * 14, borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}>
        <span style={{ width: 14, flex: "none", display: "inline-flex", justifyContent: "center", color: "var(--muted)" }}>
          {dir ? <ChevronRight size={11} style={{ transform: preview.open ? "rotate(90deg)" : "none", transition: "transform .12s" }} /> : null}
        </span>
        {dir
          ? (preview.open ? <FolderOpen size={13} style={{ color: "var(--muted)", flex: "none" }} /> : <Folder size={13} style={{ color: "var(--muted)", flex: "none" }} />)
          : <FileIcon size={13} style={{ color: "var(--faint)", flex: "none" }} />}
        <span className="mono" style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      </div>
      {preview.open && (
        preview.loading
          ? <div style={{ paddingLeft: childPad, color: "var(--muted)", fontSize: 12 }}>{t("preview.loading")}</div>
          : preview.entries
            ? <FileTree basePath={path} entries={preview.entries} depth={depth + 1} />
            : preview.reason
              ? <div style={{ paddingLeft: childPad, color: "var(--muted)", fontSize: 12 }}>{t(preview.reason === "too-large" ? "preview.tooLarge" : `preview.${preview.reason}`)}</div>
              : <div style={{ paddingLeft: childPad, fontSize: 12 }}><MaskedContent preview={preview} onReveal={setReveal} /></div>
      )}
    </div>
  );
}

export function FileTree({ basePath, entries, depth = 0 }: { basePath: string; entries: DirEntry[]; depth?: number }) {
  if (entries.length === 0) return <div style={{ paddingLeft: 6 + depth * 14, color: "var(--faint)", fontSize: 12 }}>—</div>;
  return <>{entries.map((e) => <FileTreeNode key={e.name} path={`${basePath}/${e.name}`} name={e.name} dir={e.dir} depth={depth} />)}</>;
}

export function FilePreviewPane({ preview, path, onReveal }: { preview: PreviewState; path?: string; onReveal?: (reveal: boolean) => void }) {
  const { t } = useT();
  if (!preview.open) return null;
  const reasonKey = preview.reason === "too-large" ? "preview.tooLarge" : `preview.${preview.reason}`;
  return (
    <div style={{ margin: "0 14px 10px", padding: "8px 10px", background: "var(--raise)", border: "1px solid var(--border-soft)", borderRadius: 7, fontSize: 12, maxHeight: 280, overflow: "auto" }}>
      {preview.loading
        ? <span style={{ color: "var(--muted)" }}>{t("preview.loading")}</span>
        : preview.reason
          ? <span style={{ color: "var(--muted)" }}>{t(reasonKey)}</span>
          : preview.entries
            ? (path ? <FileTree basePath={path} entries={preview.entries} /> : <pre className="mono" style={preStyle}>{preview.entries.map((e) => e.dir ? `${e.name}/` : e.name).join("\n")}</pre>)
            : <MaskedContent preview={preview} onReveal={onReveal} />}
    </div>
  );
}
