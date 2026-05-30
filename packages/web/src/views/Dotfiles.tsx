import { useState, useEffect, useCallback } from "react";
import { File, MagnifyingGlass, ArrowsClockwise, FloppyDisk, Terminal, GitBranch, Pencil } from "@phosphor-icons/react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { getIndex, getDotfiles, getDiscoverModule, addSelection } from "../api";

interface DotfilesProps { showHud?: (m: HudMessage) => void; }
type Category = "shell" | "git" | "editor" | "other";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 11, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

function categorize(path: string): Category {
  const f = path.toLowerCase();
  if (/(zsh|bash|profile|fish|shell|inputrc|aliases)/.test(f)) return "shell";
  if (/git/.test(f)) return "git";
  if (/(vim|nvim|emacs|vscode|editorconfig|nano)/.test(f)) return "editor";
  return "other";
}

function CategoryIcon({ category }: { category: Category }) {
  if (category === "shell") return <Terminal size={14} style={{ color: "var(--muted)" }} />;
  if (category === "git") return <GitBranch size={14} style={{ color: "var(--muted)" }} />;
  if (category === "editor") return <Pencil size={14} style={{ color: "var(--muted)" }} />;
  return <File size={14} style={{ color: "var(--muted)" }} />;
}

export function Dotfiles({ showHud }: DotfilesProps) {
  const [available, setAvailable] = useState(true);
  const [managed, setManaged] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    const [, df] = await Promise.all([getIndex(), getDotfiles()]);
    setAvailable(df.available);
    setManaged(df.managed);
  }, []);

  useEffect(() => {
    void (async () => {
      try { await load(); } finally { setLoading(false); }
    })();
  }, [load]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const { candidates } = await getDiscoverModule("dotfiles");
      setCands(candidates.dotfiles ?? []);
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Scan failed", type: "error" });
    } finally {
      setScanning(false);
    }
  }, [showHud]);

  const add = useCallback(async (c: Candidate) => {
    try {
      await addSelection("dotfiles", c.id);
      await load();
      showHud?.({ text: `Added ${c.path}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Add failed", type: "error" });
    }
  }, [load, showHud]);

  const shown = (managed ?? []).filter((p) => p.toLowerCase().includes(filter.toLowerCase()));
  const newCands = (cands ?? []).filter((c) => !(managed ?? []).includes(c.id));

  if (loading) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <div style={card}>{[1, 2, 3].map((i) => <div key={i} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}><Skeleton width={300} height={14} /></div>)}</div>
      </div>
    );
  }

  if (!available) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <EmptyState
          icon={<File size={24} />}
          title="chezmoi not installed"
          subtitle="Install chezmoi to manage dotfiles — Roost won't run chezmoi until it's available."
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        Config files Roost backs up &amp; restores on a new Mac. Managed: {managed?.length ?? 0} · scanning for more is on-demand.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <MagnifyingGlass size={14} style={{ position: "absolute", left: 9, top: 8, color: "var(--muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter dotfiles…"
            style={{ width: "100%", appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 13, padding: "6px 10px 6px 28px", borderRadius: 6, boxSizing: "border-box" }}
          />
        </div>
        <button onClick={() => void scan()} disabled={scanning} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 13 }}>
          {scanning ? <ArrowsClockwise size={14} /> : <MagnifyingGlass size={14} />}
          {scanning ? "Scanning…" : "Scan for dotfiles"}
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<File size={24} />} title={managed && managed.length > 0 ? "Nothing here" : "No dotfiles tracked yet"} subtitle={managed && managed.length > 0 ? "No dotfiles match this filter." : 'Click "Scan for dotfiles" to find config files on this Mac.'} />
      ) : (
        <div style={card}>
          {shown.map((p) => {
            const cat = categorize(p);
            return (
              <div key={p} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                <CategoryIcon category={cat} />
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                <span style={{ color: "var(--muted)", fontSize: 11 }}>{cat}</span>
              </div>
            );
          })}
        </div>
      )}

      {cands !== null && newCands.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 8px" }}>Discovered ({newCands.length})</div>
          <div style={card}>
            {newCands.map((c) => (
              <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                <CategoryIcon category={categorize(c.path)} />
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
                <button onClick={() => void add(c)} style={{ ...ic, color: "var(--accent)" }} aria-label={`add ${c.path}`}><FloppyDisk size={11} />Add</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
