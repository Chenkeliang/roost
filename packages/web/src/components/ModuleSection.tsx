import { useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import type { DriftItem } from "@roost/shared";
import { StatusDot } from "./StatusDot";
import { ItemRow } from "./ItemRow";

interface ModuleSectionProps {
  name: string;
  status: string;
  items?: DriftItem[];
  icon: React.ReactNode;
  note?: string;
}

export function ModuleSection({ name, status, items, icon, note }: ModuleSectionProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border-soft)",
      }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          appearance: "none",
          background: "none",
          border: "none",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 14px",
          fontWeight: 540,
          cursor: "pointer",
          color: "var(--text)",
          fontFamily: "var(--font)",
          fontSize: 14,
          textAlign: "left",
        }}
      >
        <CaretRight
          size={12}
          style={{
            color: "var(--muted)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform .15s",
            flexShrink: 0,
          }}
        />
        {icon}
        <span>{name}</span>
        {items !== undefined && (
          <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>
            {items.length}
          </span>
        )}
        {note && (
          <span
            style={{
              marginLeft: "auto",
              color: "var(--amber)",
              fontSize: 12,
              fontFamily: "var(--mono)",
            }}
          >
            {note}
          </span>
        )}
        {!note && (
          <span style={{ marginLeft: "auto" }}>
            <StatusDot status={status} />
          </span>
        )}
      </button>

      {expanded && items && items.length > 0 && (
        <div style={{ padding: "2px 8px 8px" }}>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              id={item.id}
              module={name}
              status={item.state}
            />
          ))}
        </div>
      )}
    </div>
  );
}
