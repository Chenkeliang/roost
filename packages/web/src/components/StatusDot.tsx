interface StatusDotProps {
  status: "synced" | "drift" | "conflict" | "unmanaged" | string;
  size?: number;
}

const colorMap: Record<string, string> = {
  synced: "var(--green)",
  drift: "var(--amber)",
  conflict: "var(--red)",
  unmanaged: "var(--faint)",
};

export function StatusDot({ status, size = 8 }: StatusDotProps) {
  const color = colorMap[status] ?? "var(--faint)";
  return (
    <span
      role="status"
      aria-label={status}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "999px",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}
