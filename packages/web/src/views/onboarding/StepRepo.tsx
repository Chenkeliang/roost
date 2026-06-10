import { useState } from "react";
import { postInit, postClone } from "../../api";
import type { HudMessage } from "../../components/Hud";

const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 13, padding: "7px 10px", borderRadius: 8, cursor: "pointer" };
const primary: React.CSSProperties = { ...ic, background: "var(--accent)", color: "#0b0b0d", borderColor: "var(--accent)", fontWeight: 600 };

export function StepRepo({ t, showHud, onDone }: { t: (k: string) => string; showHud?: (m: HudMessage) => void; onDone: () => void }) {
  const [mode, setMode] = useState<"create" | "clone">("create");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setErr(null);
    try { await postInit(remoteUrl.trim() || undefined); showHud?.({ text: t("onboard.repo.created"), type: "success" }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const clone = async () => {
    if (!cloneUrl.trim()) { setErr(t("onboard.repo.errNoUrl")); return; }
    setBusy(true); setErr(null);
    try {
      const r = await postClone(cloneUrl.trim());
      if (r.ok) { showHud?.({ text: t("onboard.repo.cloned"), type: "success" }); onDone(); }
      else setErr(r.error ?? t("onboard.repo.cloneFailed"));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const tab = (active: boolean): React.CSSProperties => ({ ...ic, fontWeight: active ? 600 : 400, borderColor: active ? "var(--accent)" : "var(--border)" });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setMode("create")} aria-pressed={mode === "create"} style={tab(mode === "create")}>{t("onboard.repo.createTab")}</button>
        <button onClick={() => setMode("clone")} aria-pressed={mode === "clone"} style={tab(mode === "clone")}>{t("onboard.repo.cloneTab")}</button>
      </div>

      <div style={{ display: mode === "create" ? undefined : "none" }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>{t("onboard.repo.createHelp")}</p>
        <input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder={t("onboard.repo.remoteOptional")} style={{ ...ic, width: "100%", marginBottom: 8 }} />
        <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 12px" }}>{t("onboard.repo.githubHint")}</p>
        <button onClick={() => void create()} disabled={busy} style={primary}>{busy ? "…" : t("onboard.repo.createBtn")}</button>
      </div>

      <div style={{ display: mode === "clone" ? undefined : "none" }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>{t("onboard.repo.cloneHelp")}</p>
        <input value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} placeholder={t("onboard.repo.cloneUrl")} style={{ ...ic, width: "100%", marginBottom: 12 }} />
        <button onClick={() => void clone()} disabled={busy} style={primary}>{busy ? "…" : t("onboard.repo.cloneBtn")}</button>
      </div>

      {err && <div style={{ color: "var(--accent)", fontSize: 12.5, marginTop: 10 }}>{err}</div>}
    </div>
  );
}
