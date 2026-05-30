import { useState, useEffect, useCallback } from "react";
import { Package, Cube, AppStoreLogo, Storefront, DownloadSimple } from "@phosphor-icons/react";
import type { HudMessage } from "../components/Hud";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getIndex, getBrewfile, addSelection, postCapture, type BrewfileResponse } from "../api";

interface PackagesProps { showHud?: (m: HudMessage) => void; }

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 11, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

function Section({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
        {icon}
        <span>{title}</span>
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>({items.length})</span>
      </div>
      <div style={card}>
        {items.map((name) => (
          <div key={name} role="row" style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
            <span className="mono">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Packages({ showHud }: PackagesProps) {
  const { t } = useT();
  const [managed, setManaged] = useState<number | null>(null);
  const [brewfile, setBrewfile] = useState<BrewfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const [{ index }, bf] = await Promise.all([getIndex(), getBrewfile()]);
    setManaged(index.packages?.managed ?? 0);
    setBrewfile(bf);
  }, []);

  useEffect(() => {
    void (async () => {
      try { await load(); } finally { setLoading(false); }
    })();
  }, [load]);

  const importFromMac = useCallback(async () => {
    setImporting(true);
    try {
      await addSelection("packages", "Brewfile");
      await postCapture();
      await load();
      showHud?.({ text: "Imported packages from this Mac", type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Import failed", type: "error" });
    } finally {
      setImporting(false);
    }
  }, [load, showHud]);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 720 }}>
        {t("packages.explainer")} Managed: {loading ? "…" : managed}.
      </p>

      {loading ? (
        <div style={card}>{[1, 2, 3].map((i) => <div key={i} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}><Skeleton width={300} height={14} /></div>)}</div>
      ) : !brewfile?.available ? (
        <EmptyState
          icon={<Package size={24} />}
          title={t("packages.noBrewTitle")}
          subtitle={t("packages.noBrewSubtitle")}
        />
      ) : !brewfile.exists ? (
        <EmptyState
          icon={<Package size={24} />}
          title={t("packages.emptyTitle")}
          subtitle={t("packages.emptySubtitle")}
          action={
            <button onClick={() => void importFromMac()} disabled={importing} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 13 }}>
              <DownloadSimple size={14} />
              {importing ? t("packages.importing") : t("packages.import")}
            </button>
          }
        />
      ) : (
        <>
          <Section icon={<Package size={15} />} title="Formulae" items={brewfile.entries.formulae} />
          <Section icon={<Cube size={15} />} title="Casks" items={brewfile.entries.casks} />
          <Section icon={<AppStoreLogo size={15} />} title="App Store" items={brewfile.entries.mas} />
          <Section icon={<Storefront size={15} />} title="Taps" items={brewfile.entries.taps} />
        </>
      )}
    </div>
  );
}
