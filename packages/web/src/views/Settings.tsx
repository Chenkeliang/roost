import { GearSix } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState";

export function Settings() {
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
        Settings
      </div>
      <EmptyState
        icon={<GearSix size={24} weight="duotone" />}
        title="Settings coming in Phase P4"
        subtitle="Repository, profiles, age encryption, module & plugin config"
      />
      <div
        style={{
          marginTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {["Repository path", "Profiles", "Encryption (age)", "Modules & plugins", "Doctor / diagnostics"].map((item) => (
          <div
            key={item}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "11px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--rr)",
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            <span>{item}</span>
            <span style={{ fontSize: 11, background: "var(--raise)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px" }}>P4</span>
          </div>
        ))}
      </div>
    </div>
  );
}
