import type { ReactNode } from "react";

interface KbdProps {
  children: ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return (
    <kbd
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        background: "var(--raise)",
        border: "1px solid var(--border)",
        borderBottomWidth: 2,
        borderRadius: "var(--rk)",
        padding: "1px 6px",
        color: "var(--muted)",
        minWidth: 18,
        display: "inline-block",
        textAlign: "center",
      }}
    >
      {children}
    </kbd>
  );
}
