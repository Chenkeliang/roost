import { useState, useEffect, useCallback } from "react";
import { Package, Box, Store, Download, Search, RefreshCw, Save, CircleCheck, X } from "lucide-react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { TabSwitch } from "../components/TabSwitch";
import { useT } from "../i18n";
import { getIndex, getBrewfile, getSelection, getDiscoverModule, addSelection, removeSelection, installPackages, getPackageStates, type BrewfileResponse, type PackageState } from "../api";

interface PackagesProps { showHud?: (m: HudMessage) => void; }

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

const SENTINEL = "Brewfile";
function kindOf(id: string): string { return id.slice(0, id.indexOf(":")); }
function valOf(id: string): string { return id.slice(id.indexOf(":") + 1); }
function KindIcon({ kind }: { kind: string }) {
  const c = { color: "var(--muted)" };
  if (kind === "cask") return <Box size={14} style={c} />;
  if (kind === "mas") return <Store size={14} style={c} />;
  if (kind === "tap") return <Store size={14} style={c} />;
  return <Package size={14} style={c} />;
}
const STATE_COLOR: Record<PackageState, string> = { installed: "var(--green)", outdated: "var(--amber)", missing: "var(--red)" };
function StateBadge({ state, label }: { state: PackageState; label: string }) {
  const color = STATE_COLOR[state];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color, fontSize: 12.5, whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

// Repo Brewfile entries → per-package ids (for migrating the legacy sentinel).
function brewfileToIds(e: BrewfileResponse["entries"]): string[] {
  return [
    ...e.taps.map((t) => `tap:${t}`),
    ...e.formulae.map((f) => `brew:${f}`),
    ...e.casks.map((c) => `cask:${c}`),
    ...e.mas.map((m) => `mas:${m}`),
  ];
}

export function Packages({ showHud }: PackagesProps) {
  const { t } = useT();
  const [managed, setManaged] = useState<number | null>(null);
  const [brewAvailable, setBrewAvailable] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [legacy, setLegacy] = useState(false); // selection still has the whole-Brewfile sentinel
  const [brewfile, setBrewfile] = useState<BrewfileResponse | null>(null);
  const [states, setStates] = useState<Record<string, PackageState>>({});
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"selected" | "discovered">("selected");

  const load = useCallback(async () => {
    const [{ index }, bf, sel] = await Promise.all([getIndex(), getBrewfile(), getSelection()]);
    setManaged(index.packages?.managed ?? 0);
    setBrewAvailable(bf.available);
    setBrewfile(bf);
    const pkgs = sel.modules.packages ?? [];
    setSelected(new Set(pkgs.filter((id) => id !== SENTINEL && id.includes(":"))));
    setLegacy(pkgs.includes(SENTINEL));
    // Per-package install states are best-effort — a failure here must not break the page.
    try { const r = await getPackageStates(); setStates(r.states); } catch { /* leave states empty */ }
  }, []);

  useEffect(() => {
    void (async () => { try { await load(); } finally { setLoading(false); } })();
  }, [load]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const { candidates } = await getDiscoverModule("packages");
      setCands(candidates.packages ?? []);
      setTab("discovered");
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Scan failed", type: "error" });
    } finally { setScanning(false); }
  }, [showHud]);

  const add = useCallback(async (id: string) => {
    try { await addSelection("packages", id); setSelected((s) => new Set(s).add(id)); }
    catch (e) { showHud?.({ text: e instanceof Error ? e.message : "Add failed", type: "error" }); }
  }, [showHud]);

  const remove = useCallback(async (id: string) => {
    try { await removeSelection("packages", id); setSelected((s) => { const n = new Set(s); n.delete(id); return n; }); }
    catch (e) { showHud?.({ text: e instanceof Error ? e.message : "Remove failed", type: "error" }); }
  }, [showHud]);

  const toggleCheck = useCallback((id: string) => {
    setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const batch = useCallback(async (action: "add" | "remove", ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const id of ids) { if (action === "add") await addSelection("packages", id); else await removeSelection("packages", id); }
      setSelected((s) => { const n = new Set(s); for (const id of ids) { if (action === "add") n.add(id); else n.delete(id); } return n; });
      setChecked(new Set());
    } catch (e) { showHud?.({ text: e instanceof Error ? e.message : "Batch failed", type: "error" }); }
    finally { setBusy(false); }
  }, [showHud]);

  // Migrate the legacy whole-Brewfile sentinel → per-package ids (default all).
  const expandLegacy = useCallback(async () => {
    if (!brewfile) return;
    setBusy(true);
    try {
      const ids = brewfileToIds(brewfile.entries);
      for (const id of ids) await addSelection("packages", id);
      await removeSelection("packages", SENTINEL);
      setSelected(new Set(ids));
      setLegacy(false);
      showHud?.({ text: `Expanded to ${ids.length} packages`, type: "success" });
    } catch (e) { showHud?.({ text: e instanceof Error ? e.message : "Expand failed", type: "error" }); }
    finally { setBusy(false); }
  }, [brewfile, showHud]);

  // Install a chosen subset on THIS machine (follower selective install).
  const install = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const r = await installPackages(ids);
      showHud?.({ text: r.ok ? `Installed ${r.installed} package(s)` : (r.output || "Install failed"), type: r.ok ? "success" : "error" });
    } catch (e) { showHud?.({ text: e instanceof Error ? e.message : "Install failed", type: "error" }); }
    finally { setBusy(false); }
  }, [showHud]);

  const selectedList = [...selected].sort();
  const anyOutdated = selectedList.some((id) => states[id] === "outdated");
  const newCands = (cands ?? []).filter((c) => !selected.has(c.id));

  if (loading) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <div style={card}>{[1, 2, 3].map((i) => <div key={i} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}><Skeleton width={300} height={14} /></div>)}</div>
      </div>
    );
  }

  if (!brewAvailable) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <EmptyState icon={<Package size={24} />} title={t("packages.noBrewTitle")} subtitle={t("packages.noBrewSubtitle")} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        {t("packages.explainer")} {t("common.selected")}: {selected.size} · {t("common.managed")}: {managed ?? 0}.
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
        <button onClick={() => void scan()} disabled={scanning} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 14, marginLeft: "auto" }}>
          {scanning ? <RefreshCw size={14} /> : <Search size={14} />}
          {scanning ? t("packages.importing") : t("packages.scan")}
        </button>
      </div>

      {tab === "selected" && (
        <>
          {legacy && (
            <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid var(--amber)", borderRadius: "var(--rr)", marginBottom: 14, fontSize: 13.5 }}>
              <span style={{ flex: 1, color: "var(--muted)" }}>{t("packages.legacyBanner")}</span>
              <button onClick={() => void expandLegacy()} disabled={busy} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}>{t("packages.expand")}</button>
            </div>
          )}

          {selectedList.length === 0 ? (
            <EmptyState
              icon={<Package size={24} />}
              title={t("packages.emptyTitle")}
              subtitle={t("packages.emptySubtitle")}
              action={<button onClick={() => void scan()} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 14 }}><Search size={14} />{t("packages.scan")}</button>}
            />
          ) : (
            <>
              {anyOutdated && (
                <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid var(--amber)", borderRadius: "var(--rr)", marginBottom: 10, fontSize: 13.5, color: "var(--muted)" }}>
                  <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--amber)", flexShrink: 0 }} />
                  {t("packages.state.outdatedSummary")}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" aria-label="select all selected" checked={checked.size > 0 && selectedList.every((id) => checked.has(id))} onChange={(e) => setChecked(e.target.checked ? new Set(selectedList) : new Set())} />
                  {checked.size > 0 ? `${checked.size} ${t("common.selected")}` : `${selectedList.length}`}
                </label>
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                  <button onClick={() => void install(checked.size > 0 ? [...checked] : selectedList)} disabled={busy} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}>
                    <Download size={11} />{checked.size > 0 ? t("packages.installSelected") : t("packages.installAll")}
                  </button>
                  {checked.size > 0 && (
                    <button onClick={() => void batch("remove", [...checked])} disabled={busy} style={{ ...ic, color: "var(--red)", borderColor: "var(--red)" }}><X size={11} />{t("common.removeSelected")}</button>
                  )}
                </span>
              </div>
              <div style={card}>
                {selectedList.map((id) => (
                  <div key={id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14 }}>
                    <input type="checkbox" aria-label={`select ${id}`} checked={checked.has(id)} onChange={() => toggleCheck(id)} />
                    <KindIcon kind={kindOf(id)} />
                    <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{valOf(id)}</span>
                    {states[id] && <StateBadge state={states[id]} label={t(`packages.state.${states[id]}`)} />}
                    <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{kindOf(id)}</span>
                    <button onClick={() => void remove(id)} style={{ ...ic, color: "var(--red)" }} aria-label={`remove ${id}`}><X size={11} />{t("common.remove")}</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === "discovered" && (
        cands === null ? (
          <EmptyState icon={<Package size={24} />} title={t("packages.emptyTitle")} subtitle={t("packages.emptySubtitle")} />
        ) : newCands.length === 0 ? (
          <EmptyState icon={<CircleCheck size={24} />} title={t("common.allAddedTitle")} subtitle={t("common.allAddedSubtitle")} />
        ) : (
          <div>
            {checked.size > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" aria-label="select all discovered" checked={checked.size > 0 && newCands.every((c) => checked.has(c.id))} onChange={(e) => setChecked(e.target.checked ? new Set(newCands.map((c) => c.id)) : new Set())} />
                  {checked.size} {t("common.selected")}
                </label>
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                  <button onClick={() => void batch("add", [...checked])} disabled={busy} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}><Save size={11} />{t("common.addSelected")}</button>
                </span>
              </div>
            )}
            <div style={card}>
              {newCands.map((c) => (
                <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14 }}>
                  <input type="checkbox" aria-label={`select ${c.id}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} />
                  <KindIcon kind={kindOf(c.id)} />
                  <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.note?.startsWith("mas") ? c.note : valOf(c.id)}</span>
                  <button onClick={() => void add(c.id)} style={{ ...ic, color: "var(--accent)" }} aria-label={`add ${c.id}`}><Save size={11} />{t("common.add")}</button>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
