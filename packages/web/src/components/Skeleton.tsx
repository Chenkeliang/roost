interface SkeletonProps {
  width?: string | number;
  height?: number;
  style?: React.CSSProperties;
}

export function Skeleton({ width = "100%", height = 14, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width,
        height,
        borderRadius: 6,
        background: "linear-gradient(90deg,#1c1c20,#26262b,#1c1c20)",
        backgroundSize: "200% 100%",
        animation: "roost-shimmer 1.2s linear infinite",
        ...style,
      }}
    />
  );
}
