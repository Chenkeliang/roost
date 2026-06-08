import { useState, useEffect, useCallback } from "react";
import { Stack, MagnifyingGlass, ArrowsClockwise, FloppyDisk, CheckCircle, Link as LinkIcon, Warning, LinkBreak, Copy } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { TabSwitch } from "../components/TabSwitch";
import { useT } from "../i18n";
import { getSkills, discoverSkills, captureSkills, toggleSkill, linkSkills, saveSkillsConfig } from "../api";
import type { SkillsView, SkillRow, SkillMethod } from "../api";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 11, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };
const cellPad: React.CSSProperties = { padding: "9px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 13, verticalAlign: "middle" };

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

function StatusBadge({ status, t }: { status: ReturnType<typeof targetStatus>; t: (k: string) => string }) {
  if (status === "off") return null;
  if (status === "linked") return <CheckCircle size={13} weight="fill" style={{ color: "var(--green)" }} aria-label={t("skills.enabled")} />;
  if (status === "copy") return <Copy size={13} style={{ color: "var(--muted)" }} aria-label={t("skills.method.copy")} />;
  if (status === "conflict") return <Warning size={13} weight="fill" style={{ color: "var(--accent)" }} aria-label={t("skills.conflict")} />;
  return <LinkBreak size={13} style={{ color: "var(--red)" }} aria-label={t("skills.dangling")} />;
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <Stack size={14} style={{ color: "var(--accent)" }} />
          <span style={{ color: "var(--muted)" }}>{t("skills.sourceDir")}:</span>
          <span className="mono" style={{ color: "var(--text)" }}>{config.sourceDir}</span>
        </span>
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
          {t(`skills.method.${config.method}`)} · {config.targets.join(", ") || "—"}
        </span>
        <button onClick={() => void onApplyLinks()} disabled={busy} style={{ ...ic, marginLeft: "auto", color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 13 }}>
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
        <button onClick={() => void scan()} disabled={scanning} style={{ ...ic, marginLeft: "auto", color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 13 }}>
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
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11 }}>
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
                        style={{ accentColor: "var(--accent)" }}
                      />
                    </td>
                    {targets.map((tg) => {
                      const on = row.effective.enabled && row.effective.targets.includes(tg.id);
                      const status = targetStatus(row, tg.id);
                      return (
                        <td key={tg.id} style={{ ...cellPad, textAlign: "center" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                            <input
                              type="checkbox"
                              aria-label={`${row.name} on ${tg.label}`}
                              checked={on}
                              disabled={busy || !row.effective.enabled}
                              onChange={(e) => void onToggleTarget(row, tg.id, e.target.checked)}
                              style={{ accentColor: "var(--accent)" }}
                            />
                            <StatusBadge status={status} t={t} />
                          </span>
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
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{checked.size} {t("common.selected")}</span>
                <button onClick={() => void onBackup()} disabled={busy} style={{ ...ic, marginLeft: "auto", color: "var(--accent)", borderColor: "var(--accent)" }}>
                  <FloppyDisk size={11} />{t("skills.capture")}
                </button>
              </div>
            )}
            <div style={card}>
              {newCands.map((c) => {
                const conflict = c.note ? /conflict/i.test(c.note) : false;
                return (
                  <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                    <input type="checkbox" aria-label={`select ${c.id}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} style={{ accentColor: "var(--accent)" }} />
                    <Stack size={14} style={{ color: "var(--muted)" }} />
                    <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.id}</span>
                    {c.note && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: conflict ? "var(--accent)" : "var(--muted)" }}>
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
    </div>
  );
}
