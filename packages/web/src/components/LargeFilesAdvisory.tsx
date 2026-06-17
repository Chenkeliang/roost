import { useState } from "react";
import { Files } from "lucide-react";
import { excludeDotfile, addSelection } from "../api";

const banner: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", background: "var(--surface)", border: "1px solid #4a3a1e", borderRadius: "var(--rc)", marginBottom: 14, fontSize: 13.5 };
const ghost: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12, padding: "3px 10px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" };

export function LargeFilesAdvisory({ t, items, onChanged }: {
  t: (k: string) => string;
  items: { path: string; mb: number }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  if (items.length === 0) return null;
  const total = items.reduce((n, i) => n + i.mb, 0);

  const exclude = async (p: string) => {
    setBusyPath(p);
    try { await excludeDotfile(p); onChanged(); } catch { /* stays listed; Hud handled upstream if desired */ }
    finally { setBusyPath(null); }
  };

  const keep = async (p: string) => {
    setBusyPath(p);
    try { await addSelection("dotfiles-large-ok", p); onChanged(); } catch { /* stays listed */ }
    finally { setBusyPath(null); }
  };

  return (
    <div style={banner} role="status">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Files size={15} style={{ color: "var(--amber)", flexShrink: 0 }} />
        <span>{items.length} {t("large.title")} {total} MB</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setOpen(!open)} style={ghost}>{open ? t("large.collapse") : t("large.expand")}</button>
      </div>
      {open && items.map((i) => (
        <div key={i.path} style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 6, borderTop: "1px solid var(--border-soft)" }}>
          <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 12.5 }}>{i.path}</span>
          <span style={{ color: "var(--muted)", fontSize: 12.5, flexShrink: 0 }}>{i.mb} MB</span>
          <button onClick={() => void keep(i.path)} disabled={busyPath !== null} style={ghost}>
            {t("large.keep")}
          </button>
          <button onClick={() => void exclude(i.path)} disabled={busyPath !== null} style={{ ...ghost, color: "var(--accent)" }}>
            {busyPath === i.path ? "…" : t("large.remove")}
          </button>
        </div>
      ))}
    </div>
  );
}
