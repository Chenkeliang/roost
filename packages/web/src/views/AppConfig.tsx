import { useState, useEffect, useCallback } from "react";
import { AppWindow, Sliders, MagnifyingGlass, ArrowsClockwise, FloppyDisk, CheckCircle, X } from "@phosphor-icons/react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { TabSwitch } from "../components/TabSwitch";
import { useT } from "../i18n";
import { getIndex, getAppConfig, getDiscoverModule, addSelection, removeSelection, getSelection } from "../api";

interface AppConfigProps { showHud?: (m: HudMessage) => void; }

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

// Candidate ids are `domain:<name>`; managed domains are bare names. Strip to compare.
function candidateDomain(id: string): string {
  return id.startsWith("domain:") ? id.slice("domain:".length) : id;
}

export function AppConfig({ showHud }: AppConfigProps) {
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
  const [tab, setTab] = useState<"selected" | "discovered">("selected");

  const load = useCallback(async () => {
    const [, ac, sel] = await Promise.all([getIndex(), getAppConfig(), getSelection()]);
    setAvailable(ac.available);
    setManaged(ac.managed);
    setSelected(new Set(sel.modules.appconfig ?? []));
  }, []);

  useEffect(() => {
    void (async () => {
      try { await load(); } finally { setLoading(false); }
    })();
  }, [load]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const { candidates } = await getDiscoverModule("appconfig");
      setCands(candidates.appconfig ?? []);
      setTab("discovered");
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Scan failed", type: "error" });
    } finally {
      setScanning(false);
    }
  }, [showHud]);

  const add = useCallback(async (c: Candidate) => {
    try {
      await addSelection("appconfig", c.id);
      setSelected((s) => new Set(s).add(c.id));
      showHud?.({ text: `Added ${candidateDomain(c.id)}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Add failed", type: "error" });
    }
  }, [showHud]);

  const remove = useCallback(async (id: string) => {
    try {
      await removeSelection("appconfig", id);
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
      showHud?.({ text: `Removed ${candidateDomain(id)}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Remove failed", type: "error" });
    }
  }, [showHud]);

  const toggleCheck = useCallback((id: string) => {
    setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const batch = useCallback(async (action: "add" | "remove") => {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const id of ids) {
        if (action === "add") await addSelection("appconfig", id);
        else await removeSelection("appconfig", id);
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

  // Primary list = what you've SELECTED (selection.yaml), shown persistently.
  const selectedList = [...selected].filter((id) => candidateDomain(id).toLowerCase().includes(filter.toLowerCase())).sort();
  const newCands = (cands ?? [])
    .filter((c) => !selected.has(c.id))
    .filter((c) => candidateDomain(c.id).toLowerCase().includes(filter.toLowerCase()));

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
          icon={<Sliders size={24} />}
          title={t("appconfig.unavailableTitle")}
          subtitle={t("appconfig.unavailableSubtitle")}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        {t("appconfig.explainer")} {t("common.selected")}: {selected.size} · {t("common.managed")}: {managed?.length ?? 0}.
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
        <div style={{ position: "relative", flex: 1, maxWidth: 260 }}>
          <MagnifyingGlass size={14} style={{ position: "absolute", left: 9, top: 8, color: "var(--muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("common.filterDomains")}
            style={{ width: "100%", appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 14, padding: "6px 10px 6px 28px", borderRadius: 6, boxSizing: "border-box" }}
          />
        </div>
        <button onClick={() => void scan()} disabled={scanning} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 14 }}>
          {scanning ? <ArrowsClockwise size={14} /> : <MagnifyingGlass size={14} />}
          {scanning ? t("appconfig.scanning") : t("appconfig.scan")}
        </button>
      </div>

      {tab === "selected" && (
        selectedList.length === 0 ? (
          <EmptyState
            icon={<Sliders size={24} />}
            title={selected.size > 0 ? t("appconfig.emptyMatchTitle") : t("appconfig.emptyTitle")}
            subtitle={selected.size > 0 ? t("appconfig.emptyMatchSubtitle") : t("appconfig.emptySubtitle")}
          />
        ) : (
          <div style={card}>
            {selectedList.map((id) => {
              const domain = candidateDomain(id);
              const captured = (managed ?? []).includes(domain);
              return (
                <div key={id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14 }}>
                  <AppWindow size={14} style={{ color: "var(--muted)" }} />
                  <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{domain}</span>
                  <span style={{ color: captured ? "var(--green)" : "var(--muted)", fontSize: 12.5 }}>{captured ? t("common.captured") : t("common.pending")}</span>
                  <button onClick={() => void remove(id)} style={{ ...ic, color: "var(--red)" }} aria-label={`remove ${domain}`}><X size={11} />{t("common.remove")}</button>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === "discovered" && (
        cands === null ? (
          <EmptyState icon={<Sliders size={24} />} title={t("appconfig.emptyTitle")} subtitle={t("appconfig.emptySubtitle")} />
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
            {newCands.map((c) => {
              const domain = candidateDomain(c.id);
              const isAdded = selected.has(c.id);
              return (
                <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14 }}>
                  <input type="checkbox" aria-label={`select ${domain}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} />
                  <AppWindow size={14} style={{ color: "var(--muted)" }} />
                  <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{domain}</span>
                  {isAdded ? (
                    <>
                      <span style={{ ...ic, color: "var(--green)", border: "1px solid var(--green)", cursor: "default" }} aria-label={`${domain} added`}><CheckCircle size={11} weight="fill" />{t("common.added")}</span>
                      <button onClick={() => void remove(c.id)} style={{ ...ic, color: "var(--red)" }} aria-label={`remove ${domain}`}><X size={11} />{t("common.remove")}</button>
                    </>
                  ) : (
                    <button onClick={() => void add(c)} style={{ ...ic, color: "var(--accent)" }} aria-label={`add ${domain}`}><FloppyDisk size={11} />{t("common.add")}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )
      )}
    </div>
  );
}
