import { useEffect } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";

export interface HudMessage {
  text: string;
  type?: "success" | "error";
}

interface HudProps {
  message: HudMessage | null;
  onDismiss: () => void;
}

export function Hud({ message, onDismiss }: HudProps) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 2200);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;

  const isError = message.type === "error";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 62,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: "#1b1b1f",
        border: `1px solid ${isError ? "var(--red)" : "#313137"}`,
        borderRadius: 999,
        padding: "7px 14px 7px 8px",
        fontSize: 13,
        boxShadow: "0 14px 30px -12px rgba(0,0,0,.6)",
        zIndex: 40,
        animation: "roost-hud .18s cubic-bezier(.16,1,.3,1)",
        whiteSpace: "nowrap",
      }}
    >
      {isError ? (
        <CheckCircle size={16} style={{ color: "var(--red)" }} />
      ) : (
        <CheckCircle size={16} style={{ color: "var(--green)" }} weight="fill" />
      )}
      <span style={{ color: isError ? "var(--red)" : "var(--text)" }}>
        {message.text}
      </span>
    </div>
  );
}
