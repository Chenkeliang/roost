import { useState, useEffect, useCallback } from "react";
import { GitBranch, MagnifyingGlass, ArrowsClockwise, FloppyDisk, CheckCircle, XCircle } from "@phosphor-icons/react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getIndex, getDiscoverModule, testProjectRemote, addSelection } from "../api";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { index } = await getIndex();
        const p = index.projects;
        setManaged(p?.managed ?? 0);
        setAvailable(p?.available ?? true);
        setReason(p?.reason);
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
      showHud?.({ text: `Saved ${c.path}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Save failed", type: "error" });
    }
  }, [showHud]);

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
        <div style={card}>
          {shown.map((c) => (
            <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
              <span style={{ color: "var(--muted)", fontSize: 11, minWidth: 150, fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.remote ?? "no remote"}</span>
              {tested[c.id] === "ok" && <CheckCircle size={14} weight="fill" style={{ color: "var(--green)" }} />}
              {tested[c.id] === "fail" && <XCircle size={14} weight="fill" style={{ color: "var(--red)" }} />}
              <button onClick={() => void test(c)} disabled={!c.remote || tested[c.id] === "testing"} style={ic} aria-label={`test ${c.path}`}>Test</button>
              <button onClick={() => void save(c)} style={{ ...ic, color: "var(--accent)" }} aria-label={`save ${c.path}`}><FloppyDisk size={11} />Save</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
