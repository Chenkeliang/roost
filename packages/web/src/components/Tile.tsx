import type { ReactNode } from "react";

type TileColor = "blue" | "slate" | "amber" | "coral" | "violet" | "green" | "default";

interface TileProps {
  color?: TileColor;
  size?: number;
  children: ReactNode;
}

const colorStyles: Record<TileColor, React.CSSProperties> = {
  blue: { background: "rgba(127,176,232,.16)", color: "var(--blue)" },
  slate: { background: "rgba(148,163,184,.15)", color: "#A7B0BE" },
  amber: { background: "rgba(251,191,36,.15)", color: "var(--amber)" },
  coral: { background: "rgba(255,99,99,.16)", color: "var(--accent)" },
  violet: { background: "rgba(169,155,224,.16)", color: "var(--violet)" },
  green: { background: "rgba(52,211,153,.16)", color: "var(--green)" },
  default: { background: "var(--raise)", color: "var(--text)" },
};

export function Tile({ color = "default", size = 30, children }: TileProps) {
  return (
    <span
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: "var(--rt)",
        flexShrink: 0,
        ...colorStyles[color],
      }}
    >
      {children}
    </span>
  );
}
