import { ClockCounterClockwise } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState";

export function Timeline() {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 600,
          marginBottom: 14,
        }}
      >
        Timeline
      </div>
      <EmptyState
        icon={<ClockCounterClockwise size={24} weight="duotone" />}
        title="Timeline coming in Phase P4"
        subtitle="Snapshot history, preview, and rollback will be available here"
      />
      <div
        style={{
          marginTop: 16,
          padding: "12px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--rc)",
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        Timeline shows all snapshots in chronological order with diff preview and dry-run rollback. Planned for Phase P4.
      </div>
    </div>
  );
}
