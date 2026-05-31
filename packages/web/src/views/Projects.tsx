import { useState, useEffect, useCallback } from "react";
import { GitBranch, MagnifyingGlass, ArrowsClockwise, FloppyDisk, CheckCircle, XCircle, X } from "@phosphor-icons/react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getIndex, getDiscoverModule, testProjectRemote, addSelection, removeSelection, getSelection } from "../api";

interface ProjectsProps { showHud?: (m: HudMessage) => void; }
type TestState = Record<string, "ok" | "fail" | "testing">;

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 11, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

export function Projects({ showHud }: ProjectsProps) {
  const { t } = useT();
  const [managed, setManaged] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string | undefined>();
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [host, setHost] = useState<string>("all");
  const [tested, setTested] = useState<TestState>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [{ index }, sel] = await Promise.all([getIndex(), getSelection()]);
        const p = index.projects;
        setManaged(p?.managed ?? 0);
        setAvailable(p?.available ?? true);
        setReason(p?.reason);
        setSaved(new Set(sel.modules.projects ?? []));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const { candidates } = await getDiscoverModule("projects");
      setCands(candidates.projects ?? []);
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Scan failed", type: "error" });
    } finally {
      setScanning(false);
    }
  }, [showHud]);

  const test = useCallback(async (c: Candidate) => {
    if (!c.remote) return;
    setTested((t) => ({ ...t, [c.id]: "testing" }));
    try {
      const r = await testProjectRemote(c.remote);
      setTested((t) => ({ ...t, [c.id]: r.reachable ? "ok" : "fail" }));
      showHud?.({ text: `${c.host}: ${r.message}`, type: r.reachable ? "success" : "error" });
    } catch {
      setTested((t) => ({ ...t, [c.id]: "fail" }));
    }
  }, [showHud]);

  const save = useCallback(async (c: Candidate) => {
    try {
      await addSelection("projects", c.id);
      setManaged((m) => (m ?? 0) + 1);
      setSaved((s) => new Set(s).add(c.id));
      showHud?.({ text: `Saved ${c.path}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Save failed", type: "error" });
    }
  }, [showHud]);

  const remove = useCallback(async (id: string) => {
    try {
      await removeSelection("projects", id);
      setManaged((m) => Math.max(0, (m ?? 1) - 1));
      setSaved((s) => { const n = new Set(s); n.delete(id); return n; });
      showHud?.({ text: `Removed ${id}`, type: "success" });
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
        if (action === "add") await addSelection("projects", id);
        else await removeSelection("projects", id);
      }
      setSaved((s) => {
        const n = new Set(s);
        for (const id of ids) { if (action === "add") n.add(id); else n.delete(id); }
        return n;
      });
      setChecked(new Set());
      showHud?.({ text: `${action === "add" ? "Saved" : "Removed"} ${ids.length} project(s)`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Batch failed", type: "error" });
    } finally {
      setBusy(false);
    }
  }, [checked, showHud]);

  const hosts = cands ? [...new Set(cands.map((c) => c.host ?? "no-remote"))].sort() : [];
  const shown = (cands ?? []).filter((c) => host === "all" || (c.host ?? "no-remote") === host);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        {t("projects.explainer")} Managed: {loading ? "…" : managed} · scanning your disk is on-demand.
      </p>

      {!available && (
        <div role="alert" style={{ padding: "10px 14px", background: "rgba(242,85,90,.1)", border: "1px solid var(--red)", borderRadius: "var(--rr)", color: "var(--red)", fontSize: 13, marginBottom: 14 }}>
          {reason ?? "git not available"}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button onClick={() => void scan()} disabled={scanning || !available} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 13 }}>
          {scanning ? <ArrowsClockwise size={14} /> : <MagnifyingGlass size={14} />}
          {scanning ? t("projects.scanning") : t("projects.scan")}
        </button>
      </div>

      {cands && cands.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {["all", ...hosts].map((h) => (
            <button key={h} onClick={() => setHost(h)} style={{ ...ic, borderRadius: 999, ...(host === h ? { background: "rgba(255,99,99,.13)", borderColor: "var(--accent)", color: "var(--accent)" } : {}) }}>
              <span>{h}</span>
              <span style={{ opacity: 0.6 }}>{h !== "all" ? ` (${cands.filter((c) => (c.host ?? "no-remote") === h).length})` : ` (${cands.length})`}</span>
            </button>
          ))}
        </div>
      )}

      {scanning ? (
        <div style={card}>{[1, 2, 3].map((i) => <div key={i} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}><Skeleton width={300} height={14} /></div>)}</div>
      ) : cands === null ? (
        <EmptyState icon={<GitBranch size={24} />} title={t("projects.noScanTitle")} subtitle={t("projects.noScanSubtitle")} />
      ) : shown.length === 0 ? (
        <EmptyState icon={<GitBranch size={24} />} title={t("projects.emptyTitle")} subtitle={t("projects.emptySubtitle")} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                aria-label="select all shown"
                checked={checked.size > 0 && shown.every((c) => checked.has(c.id))}
                onChange={(e) => setChecked(e.target.checked ? new Set(shown.map((c) => c.id)) : new Set())}
              />
              {shown.length} {t("common.shownItems")}
            </label>
            {checked.size > 0 && (
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{checked.size} {t("common.selected")}</span>
                <button onClick={() => void batch("add")} disabled={busy} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}>
                  <FloppyDisk size={11} />{t("common.addSelected")}
                </button>
                <button onClick={() => void batch("remove")} disabled={busy} style={{ ...ic, color: "var(--red)", borderColor: "var(--red)" }}>
                  <X size={11} />{t("common.removeSelected")}
                </button>
              </span>
            )}
          </div>
          <div style={card}>
            {shown.map((c) => (
              <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                <input type="checkbox" aria-label={`select ${c.path}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} />
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
                <span style={{ color: "var(--muted)", fontSize: 11, minWidth: 150, fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.remote ?? "no remote"}</span>
                {tested[c.id] === "ok" && <CheckCircle size={14} weight="fill" style={{ color: "var(--green)" }} />}
                {tested[c.id] === "fail" && <XCircle size={14} weight="fill" style={{ color: "var(--red)" }} />}
                <button onClick={() => void test(c)} disabled={!c.remote || tested[c.id] === "testing"} style={ic} aria-label={`test ${c.path}`}>Test</button>
                {saved.has(c.id) ? (
                  <>
                    <span style={{ ...ic, color: "var(--green)", border: "1px solid var(--green)", cursor: "default" }} aria-label={`${c.path} saved`}><CheckCircle size={11} weight="fill" />{t("projects.saved")}</span>
                    <button onClick={() => void remove(c.id)} style={{ ...ic, color: "var(--red)" }} aria-label={`remove ${c.path}`}><X size={11} />{t("common.remove")}</button>
                  </>
                ) : (
                  <button onClick={() => void save(c)} style={{ ...ic, color: "var(--accent)" }} aria-label={`save ${c.path}`}><FloppyDisk size={11} />Save</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
