import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        gap: 8,
        padding: 34,
        background: "var(--surface)",
        border: "1px dashed var(--border)",
        borderRadius: "var(--rc)",
        color: "var(--muted)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "var(--raise)",
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12 }}>{subtitle}</div>}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
