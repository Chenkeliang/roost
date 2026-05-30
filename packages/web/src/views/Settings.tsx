import { useState, useEffect } from "react";
import {
  FolderOpen,
  Cube,
  ShieldCheck,
  ArrowSquareOut,
  Key,
} from "@phosphor-icons/react";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getHealth, getModules, type ModulesResponse } from "../api";

export function Settings() {
  const { t } = useT();
  const [modules, setModules] = useState<ModulesResponse | null>(null);
  const [repoDir, setRepoDir] = useState<string | null>(null);
  const [ageKey, setAgeKey] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([getHealth(), getModules()])
      .then(([health, mods]) => {
        if (health.status === "fulfilled") {
          setRepoDir(health.value.repoDir ?? null);
          setAgeKey(health.value.ageKey ?? null);
        }
        if (mods.status === "fulfilled") setModules(mods.value);
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
        {t("settings.heading")}
      </div>

      {/* ── Repo ── */}
      <div style={sectionLabel}>{t("settings.repository")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
        <div style={row}>
          <Key size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span style={{ color: "var(--muted)", minWidth: 80 }}>Age key</span>
          {loading ? (
            <Skeleton width={80} height={13} />
          ) : (
            <span
              style={{
                color: ageKey ? "var(--green)" : "var(--muted)",
                fontSize: 12,
              }}
            >
              {ageKey === null ? "—" : ageKey ? "present" : "not found"}
            </span>
          )}
        </div>
      </div>

      {/* ── Modules ── */}
      <div style={sectionLabel}>{t("settings.registeredModules")}</div>
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
      <div style={sectionLabel}>{t("settings.privacy")}</div>
      <div style={{ ...row, gap: 12 }}>
        <ShieldCheck size={16} weight="fill" style={{ color: "var(--green)", flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 540 }}>{t("settings.privacyTitle")}</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
            {t("settings.privacyBody")}
          </div>
        </div>
      </div>

      {/* ── Docs ── */}
      <div style={sectionLabel}>{t("settings.documentation")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          { label: "Documentation (使用文档)", href: "https://github.com/Chenkeliang/roost/tree/main/website" },
          { label: "Architecture & design", href: "https://github.com/Chenkeliang/roost/tree/main/docs/superpowers/specs" },
          { label: "Module development guide", href: "https://github.com/Chenkeliang/roost/blob/main/CONTRIBUTING.md" },
          { label: "Changelog", href: "https://github.com/Chenkeliang/roost/releases" },
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
