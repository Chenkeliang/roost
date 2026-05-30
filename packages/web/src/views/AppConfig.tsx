import { useState, useEffect, useCallback } from "react";
import { AppWindow, Sliders, MagnifyingGlass, ArrowsClockwise, FloppyDisk } from "@phosphor-icons/react";
import type { Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { getIndex, getAppConfig, getDiscoverModule, addSelection } from "../api";

interface AppConfigProps { showHud?: (m: HudMessage) => void; }

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 11, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

// Candidate ids are `domain:<name>`; managed domains are bare names. Strip to compare.
function candidateDomain(id: string): string {
  return id.startsWith("domain:") ? id.slice("domain:".length) : id;
}

export function AppConfig({ showHud }: AppConfigProps) {
  const [available, setAvailable] = useState(true);
  const [managed, setManaged] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    const [, ac] = await Promise.all([getIndex(), getAppConfig()]);
    setAvailable(ac.available);
    setManaged(ac.managed);
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
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Scan failed", type: "error" });
    } finally {
      setScanning(false);
    }
  }, [showHud]);

  const add = useCallback(async (c: Candidate) => {
    try {
      await addSelection("appconfig", c.id);
      await load();
      showHud?.({ text: `Added ${candidateDomain(c.id)}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Add failed", type: "error" });
    }
  }, [load, showHud]);

  const shown = (managed ?? []).filter((d) => d.toLowerCase().includes(filter.toLowerCase()));
  const newCands = (cands ?? []).filter((c) => !(managed ?? []).includes(candidateDomain(c.id)));

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
          title="defaults unavailable"
          subtitle="App preferences are read with macOS `defaults` — unavailable on this machine."
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        App preference domains Roost backs up &amp; restores on a new Mac. Managed: {managed?.length ?? 0} · scanning for more is on-demand.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <MagnifyingGlass size={14} style={{ position: "absolute", left: 9, top: 8, color: "var(--muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter domains…"
            style={{ width: "100%", appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 13, padding: "6px 10px 6px 28px", borderRadius: 6, boxSizing: "border-box" }}
          />
        </div>
        <button onClick={() => void scan()} disabled={scanning} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 13 }}>
          {scanning ? <ArrowsClockwise size={14} /> : <MagnifyingGlass size={14} />}
          {scanning ? "Scanning…" : "Scan app preferences"}
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<Sliders size={24} />}
          title={managed && managed.length > 0 ? "Nothing here" : "No app config managed yet"}
          subtitle={managed && managed.length > 0 ? "No domains match this filter." : "Scan to find app preference domains on this Mac."}
        />
      ) : (
        <div style={card}>
          {shown.map((d) => (
            <div key={d} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
              <AppWindow size={14} style={{ color: "var(--muted)" }} />
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d}</span>
            </div>
          ))}
        </div>
      )}

      {cands !== null && newCands.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 8px" }}>Discovered ({newCands.length})</div>
          <div style={card}>
            {newCands.map((c) => {
              const domain = candidateDomain(c.id);
              return (
                <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                  <AppWindow size={14} style={{ color: "var(--muted)" }} />
                  <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{domain}</span>
                  <button onClick={() => void add(c)} style={{ ...ic, color: "var(--accent)" }} aria-label={`add ${domain}`}><FloppyDisk size={11} />Add</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
