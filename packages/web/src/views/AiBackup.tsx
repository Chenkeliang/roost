import { useState, useEffect, useCallback } from "react";
import { Lock, Prohibit, CaretRight, CaretDown, FileText, GearSix, Plugs, Plus, CheckCircle } from "@phosphor-icons/react";
import type { HudMessage } from "../components/Hud";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getAiToolsCatalog, addSelection, removeSelection, addAiCustom } from "../api";
import type { AiCatalogTool, AiCatalogPath } from "../api";

export interface AiBackupProps { showHud?: (m: HudMessage) => void }

function KindIcon({ kind, state }: { kind: AiCatalogPath["kind"]; state: AiCatalogPath["state"] }) {
  const c = "var(--muted)";
  if (state === "never") return <Prohibit size={14} style={{ color: c, flexShrink: 0 }} />;
  if (kind === "memory") return <FileText size={14} style={{ color: c, flexShrink: 0 }} />;
  if (kind === "mcp") return <Plugs size={14} style={{ color: c, flexShrink: 0 }} />;
  if (kind === "data") return <FileText size={14} style={{ color: c, flexShrink: 0 }} />;
  return <GearSix size={14} style={{ color: c, flexShrink: 0 }} />;
}

function Dots({ done, total }: { done: number; total: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i < done ? "var(--green)" : "var(--border)" }} />
      ))}
    </span>
  );
}

function ToolCard({ tool, onAdd, onRemove }: { tool: AiCatalogTool; onAdd: (p: string) => void; onRemove: (p: string) => void }) {
  const { t } = useT();
  const visible = tool.paths.filter((p) => p.state !== "missing");
  const dotfilesOnly = visible.length > 0 && visible.every((p) => p.state === "dotfiles");
  const backable = visible.filter((p) => p.state !== "never" && p.state !== "dotfiles");
  const done = backable.filter((p) => p.state === "selected").length;
  const total = backable.length;
  const [open, setOpen] = useState(false);

  // All paths missing → tool not installed; render a dimmed, non-interactive row
  // so the "All supported" toggle actually reveals undetected catalog entries.
  if (visible.length === 0) {
    return (
      <div style={{ borderBottom: "1px solid var(--border-soft)", opacity: 0.45 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 2px" }}>
          <CaretRight size={13} style={{ color: "var(--muted)" }} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{tool.label}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{t("ai.notInstalled")}</span>
        </div>
      </div>
    );
  }

  const stateEl = (p: AiCatalogPath) => {
    if (p.state === "selected") return <span style={{ color: "var(--green)", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle size={13} />{t("ai.state.backedUp")}</span>;
    if (p.state === "pending") return <span style={{ color: "var(--amber)", fontSize: 11.5 }}>{t("ai.state.pending")}</span>;
    if (p.state === "never") return <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{t("ai.state.never")}</span>;
    if (p.state === "dotfiles") return <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{t("ai.managedByDotfiles")}</span>;
    return <button onClick={() => onAdd(p.path)} style={{ appearance: "none", border: "none", background: "none", color: "var(--accent)", fontSize: 11.5, cursor: "pointer", fontFamily: "var(--font)" }}>{t("ai.state.add")}</button>;
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 2px", cursor: "pointer" }}>
        {open ? <CaretDown size={13} style={{ color: "var(--muted)" }} /> : <CaretRight size={13} style={{ color: "var(--muted)" }} />}
        <span style={{ fontSize: 13, fontWeight: 500 }}>{tool.label}</span>
        {dotfilesOnly
          ? <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{t("ai.managedByDotfiles")}</span>
          : <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 9 }}><Dots done={done} total={total} /><span style={{ fontSize: 11, color: done === total && total > 0 ? "var(--green)" : "var(--muted)", minWidth: 26, textAlign: "right" }}>{done}/{total}</span></span>}
      </div>
      {open && (
        <div style={{ marginLeft: 9, borderLeft: "1px solid var(--border-soft)" }}>
          {visible.map((p) => (
            <div key={p.path} role="row" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 2px 9px 18px", borderTop: "1px solid var(--border-soft)", fontSize: 12.5, opacity: p.state === "never" || p.state === "dotfiles" ? 0.5 : 1 }}>
              <KindIcon kind={p.kind} state={p.state} />
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 400, color: "var(--text)" }}>{p.path.split("/").pop()}</span>
              {p.encrypt && <Lock size={12} style={{ color: "var(--amber)", flexShrink: 0 }} />}
              {p.state === "selected" || p.state === "pending"
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{stateEl(p)}<button onClick={() => onRemove(p.path)} style={{ appearance: "none", border: "none", background: "none", color: "var(--muted)", fontSize: 11.5, cursor: "pointer" }}>{t("common.remove")}</button></span>
                : stateEl(p)}
            </div>
          ))}
          {backable.some((p) => p.state === "available") && (
            <div style={{ padding: "8px 2px 12px 18px", textAlign: "right" }}>
              <button onClick={() => backable.filter((p) => p.state === "available").forEach((p) => onAdd(p.path))} style={{ appearance: "none", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e", fontWeight: 600, fontSize: 11.5, padding: "4px 11px", borderRadius: 7, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}><Plus size={12} weight="bold" />{t("ai.addAll")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AiBackup({ showHud }: AiBackupProps) {
  const { t } = useT();
  const [tools, setTools] = useState<AiCatalogTool[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [customLabel, setCustomLabel] = useState("");

  const load = useCallback(async () => {
    try { const { tools: ts } = await getAiToolsCatalog(); setTools(ts); } catch { setTools([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onAdd = useCallback(async (p: string) => { await addSelection("aitools", p); showHud?.({ text: t("common.added"), type: "success" }); void load(); }, [load, showHud, t]);
  const onRemove = useCallback(async (p: string) => { await removeSelection("aitools", p); void load(); }, [load]);
  const onSaveCustom = useCallback(async () => {
    if (!customPath.trim()) return;
    await addAiCustom({ path: customPath.trim(), label: customLabel.trim() || undefined });
    setAdding(false); setCustomPath(""); setCustomLabel(""); void load();
  }, [customPath, customLabel, load]);

  if (tools === null) return <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}><Skeleton height={48} /><Skeleton height={48} /></div>;

  const detected = tools.filter((tl) => tl.paths.some((p) => p.state !== "missing"));
  const undetected = tools.filter((tl) => tl.paths.every((p) => p.state === "missing"));
  const list = showAll ? [...detected, ...undetected] : detected;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0 10px" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>{t("ai.tagline")}</span>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
          <button onClick={() => setShowAll(false)} style={{ appearance: "none", border: "none", fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font)", background: !showAll ? "var(--raise)" : "transparent", color: !showAll ? "var(--text)" : "var(--muted)" }}>{t("ai.detected")} {detected.length}</button>
          <button onClick={() => setShowAll(true)} style={{ appearance: "none", border: "none", fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font)", background: showAll ? "var(--raise)" : "transparent", color: showAll ? "var(--text)" : "var(--muted)" }}>{t("ai.all")} {tools.length}</button>
        </div>
        <button onClick={() => setAdding(!adding)} style={{ appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontSize: 11.5, padding: "4px 10px", borderRadius: 7, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font)" }}><Plus size={13} />{t("ai.addTool")}</button>
      </div>
      {adding && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder={t("ai.custom.labelPh")} style={{ width: 140, appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--font)", fontSize: 12.5, padding: "6px 10px", borderRadius: 6 }} />
          <input value={customPath} onChange={(e) => setCustomPath(e.target.value)} placeholder={t("ai.custom.pathPh")} style={{ flex: 1, appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12.5, padding: "6px 10px", borderRadius: 6 }} />
          <button onClick={() => void onSaveCustom()} disabled={!customPath.trim()} style={{ appearance: "none", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e", fontWeight: 600, fontSize: 12.5, padding: "6px 12px", borderRadius: 6, cursor: "pointer", opacity: customPath.trim() ? 1 : 0.5 }}>{t("ai.custom.save")}</button>
        </div>
      )}
      <div>
        {list.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13.5 }}>{t("ai.empty")}</p>}
        {list.map((tl) => <ToolCard key={tl.id} tool={tl} onAdd={onAdd} onRemove={onRemove} />)}
      </div>
    </div>
  );
}
