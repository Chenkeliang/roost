import { useState, useRef } from "react";
import { Trash } from "@phosphor-icons/react";
import type { SkillTarget } from "../api";
import { saveSkillsTargets } from "../api";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12.5, padding: "5px 9px", borderRadius: 6, cursor: "pointer" };
const BUILTIN = new Set(["claude", "codex", "gemini", "opencode"]);
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function TargetManager({ initial, t, onClose, onSaved }: {
  initial: SkillTarget[]; t: (k: string) => string; onClose: () => void; onSaved: () => void;
}) {
  const [targets, setTargets] = useState<SkillTarget[]>(initial);
  const targetsRef = useRef<SkillTarget[]>(initial);
  const [name, setName] = useState(""); const [dir, setDir] = useState("");
  const [method, setMethod] = useState<"symlink" | "copy">("symlink");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const add = () => {
    const id = slug(name);
    if (!id || !dir.trim()) { setErr(t("skills.targets.name")); return; }
    if (targetsRef.current.some((x) => x.id === id)) { setErr(`${id} exists`); return; }
    const next = [...targetsRef.current, { id, path: dir.trim(), label: name.trim() }];
    targetsRef.current = next;
    setTargets(next);
    setName(""); setDir(""); setErr(null);
  };
  const save = async () => {
    setBusy(true);
    try { await saveSkillsTargets(targetsRef.current); onSaved(); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div style={{ ...card, maxWidth: 520, width: "100%", padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t("skills.targets.manage")}</div>
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
          {targets.map((tg) => (
            <div key={tg.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5 }}>
              <span style={{ width: 110 }}>{tg.label}</span>
              <span className="mono" style={{ flex: 1, color: "var(--muted)" }}>{tg.path}</span>
              {BUILTIN.has(tg.id)
                ? <span style={{ color: "var(--muted)", fontSize: 11 }}>{t("skills.targets.builtin")}</span>
                : <button aria-label={`remove target ${tg.id}`} onClick={() => { const next = targetsRef.current.filter((x) => x.id !== tg.id); targetsRef.current = next; setTargets(next); }} style={{ ...ic, border: 0, color: "var(--accent)" }}><Trash size={14} /></button>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("skills.targets.name")} style={{ ...ic, width: 120 }} />
          <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder={t("skills.targets.dir")} style={{ ...ic, flex: 1 }} />
          <select value={method} onChange={(e) => setMethod(e.target.value as "symlink" | "copy")} style={{ ...ic }}>
            <option value="symlink">{t("skills.method.symlink")}</option>
            <option value="copy">{t("skills.method.copy")}</option>
          </select>
          <button onClick={add} style={{ ...ic }}>{t("skills.targets.add")}</button>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 12px" }}>{t("skills.targets.removeNote")}</p>
        {err && <div style={{ color: "var(--accent)", fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ ...ic, padding: "6px 12px" }}>{t("skills.resolve.cancel")}</button>
          <button onClick={() => void save()} disabled={busy} style={{ ...ic, padding: "6px 12px", color: "#fff", background: "var(--accent)", borderColor: "var(--accent)" }}>{t("skills.targets.save")}</button>
        </div>
      </div>
    </div>
  );
}
