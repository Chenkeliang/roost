import { useState, useEffect, useCallback } from "react";
import { File, MagnifyingGlass, ArrowsClockwise, FloppyDisk, Terminal, GitBranch, Pencil, CheckCircle, X } from "@phosphor-icons/react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getIndex, getDotfiles, getDiscoverModule, addSelection, removeSelection, getSelection } from "../api";

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
  const { t } = useT();
  const [available, setAvailable] = useState(true);
  const [managed, setManaged] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // in selection.yaml (pending capture)
  const [checked, setChecked] = useState<Set<string>>(new Set()); // batch UI checkboxes
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [, df, sel] = await Promise.all([getIndex(), getDotfiles(), getSelection()]);
    setAvailable(df.available);
    setManaged(df.managed);
    setSelected(new Set(sel.modules.dotfiles ?? []));
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
      setSelected((s) => new Set(s).add(c.id));
      showHud?.({ text: `Added ${c.path}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Add failed", type: "error" });
    }
  }, [showHud]);

  const remove = useCallback(async (id: string) => {
    try {
      await removeSelection("dotfiles", id);
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
      showHud?.({ text: `Removed ${id}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Remove failed", type: "error" });
    }
  }, [showHud]);

  // Primary list = what you've SELECTED (selection.yaml), shown persistently
  // whether or not it's been captured yet. The Discovered section below is for
  // adding new ones.
  const selectedList = [...selected].filter((p) => p.toLowerCase().includes(filter.toLowerCase())).sort();
  const newCands = (cands ?? [])
    .filter((c) => !selected.has(c.id))
    .filter((c) => c.path.toLowerCase().includes(filter.toLowerCase()));

  const toggleCheck = useCallback((id: string) => {
    setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  // Batch add/remove every checked candidate, then clear the checkbox selection.
  const batch = useCallback(async (action: "add" | "remove") => {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const id of ids) {
        if (action === "add") await addSelection("dotfiles", id);
        else await removeSelection("dotfiles", id);
      }
      setSelected((s) => {
        const n = new Set(s);
        for (const id of ids) { if (action === "add") n.add(id); else n.delete(id); }
        return n;
      });
      setChecked(new Set());
      showHud?.({ text: `${action === "add" ? "Added" : "Removed"} ${ids.length} item(s)`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Batch failed", type: "error" });
    } finally {
      setBusy(false);
    }
  }, [checked, showHud]);

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
          title={t("dotfiles.noChezmoiTitle")}
          subtitle={t("dotfiles.noChezmoiSubtitle")}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        {t("dotfiles.explainer")} {t("common.selected")}: {selected.size} · {t("common.managed")}: {managed?.length ?? 0}.
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
          {scanning ? t("dotfiles.scanning") : t("dotfiles.scan")}
        </button>
      </div>

      {selectedList.length === 0 ? (
        <EmptyState icon={<File size={24} />} title={selected.size > 0 ? t("dotfiles.emptyMatchTitle") : t("dotfiles.emptyTitle")} subtitle={selected.size > 0 ? t("dotfiles.emptyMatchSubtitle") : t("dotfiles.emptySubtitle")} />
      ) : (
        <div style={card}>
          {selectedList.map((p) => {
            const cat = categorize(p);
            const captured = (managed ?? []).some((m) => p.endsWith(m) || m.endsWith(p));
            return (
              <div key={p} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                <CategoryIcon category={cat} />
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                <span style={{ color: captured ? "var(--green)" : "var(--muted)", fontSize: 11 }}>{captured ? t("dotfiles.captured") : t("dotfiles.pending")}</span>
                <button onClick={() => void remove(p)} style={{ ...ic, color: "var(--red)" }} aria-label={`remove ${p}`}><X size={11} />{t("common.remove")}</button>
              </div>
            );
          })}
        </div>
      )}

      {cands !== null && newCands.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                aria-label="select all discovered"
                checked={checked.size > 0 && newCands.every((c) => checked.has(c.id))}
                onChange={(e) => setChecked(e.target.checked ? new Set(newCands.map((c) => c.id)) : new Set())}
              />
              {t("dotfiles.discovered")} ({newCands.length})
            </label>
            {checked.size > 0 && (
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{checked.size} {t("dotfiles.selected")}</span>
                <button onClick={() => void batch("add")} disabled={busy} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}>
                  <FloppyDisk size={11} />{t("dotfiles.addSelected")}
                </button>
                <button onClick={() => void batch("remove")} disabled={busy} style={{ ...ic, color: "var(--red)", borderColor: "var(--red)" }}>
                  <X size={11} />{t("dotfiles.removeSelected")}
                </button>
              </span>
            )}
          </div>
          <div style={card}>
            {newCands.map((c) => {
              const isAdded = selected.has(c.id);
              return (
                <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                  <input type="checkbox" aria-label={`select ${c.path}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} />
                  <CategoryIcon category={categorize(c.path)} />
                  <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
                  {isAdded ? (
                    <>
                      <span style={{ ...ic, color: "var(--green)", border: "1px solid var(--green)", cursor: "default" }} aria-label={`${c.path} added`}><CheckCircle size={11} weight="fill" />{t("dotfiles.added")}</span>
                      <button onClick={() => void remove(c.id)} style={{ ...ic, color: "var(--red)" }} aria-label={`remove ${c.path}`}><X size={11} />{t("dotfiles.remove")}</button>
                    </>
                  ) : (
                    <button onClick={() => void add(c)} style={{ ...ic, color: "var(--accent)" }} aria-label={`add ${c.path}`}><FloppyDisk size={11} />Add</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
