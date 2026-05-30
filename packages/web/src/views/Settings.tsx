import { useState, useEffect } from "react";
import {
  FolderOpen,
  Cube,
  ShieldCheck,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import { Skeleton } from "../components/Skeleton";
import { getHealth, getModules, type ModulesResponse } from "../api";

export function Settings() {
  const [modules, setModules] = useState<ModulesResponse | null>(null);
  const [repoDir, setRepoDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([getHealth(), getModules()])
      .then(([_health, mods]) => {
        if (mods.status === "fulfilled") setModules(mods.value);
        // Repo path is not exposed by API yet; derive a placeholder from window.location
        setRepoDir(
          typeof window !== "undefined" && window.location.hostname !== "localhost"
            ? window.location.hostname
            : "~/.local/share/roost/repo  (served via localhost)",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const sectionLabel: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: ".08em",
    textTransform: "uppercase" as const,
    color: "var(--muted)",
    fontWeight: 600,
    marginBottom: 8,
    marginTop: 22,
  };

  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 14px",
    background: "var(--surface)",
    border: "1px solid var(--border-soft)",
    borderRadius: "var(--rr)",
    fontSize: 13,
  };

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

      {/* ── Repo ── */}
      <div style={sectionLabel}>Repository</div>
      <div style={row}>
        <FolderOpen size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <span style={{ color: "var(--muted)", minWidth: 80 }}>Repo path</span>
        {loading ? (
          <Skeleton width={260} height={13} />
        ) : (
          <span
            className="mono"
            style={{ color: "var(--text)", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {repoDir ?? "—"}
          </span>
        )}
      </div>

      {/* ── Modules ── */}
      <div style={sectionLabel}>Registered modules</div>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--rc)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          [1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-soft)" }}>
              <Skeleton width={140} height={13} />
            </div>
          ))
        ) : modules?.modules.length ? (
          modules.modules.map((m, idx) => (
            <div
              key={m}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderBottom:
                  idx < (modules.modules.length - 1)
                    ? "1px solid var(--border-soft)"
                    : "none",
                fontSize: 13,
              }}
            >
              <Cube size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
              <span className="mono" style={{ color: "var(--text)" }}>{m}</span>
            </div>
          ))
        ) : (
          <div style={{ padding: "11px 14px", color: "var(--muted)", fontSize: 13 }}>
            No modules registered. Is the server running?
          </div>
        )}
      </div>

      {/* ── Privacy ── */}
      <div style={sectionLabel}>Privacy</div>
      <div style={{ ...row, gap: 12 }}>
        <ShieldCheck size={16} weight="fill" style={{ color: "var(--green)", flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 540 }}>Local — no telemetry</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
            Roost runs entirely on your machine. No data is sent to any server.
            Your config repo is private git — you own it.
          </div>
        </div>
      </div>

      {/* ── Docs ── */}
      <div style={sectionLabel}>Documentation</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          { label: "Architecture & design", href: "https://github.com/your-org/roost/tree/main/docs/superpowers/specs" },
          { label: "Module development guide", href: "https://github.com/your-org/roost/tree/main/docs" },
          { label: "Changelog", href: "https://github.com/your-org/roost/releases" },
        ].map(({ label, href }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...row,
              color: "var(--text)",
              textDecoration: "none",
              justifyContent: "space-between",
            }}
          >
            <span>{label}</span>
            <ArrowSquareOut size={13} style={{ color: "var(--muted)" }} />
          </a>
        ))}
      </div>
    </div>
  );
}
