import { useState } from "react";
import { useT } from "../i18n";
import type { HudMessage } from "../components/Hud";
import { AiBackup } from "./AiBackup";
import { Skills } from "./Skills";

export function AiTools({ showHud }: { showHud?: (m: HudMessage) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<"backup" | "skills">("backup");
  const tabBtn = (active: boolean): React.CSSProperties => ({
    appearance: "none",
    fontFamily: "var(--font)",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    padding: "6px 14px",
    borderRadius: 8,
    cursor: "pointer",
    background: active ? "var(--raise)" : "transparent",
    border: active ? "1px solid var(--border)" : "1px solid transparent",
    color: active ? "var(--text)" : "var(--muted)",
  });
  return (
    <div>
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          gap: 6,
          marginBottom: 14,
        }}
      >
        <button onClick={() => setTab("backup")} style={tabBtn(tab === "backup")}>
          {t("ai.tab.backup")}
        </button>
        <button onClick={() => setTab("skills")} style={tabBtn(tab === "skills")}>
          {t("ai.tab.skills")}
        </button>
      </div>
      {tab === "backup" ? <AiBackup showHud={showHud} /> : <Skills />}
    </div>
  );
}
