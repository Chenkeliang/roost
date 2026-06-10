import { useEffect, useState } from "react";
import { getDiscover, addSelection } from "../../api";
import type { Candidate } from "../../api";
import type { HudMessage } from "../../components/Hud";

const SECRET_MODULES = new Set(["env"]); // off by default; selecting one triggers lazy keygen at capture

export function StepSelect({ t, showHud, onDone }: { t: (k: string) => string; showHud?: (m: HudMessage) => void; onDone: () => void }) {
  const [groups, setGroups] = useState<Record<string, Candidate[]> | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getDiscover()
      .then((d) => {
        setGroups(d.candidates);
        setChosen(new Set(Object.entries(d.candidates).filter(([m, c]) => c.length > 0 && !SECRET_MODULES.has(m)).map(([m]) => m)));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const toggle = (m: string) => setChosen((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  const confirm = async () => {
    if (!groups) return;
    setBusy(true); setErr(null);
    try {
      for (const m of chosen) for (const c of groups[m] ?? []) await addSelection(m, c.id);
      showHud?.({ text: t("onboard.select.added"), type: "success" });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (err && !groups) return <div style={{ color: "var(--accent)", fontSize: 13 }}>{err}</div>;
  if (!groups) return <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("onboard.select.loading")}</div>;

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>{t("onboard.select.help")}</p>
      <div style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden", marginBottom: 12 }}>
        {Object.keys(groups).map((m) => (
          <label key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={chosen.has(m)} onChange={() => toggle(m)} />
            <span style={{ minWidth: 120, textTransform: "capitalize" }}>{m}</span>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{(groups[m] ?? []).length} {t("onboard.select.found")}</span>
            {SECRET_MODULES.has(m) && <span style={{ color: "var(--amber)", fontSize: 12 }}>{t("onboard.select.secretNote")}</span>}
          </label>
        ))}
      </div>
      {err && <div style={{ color: "var(--accent)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <button onClick={() => void confirm()} disabled={busy} style={{ appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: busy ? "default" : "pointer" }}>{busy ? "…" : t("onboard.select.confirm")}</button>
    </div>
  );
}
