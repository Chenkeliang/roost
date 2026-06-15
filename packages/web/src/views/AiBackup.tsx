import { useState, useEffect, useCallback } from "react";
import { Lock, Prohibit } from "@phosphor-icons/react";
import type { HudMessage } from "../components/Hud";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getAiToolsCatalog, addSelection, removeSelection } from "../api";
import type { AiCatalogTool, AiCatalogPath } from "../api";
import { useFilePreview, PreviewCaret, FilePreviewPane } from "../components/FilePreview";

export interface AiBackupProps { showHud?: (m: HudMessage) => void }

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-soft)",
  borderRadius: "var(--rc)",
  overflow: "hidden",
  marginBottom: 16,
};
const ic: React.CSSProperties = {
  appearance: "none",
  border: "1px solid var(--border)",
  background: "var(--raise)",
  color: "var(--muted)",
  fontFamily: "var(--font)",
  fontSize: 12.5,
  padding: "3px 8px",
  borderRadius: 6,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

function KindChip({ kind }: { kind: AiCatalogPath["kind"] }) {
  const { t } = useT();
  return (
    <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "var(--raise)", color: "var(--muted)", border: "1px solid var(--border-soft)", fontFamily: "var(--font)" }}>
      {t(`ai.kind.${kind}`)}
    </span>
  );
}

function EncryptChip() {
  const { t } = useT();
  return (
    <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "var(--raise)", color: "var(--muted)", border: "1px solid var(--border-soft)", fontFamily: "var(--font)", display: "inline-flex", alignItems: "center", gap: 3 }}>
      <Lock size={10} weight="bold" />
      {t("ai.encrypted")}
    </span>
  );
}

function PathRow({
  p,
  onAdd,
  onRemove,
}: {
  p: AiCatalogPath;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const { t } = useT();
  const { state } = p;

  // Hooks must be called unconditionally (before any early return).
  const previewable = state !== "never" && !p.encrypt;
  const { preview, toggle } = useFilePreview(p.path, previewable);

  if (state === "missing") return null;

  const dimStyle: React.CSSProperties = state === "dotfiles" || state === "never"
    ? { opacity: 0.55 }
    : {};

  const fileName = p.path.split("/").pop() ?? p.path;

  return (
    <div role="row" style={{ borderBottom: "1px solid var(--border-soft)", ...dimStyle }}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        fontSize: 13.5,
      }}
    >
      <span
        className="mono"
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: previewable ? "pointer" : "default" }}
        title={p.path}
        onClick={() => void toggle()}
      >
        {previewable && <PreviewCaret open={preview.open} />}
        {fileName}
      </span>
      <KindChip kind={p.kind} />
      {p.encrypt && <EncryptChip />}
      {state === "available" && (
        <button onClick={() => onAdd(p.path)} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}>
          {t("common.add")}
        </button>
      )}
      {state === "selected" && (
        <>
          <span style={{ ...ic, color: "var(--green)", borderColor: "var(--green)", cursor: "default" }}>{t("ai.state.backedUp")}</span>
          <button onClick={() => onRemove(p.path)} style={{ ...ic, color: "var(--red)" }}>{t("common.remove")}</button>
        </>
      )}
      {state === "pending" && (
        <>
          <span style={{ ...ic, color: "var(--amber)", borderColor: "var(--amber)", cursor: "default" }}>{t("ai.state.pending")}</span>
          <button onClick={() => onRemove(p.path)} style={{ ...ic, color: "var(--red)" }}>{t("common.remove")}</button>
        </>
      )}
      {state === "dotfiles" && (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.managedByDotfiles")}</span>
      )}
      {state === "never" && (
        <span style={{ fontSize: 12, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Prohibit size={12} />
          {t("ai.neverNote")}
        </span>
      )}
    </div>
    <FilePreviewPane preview={preview} />
    </div>
  );
}

export function AiBackup({ showHud }: AiBackupProps) {
  const { t } = useT();
  const [tools, setTools] = useState<AiCatalogTool[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { tools: ts } = await getAiToolsCatalog();
    setTools(ts);
  }, []);

  useEffect(() => {
    void (async () => {
      try { await load(); } finally { setLoading(false); }
    })();
  }, [load]);

  const handleAdd = useCallback(async (absPath: string) => {
    try {
      await addSelection("aitools", absPath);
      await load();
      showHud?.({ text: `Added ${absPath.split("/").pop() ?? absPath}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Add failed", type: "error" });
    }
  }, [load, showHud]);

  const handleRemove = useCallback(async (absPath: string) => {
    try {
      await removeSelection("aitools", absPath);
      await load();
      showHud?.({ text: `Removed ${absPath.split("/").pop() ?? absPath}`, type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Remove failed", type: "error" });
    }
  }, [load, showHud]);

  if (loading) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <div style={card}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-soft)" }}>
              <Skeleton width={320} height={14} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const visibleTools = (tools ?? []).filter((t) => t.paths.some((p) => p.state !== "missing"));

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.55, margin: "0 0 16px", maxWidth: 720 }}>
        {t("ai.tagline")}
      </p>
      {visibleTools.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>{t("ai.empty")}</p>
      ) : (
        visibleTools.map((tool) => {
          const visiblePaths = tool.paths.filter((p) => p.state !== "missing");
          const managedCount = tool.paths.filter((p) => p.state === "selected" || p.state === "pending").length;
          const availableCount = tool.paths.filter((p) => p.state === "available").length;
          return (
            <div key={tool.id} style={card}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{tool.label}</span>
                {managedCount > 0 && (
                  <span style={{ fontSize: 12, color: "var(--green)" }}>{managedCount} {t("common.managed")}</span>
                )}
                {availableCount > 0 && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{availableCount} {t("common.discovered")}</span>
                )}
              </div>
              {visiblePaths.map((p) => (
                <PathRow key={p.path} p={p} onAdd={handleAdd} onRemove={handleRemove} />
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
