import { useState } from "react";
import { FileCode, Package, SlidersHorizontal, GitBranch, Lock, Scan, CircleCheck } from "lucide-react";
import { Tile } from "./Tile";
import { StatusDot } from "./StatusDot";

interface ItemRowProps {
  id: string;
  module: string;
  status: string;
  encrypted?: boolean;
  selected?: boolean;
}

function getModuleIcon(module: string) {
  switch (module) {
    case "dotfiles":
      return { icon: <FileCode size={13} />, color: "slate" as const };
    case "packages":
      return { icon: <Package size={13} />, color: "amber" as const };
    case "appconfig":
      return { icon: <SlidersHorizontal size={13} />, color: "blue" as const };
    case "projects":
      return { icon: <GitBranch size={13} />, color: "violet" as const };
    case "secrets":
      return { icon: <Scan size={13} />, color: "coral" as const };
    default:
      return { icon: <CircleCheck size={13} />, color: "default" as const };
  }
}

export function ItemRow({ id, module, status, encrypted, selected }: ItemRowProps) {
  const [hovered, setHovered] = useState(false);
  const { icon, color } = getModuleIcon(module);

  return (
    <div
      role="row"
      aria-selected={selected}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: "var(--row)",
        padding: "0 8px",
        borderRadius: "var(--rr)",
        position: "relative",
        background:
          selected || hovered ? "var(--surface-2)" : "transparent",
        transition: "background .12s",
        cursor: "default",
      }}
    >
      {selected && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 7,
            bottom: 7,
            width: 2,
            borderRadius: 2,
            background: "var(--accent)",
          }}
        />
      )}
      {encrypted ? (
        <Tile color="coral" size={24}>
          <Lock size={13} />
        </Tile>
      ) : (
        <Tile color={color} size={24}>
          {icon}
        </Tile>
      )}
      <span className="mono" style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {id}
      </span>
      <StatusDot status={status} />
      <span
        style={{
          color: encrypted ? "var(--accent)" : "var(--muted)",
          fontSize: 13,
          fontFamily: "var(--mono)",
          marginLeft: 4,
        }}
      >
        {encrypted ? "encrypted" : "track"}
      </span>
      {(hovered || selected) && (
        <div style={{ display: "flex", gap: 4 }}>
          <button
            style={{
              appearance: "none",
              border: "1px solid var(--border)",
              background: "var(--raise)",
              color: "var(--muted)",
              fontFamily: "var(--font)",
              fontSize: 12.5,
              padding: "3px 8px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            diff
          </button>
          <button
            style={{
              appearance: "none",
              border: "1px solid var(--border)",
              background: "var(--raise)",
              color: "var(--muted)",
              fontFamily: "var(--font)",
              fontSize: 12.5,
              padding: "3px 8px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            unmanage
          </button>
        </div>
      )}
    </div>
  );
}
