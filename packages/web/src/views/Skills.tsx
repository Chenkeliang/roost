import { useState, useEffect, useCallback } from "react";
import { Stack, MagnifyingGlass, ArrowsClockwise, FloppyDisk, CheckCircle, Link as LinkIcon, Warning, LinkBreak, Copy, Circle } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { TabSwitch } from "../components/TabSwitch";
import { useT } from "../i18n";
import { getSkills, discoverSkills, captureSkills, toggleSkill, linkSkills, saveSkillsConfig, resolveSkillConflict } from "../api";
import type { SkillsView, SkillRow, SkillMethod } from "../api";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };
const cellPad: React.CSSProperties = { padding: "9px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 14, verticalAlign: "middle" };

type Candidate = { id: string; note?: string };

// Per-(skill,target) status badge derived from effective state + links.
function targetStatus(row: SkillRow, targetId: string): "linked" | "copy" | "conflict" | "broken" | "off" {
  const wanted = row.effective.enabled && row.effective.targets.includes(targetId);
  const link = row.links.find((l) => l.target === targetId);
  if (!wanted) return "off";
  if (row.conflicts?.includes(targetId)) return "conflict"; // real non-Roost dir occupies the dest
  if (!link) return "broken"; // wanted but no link on disk yet
  if (link.kind === "copy") return "copy";
  return "linked";
}

// One indicator per (skill, IDE) cell — replaces the old checkbox + badge pair.
// Click toggles on/off; a conflict opens the resolve dialog instead.
function CellToggle({
  row,
  targetLabel,
  status,
  busy,
  t,
  onToggle,
  onResolve,
}: {
  row: SkillRow;
  targetLabel: string;
  status: ReturnType<typeof targetStatus>;
  busy: boolean;
  t: (k: string) => string;
  onToggle: (next: boolean) => void;
  onResolve: () => void;
}) {
  const on = status !== "off";
  const ICON = 20;
  const btn: React.CSSProperties = {
    width: 34,
    height: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: 0,
    background: "transparent",
    borderRadius: 8,
    cursor: busy ? "default" : "pointer",
  };
  if (status === "conflict") {
    return (
      <button disabled={busy} title={t("skills.conflict")} aria-label={t("skills.resolve.action")} onClick={onResolve} style={btn}>
        <Warning size={ICON} weight="fill" style={{ color: "#f0b352" }} />
      </button>
    );
  }
  const glyph =
    status === "linked" ? (
      <CheckCircle size={ICON} weight="fill" style={{ color: "var(--accent)" }} />
    ) : status === "copy" ? (
      <Copy size={ICON} style={{ color: "var(--accent)" }} />
    ) : status === "broken" ? (
      <LinkBreak size={ICON} style={{ color: "var(--red)" }} />
    ) : (
      <Circle size={ICON} style={{ color: "var(--border)" }} />
    );
  const titleKey =
    status === "linked" ? "skills.enabled" : status === "copy" ? "skills.method.copy" : status === "broken" ? "skills.dangling" : "skills.disabled";
  return (
    <button
      disabled={busy || !row.effective.enabled}
      aria-label={`${row.name} · ${targetLabel}`}
      title={t(titleKey)}
      onClick={() => onToggle(!on)}
      style={{ ...btn, opacity: row.effective.enabled ? 1 : 0.4 }}
    >
      {glyph}
    </button>
  );
}

export function Skills() {
  const { t } = useT();
  const [view, setView] = useState<SkillsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"managed" | "discovered">("managed");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ skill: string; target: string } | null>(null);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    const v = await getSkills();
    setView(v);
  }, []);

  useEffect(() => {
    void (async () => {
      try { await load(); } catch (e) { setError(e instanceof Error ? e.message : "Failed to load skills"); } finally { setLoading(false); }
    })();
  }, [load]);

  const refetch = useCallback(async () => {
    try { await load(); } catch (e) { setError(e instanceof Error ? e.message : "Failed to load skills"); }
  }, [load]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const { candidates } = await discoverSkills();
      setCands(candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, []);

  const onTab = useCallback((id: string) => {
    const next = id as "managed" | "discovered";
    setTab(next);
    if (next === "discovered" && cands === null) void scan();
  }, [cands, scan]);

  const onToggleMaster = useCallback(async (row: SkillRow) => {
    setBusy(true);
    try { await toggleSkill(row.name, !row.effective.enabled); await refetch(); }
    finally { setBusy(false); }
  }, [refetch]);

  const onToggleTarget = useCallback(async (row: SkillRow, targetId: string, enabled: boolean) => {
    setBusy(true);
    try { await toggleSkill(row.name, enabled, targetId); await refetch(); }
    finally { setBusy(false); }
  }, [refetch]);

  const onChangeMethod = useCallback(async (name: string, method: SkillMethod) => {
    if (!view) return;
    setBusy(true);
    try {
      const next = { ...view.config, skills: { ...view.config.skills, [name]: { ...view.config.skills[name], method } } };
      await saveSkillsConfig(next);
      await refetch();
    } finally { setBusy(false); }
  }, [view, refetch]);

  const confirmResolve = useCallback(async () => {
    if (!pending) return;
    setResolving(true);
    try { await resolveSkillConflict(pending.skill, pending.target); await refetch(); }
    finally { setResolving(false); setPending(null); }
  }, [pending, refetch]);

  const onApplyLinks = useCallback(async () => {
    setBusy(true);
    try { await linkSkills(); await refetch(); }
    finally { setBusy(false); }
  }, [refetch]);

  const onBackup = useCallback(async () => {
    const names = [...checked];
    if (names.length === 0) return;
    setBusy(true);
    try {
      await captureSkills(names);
      setChecked(new Set());
      setCands(null);
      await refetch();
      setTab("managed");
    } finally { setBusy(false); }
  }, [checked, refetch]);

  const toggleCheck = useCallback((id: string) => {
    setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  if (loading) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <div style={card}>{[1, 2, 3].map((i) => <div key={i} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}><Skeleton width={300} height={14} /></div>)}</div>
      </div>
    );
  }

  if (error || !view) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <EmptyState icon={<Stack size={24} />} title={t("skills.title")} subtitle={error ?? "No skills data"} />
      </div>
    );
  }

  const { config, targets, skills } = view;
  const newCands = (cands ?? []).filter((c) => !skills.some((s) => s.name === c.id));

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      {/* Recipe bar: source dir, default method/targets, apply links */}
      <div style={{ ...card, padding: "12px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
          <Stack size={14} style={{ color: "var(--accent)" }} />
          <span style={{ color: "var(--muted)" }}>{t("skills.sourceDir")}:</span>
          <span className="mono" style={{ color: "var(--text)" }}>{config.sourceDir}</span>
        </span>
        <span style={{ color: "var(--muted)", fontSize: 13.5 }}>
          {t(`skills.method.${config.method}`)} · {config.targets.join(", ") || "—"}
        </span>
        <button onClick={() => void onApplyLinks()} disabled={busy} style={{ ...ic, marginLeft: "auto", color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 14 }}>
          <LinkIcon size={14} />{t("skills.link")}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <TabSwitch
          active={tab}
          onChange={onTab}
          tabs={[
            { id: "managed", label: t("skills.tab.managed"), count: skills.length },
            { id: "discovered", label: t("skills.tab.discovered"), count: cands === null ? undefined : newCands.length },
          ]}
        />
        <button onClick={() => void scan()} disabled={scanning} style={{ ...ic, marginLeft: "auto", color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 14 }}>
          {scanning ? <ArrowsClockwise size={14} /> : <MagnifyingGlass size={14} />}
          {scanning ? t("dotfiles.scanning") : t("common.discoveredTab")}
        </button>
      </div>

      {tab === "managed" && (
        skills.length === 0 ? (
          <EmptyState icon={<Stack size={24} />} title={t("skills.title")} subtitle={t("skills.tab.managed")} />
        ) : (
          <div style={{ ...card, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12.5 }}>
                  <th style={{ ...cellPad, fontWeight: 600 }}>Skill</th>
                  <th style={{ ...cellPad, fontWeight: 600 }}>{t("skills.enabled")}</th>
                  {targets.map((tg) => (
                    <th key={tg.id} style={{ ...cellPad, fontWeight: 600, textAlign: "center" }}>{tg.label}</th>
                  ))}
                  <th style={{ ...cellPad, fontWeight: 600 }}>{t("skills.method.symlink")}/{t("skills.method.copy")}</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((row) => (
                  <tr key={row.name}>
                    <td style={cellPad}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <Stack size={14} style={{ color: "var(--muted)" }} />
                        <span className="mono">{row.name}</span>
                      </span>
                    </td>
                    <td style={cellPad}>
                      <input
                        type="checkbox"
                        aria-label={`enable ${row.name}`}
                        checked={row.effective.enabled}
                        disabled={busy}
                        onChange={() => void onToggleMaster(row)}
                        style={{ accentColor: "var(--accent)", width: 17, height: 17, cursor: "pointer" }}
                      />
                    </td>
                    {targets.map((tg) => {
                      const status = targetStatus(row, tg.id);
                      return (
                        <td key={tg.id} style={{ ...cellPad, textAlign: "center" }}>
                          <CellToggle
                            row={row}
                            targetLabel={tg.label}
                            status={status}
                            busy={busy}
                            t={t}
                            onToggle={(next) => void onToggleTarget(row, tg.id, next)}
                            onResolve={() => setPending({ skill: row.name, target: tg.id })}
                          />
                        </td>
                      );
                    })}
                    <td style={cellPad}>
                      <select
                        aria-label={`method for ${row.name}`}
                        value={row.effective.method}
                        disabled={busy}
                        onChange={(e) => void onChangeMethod(row.name, e.target.value as SkillMethod)}
                        style={{ ...ic, padding: "4px 6px" }}
                      >
                        <option value="symlink">{t("skills.method.symlink")}</option>
                        <option value="copy">{t("skills.method.copy")}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === "discovered" && (
        cands === null ? (
          <EmptyState icon={<Stack size={24} />} title={t("skills.tab.discovered")} subtitle={t("dotfiles.scanning")} />
        ) : newCands.length === 0 ? (
          <EmptyState icon={<CheckCircle size={24} />} title={t("common.allAddedTitle")} subtitle={t("common.allAddedSubtitle")} />
        ) : (
          <div>
            {checked.size > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px" }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{checked.size} {t("common.selected")}</span>
                <button onClick={() => void onBackup()} disabled={busy} style={{ ...ic, marginLeft: "auto", color: "var(--accent)", borderColor: "var(--accent)" }}>
                  <FloppyDisk size={11} />{t("skills.capture")}
                </button>
              </div>
            )}
            <div style={card}>
              {newCands.map((c) => {
                const conflict = c.note ? /conflict/i.test(c.note) : false;
                return (
                  <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14 }}>
                    <input type="checkbox" aria-label={`select ${c.id}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} style={{ accentColor: "var(--accent)", width: 17, height: 17, cursor: "pointer" }} />
                    <Stack size={14} style={{ color: "var(--muted)" }} />
                    <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.id}</span>
                    {c.note && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: conflict ? "var(--accent)" : "var(--muted)" }}>
                        {conflict && <Warning size={11} weight="fill" />}{c.note}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}
        >
          <div style={{ ...card, maxWidth: 420, width: "100%", padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Warning size={16} weight="fill" style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("skills.resolve.action")}</span>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.5, color: "var(--muted)" }}>{t("skills.resolve.confirm")}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setPending(null)} disabled={resolving} style={{ ...ic, padding: "6px 12px", fontSize: 14 }}>
                {t("skills.resolve.cancel")}
              </button>
              <button onClick={() => void confirmResolve()} disabled={resolving} style={{ ...ic, padding: "6px 12px", fontSize: 14, color: "#fff", background: "var(--accent)", borderColor: "var(--accent)" }}>
                {t("skills.resolve.confirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
