// Extracted from Drift.tsx — reusable unified-diff renderer with +/- line coloring.

interface DiffLineProps {
  line: string;
}

function DiffLine({ line }: DiffLineProps) {
  let color = "var(--muted)";
  let bg = "transparent";
  if (line.startsWith("+") && !line.startsWith("+++")) {
    color = "var(--green)";
    bg = "rgba(52,211,153,.07)";
  } else if (line.startsWith("-") && !line.startsWith("---")) {
    color = "var(--red)";
    bg = "rgba(242,85,90,.07)";
  } else if (line.startsWith("@@")) {
    color = "var(--blue)";
  }
  return (
    <div
      style={{
        color,
        background: bg,
        paddingLeft: 8,
        paddingRight: 8,
        whiteSpace: "pre",
        minHeight: "1.4em",
        fontFamily: "var(--mono)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {line || " "}
    </div>
  );
}

export interface DiffPaneProps {
  text: string | null;
  loading?: boolean;
}

export function DiffPane({ text, loading = false }: DiffPaneProps) {
  if (loading) {
    return (
      <div style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (!text || !text.trim()) {
    return (
      <div
        style={{
          padding: "10px 14px",
          color: "var(--muted)",
          fontSize: 13,
          fontStyle: "italic",
        }}
      >
        No diff text available.
      </div>
    );
  }

  const lines = text.split("\n");
  return (
    <div
      style={{
        background: "var(--surface-2)",
        borderTop: "1px solid var(--border-soft)",
        overflowX: "auto",
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 0",
          fontFamily: "var(--mono)",
          fontSize: 13,
        }}
      >
        {lines.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </pre>
    </div>
  );
}
