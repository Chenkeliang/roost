import { Kbd } from "./Kbd";

interface ActionBarProps {
  onApply?: () => void;
  onOpenPalette?: () => void;
}

export function ActionBar({ onApply, onOpenPalette }: ActionBarProps) {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: 44,
        background: "rgba(16,16,18,.92)",
        backdropFilter: "blur(8px)",
        borderTop: "1px solid var(--border-soft)",
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "0 20px",
        fontSize: 12,
        color: "var(--muted)",
        zIndex: 30,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Kbd>↵</Kbd>
        <button
          onClick={onApply}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            font: "inherit",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Apply
        </button>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={onOpenPalette}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            font: "inherit",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Actions
        </button>
        <Kbd>⌘K</Kbd>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Kbd>⌘Z</Kbd>
        <span>Undo</span>
      </span>
    </div>
  );
}
