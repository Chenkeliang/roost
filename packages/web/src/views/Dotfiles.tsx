import { useState, useEffect, useCallback } from "react";
import { File, MagnifyingGlass, ArrowsClockwise, FloppyDisk, Terminal, GitBranch, Pencil, CheckCircle, X } from "@phosphor-icons/react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { TabSwitch } from "../components/TabSwitch";
import { useT } from "../i18n";
import { getIndex, getDotfiles, getDiscoverModule, addSelection, removeSelection, getSelection } from "../api";
import { useFilePreview, PreviewCaret, FilePreviewPane } from "../components/FilePreview";

interface DotfilesProps { showHud?: (m: HudMessage) => void; }
type Category = "shell" | "git" | "editor" | "other";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

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

function SelectedDotfileRow({ p, captured, onRemove, t }: { p: string; captured: boolean; onRemove: (p: string) => void; t: (k: string) => string }) {
  const { preview, toggle } = useFilePreview(p, true);
  return (
    <div role="row" style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontSize: 14 }}>
        <CategoryIcon category={categorize(p)} />
        <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => void toggle()}>
          <PreviewCaret open={preview.open} />{p}
        </span>
        <span style={{ color: captured ? "var(--green)" : "var(--muted)", fontSize: 12.5 }}>{captured ? t("common.captured") : t("common.pending")}</span>
        <button onClick={() => void onRemove(p)} style={{ ...ic, color: "var(--red)" }} aria-label={`remove ${p}`}><X size={11} />{t("common.remove")}</button>
      </div>
      <FilePreviewPane preview={preview} />
    </div>
  );
}

function CandidateDotfileRow({ c, isAdded, isChecked, onToggleCheck, onAdd, onRemove, t }: {
  c: Candidate; isAdded: boolean; isChecked: boolean;
  onToggleCheck: (id: string) => void; onAdd: (c: Candidate) => void; onRemove: (id: string) => void; t: (k: string) => string;
}) {
  const { preview, toggle } = useFilePreview(c.path, true);
  return (
    <div role="row" style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontSize: 14 }}>
        <input type="checkbox" aria-label={`select ${c.path}`} checked={isChecked} onChange={() => onToggleCheck(c.id)} />
        <CategoryIcon category={categorize(c.path)} />
        <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => void toggle()}>
          <PreviewCaret open={preview.open} />{c.path}
        </span>
        {isAdded ? (
          <>
            <span style={{ ...ic, color: "var(--green)", border: "1px solid var(--green)", cursor: "default" }} aria-label={`${c.path} added`}><CheckCircle size={11} weight="fill" />{t("common.added")}</span>
            <button onClick={() => void onRemove(c.id)} style={{ ...ic, color: "var(--red)" }} aria-label={`remove ${c.path}`}><X size={11} />{t("common.remove")}</button>
          </>
        ) : (
          <button onClick={() => void onAdd(c)} style={{ ...ic, color: "var(--accent)" }} aria-label={`add ${c.path}`}><FloppyDisk size={11} />{t("common.add")}</button>
        )}
      </div>
      <FilePreviewPane preview={preview} />
    </div>
  );
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
  const [customPath, setCustomPath] = useState("");
  const [tab, setTab] = useState<"selected" | "discovered">("selected");

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
      setTab("discovered"); // jump to the discovered tab after a scan
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

  // Add an arbitrary path (e.g. an app's config under ~/Library/Application
  // Support) — chezmoi manages any path, so this just selects it like a dotfile.
  const addCustomPath = useCallback(async () => {
    const p = customPath.trim();
    if (!p) return;
    try {
      await addSelection("dotfiles", p);
      setSelected((s) => new Set(s).add(p));
      setCustomPath("");
      showHud?.({ text: `Added ${p}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Add failed", type: "error" });
    }
  }, [customPath, showHud]);

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
      <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        {t("dotfiles.explainer")} {t("common.selected")}: {selected.size} · {t("common.managed")}: {managed?.length ?? 0}.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <TabSwitch
          active={tab}
          onChange={(id) => setTab(id as "selected" | "discovered")}
          tabs={[
            { id: "selected", label: t("common.selectedTab"), count: selected.size },
            { id: "discovered", label: t("common.discoveredTab"), count: cands === null ? undefined : newCands.length },
          ]}
        />
        <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
          <MagnifyingGlass size={14} style={{ position: "absolute", left: 9, top: 8, color: "var(--muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("common.filterDotfiles")}
            style={{ width: "100%", appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 14, padding: "6px 10px 6px 28px", borderRadius: 6, boxSizing: "border-box" }}
          />
        </div>
        <button onClick={() => void scan()} disabled={scanning} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 14 }}>
          {scanning ? <ArrowsClockwise size={14} /> : <MagnifyingGlass size={14} />}
          {scanning ? t("dotfiles.scanning") : t("dotfiles.scan")}
        </button>
      </div>

      {tab === "selected" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <input
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void addCustomPath(); }}
              placeholder={t("dotfiles.customPathPlaceholder")}
              style={{ flex: 1, maxWidth: 560, appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 13.5, padding: "6px 10px", borderRadius: 6, boxSizing: "border-box" }}
            />
            <button onClick={() => void addCustomPath()} disabled={!customPath.trim()} style={{ ...ic, color: "var(--accent)", padding: "6px 12px", fontSize: 14, opacity: customPath.trim() ? 1 : 0.5 }}>
              <FloppyDisk size={14} />{t("dotfiles.addPath")}
            </button>
          </div>

          {selectedList.length === 0 ? (
            <EmptyState icon={<File size={24} />} title={selected.size > 0 ? t("dotfiles.emptyMatchTitle") : t("dotfiles.emptyTitle")} subtitle={selected.size > 0 ? t("dotfiles.emptyMatchSubtitle") : t("dotfiles.emptySubtitle")} />
          ) : (
            <div style={card}>
              {selectedList.map((p) => <SelectedDotfileRow key={p} p={p} captured={(managed ?? []).some((m) => p.endsWith(m) || m.endsWith(p))} onRemove={remove} t={t} />)}
            </div>
          )}
        </>
      )}

      {tab === "discovered" && (
        cands === null ? (
          <EmptyState icon={<File size={24} />} title={t("dotfiles.emptyTitle")} subtitle={t("dotfiles.emptySubtitle")} />
        ) : newCands.length === 0 ? (
          <EmptyState icon={<CheckCircle size={24} />} title={t("common.allAddedTitle")} subtitle={t("common.allAddedSubtitle")} />
        ) : (
          <div>
            {checked.size > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    aria-label="select all discovered"
                    checked={checked.size > 0 && newCands.every((c) => checked.has(c.id))}
                    onChange={(e) => setChecked(e.target.checked ? new Set(newCands.map((c) => c.id)) : new Set())}
                  />
                  {checked.size} {t("common.selected")}
                </label>
                <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => void batch("add")} disabled={busy} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}>
                    <FloppyDisk size={11} />{t("common.addSelected")}
                  </button>
                  <button onClick={() => void batch("remove")} disabled={busy} style={{ ...ic, color: "var(--red)", borderColor: "var(--red)" }}>
                    <X size={11} />{t("common.removeSelected")}
                  </button>
                </span>
              </div>
            )}
            <div style={card}>
              {newCands.map((c) => <CandidateDotfileRow key={c.id} c={c} isAdded={selected.has(c.id)} isChecked={checked.has(c.id)} onToggleCheck={toggleCheck} onAdd={add} onRemove={remove} t={t} />)}
            </div>
          </div>
        )
      )}
    </div>
  );
}
