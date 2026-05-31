export interface TabDef {
  id: string;
  label: string;
  count?: number;
}

// A small segmented two-(or more)-tab switcher used by module pages to split
// "selected" vs "discovered" lists. Raycast-flavoured pills.
export function TabSwitch({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "var(--raise)", border: "1px solid var(--border-soft)", borderRadius: 999 }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-pressed={on}
            style={{
              appearance: "none",
              border: 0,
              cursor: "pointer",
              fontFamily: "var(--font)",
              fontSize: 12.5,
              fontWeight: 540,
              padding: "5px 12px",
              borderRadius: 999,
              background: on ? "var(--surface)" : "transparent",
              color: on ? "var(--text)" : "var(--muted)",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.25)" : "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {t.label}
            {t.count !== undefined && (
              <span style={{ fontSize: 11, color: on ? "var(--muted)" : "var(--border)", fontFamily: "var(--mono)" }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
