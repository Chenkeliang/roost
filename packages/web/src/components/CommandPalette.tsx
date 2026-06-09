import { useEffect, useRef, useState } from "react";
import {
  FloppyDisk,
  DownloadSimple,
  GitDiff,
  ClockCounterClockwise,
  GearSix,
  Scan,
} from "@phosphor-icons/react";
import { Tile } from "./Tile";
import { Kbd } from "./Kbd";

interface Command {
  id: string;
  label: string;
  icon: React.ReactNode;
  tileColor: "coral" | "blue" | "amber" | "slate" | "violet" | "green";
  kbd?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onCapture: () => void;
  onLoad: () => void;
  onOpenDrift: () => void;
  onOpenTimeline: () => void;
  onOpenSettings: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onCapture,
  onLoad,
  onOpenDrift,
  onOpenTimeline,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allCommands: Command[] = [
    {
      id: "capture",
      label: "Capture",
      icon: <FloppyDisk size={16} />,
      tileColor: "coral",
      kbd: "⌘S",
      action: onCapture,
    },
    {
      id: "load",
      label: "Load (dry-run)",
      icon: <DownloadSimple size={16} />,
      tileColor: "blue",
      kbd: "⌘L",
      action: onLoad,
    },
    {
      id: "drift",
      label: "Open Drift",
      icon: <GitDiff size={16} />,
      tileColor: "amber",
      action: onOpenDrift,
    },
    {
      id: "timeline",
      label: "Open Timeline",
      icon: <ClockCounterClockwise size={16} />,
      tileColor: "violet",
      action: onOpenTimeline,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <GearSix size={16} />,
      tileColor: "slate",
      action: onOpenSettings,
    },
    {
      id: "scan",
      label: "Scan for secrets",
      icon: <Scan size={16} />,
      tileColor: "green",
      action: onClose,
    },
  ];

  const filtered = query
    ? allCommands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase())
      )
    : allCommands;

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[selected];
        if (cmd) {
          onClose();
          cmd.action();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, filtered, selected, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)",
          background: "#161619",
          border: "1px solid #313137",
          borderRadius: "var(--rc)",
          boxShadow:
            "0 24px 60px -20px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.05)",
          overflow: "hidden",
          animation: "roost-pop .14s cubic-bezier(.16,1,.3,1)",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands…"
          aria-label="Search commands"
          style={{
            width: "100%",
            border: 0,
            borderBottom: "1px solid var(--border-soft)",
            background: "transparent",
            color: "var(--text)",
            fontFamily: "var(--font)",
            fontSize: 15,
            padding: "15px 16px",
            outline: "none",
          }}
        />
        <ul
          role="listbox"
          style={{ padding: 6, margin: 0, listStyle: "none" }}
        >
          {filtered.length === 0 && (
            <li
              style={{ padding: "9px 10px", color: "var(--muted)", fontSize: 14 }}
            >
              No results for &ldquo;{query}&rdquo;
            </li>
          )}
          {filtered.map((cmd, i) => (
            <li
              key={cmd.id}
              role="option"
              aria-selected={i === selected}
              onClick={() => {
                onClose();
                cmd.action();
              }}
              onMouseEnter={() => setSelected(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: "var(--rr)",
                cursor: "pointer",
                background: i === selected ? "var(--surface-2)" : "transparent",
              }}
            >
              <Tile color={cmd.tileColor} size={28}>
                {cmd.icon}
              </Tile>
              <span style={{ fontSize: 14, flex: 1 }}>{cmd.label}</span>
              {cmd.kbd && (
                <div style={{ display: "flex", gap: 3 }}>
                  <Kbd>{cmd.kbd}</Kbd>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--border-soft)",
            color: "var(--faint)",
            fontSize: 12.5,
            display: "flex",
            gap: 14,
          }}
        >
          <span>
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> run
          </span>
          <span>
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
