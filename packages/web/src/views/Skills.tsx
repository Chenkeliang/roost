import { useState, useEffect, useCallback } from "react";
import { Stack, MagnifyingGlass, ArrowsClockwise, FloppyDisk, CheckCircle, Link as LinkIcon, Warning, Circle, UploadSimple, Wrench, DotsThree, Tag } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { TabSwitch } from "../components/TabSwitch";
import { useT } from "../i18n";
import { getSkills, discoverSkills, toggleSkill, linkSkills, saveSkillsConfig, resolveSkillConflict, postSkillsImportScan, postSkillsImportApply, adoptSkills, unadoptSkills } from "../api";
import { TargetManager } from "./TargetManager";
import type { SkillImportResponse, SkillScanResponse, SkillCandidate } from "../api";
import type { SkillsView, SkillRow, SkillMethod } from "../api";
import { computeCoverage, targetStatus } from "./skillsCoverage";
import type { Coverage } from "./skillsCoverage";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" };
const ic: React.CSSProperties = { appearance: "none", border: "1px solid var(--border)", background: "var(--raise)", color: "var(--muted)", fontFamily: "var(--font)", fontSize: 12.5, padding: "4px 8px", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };
const cellPad: React.CSSProperties = { padding: "9px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 14, verticalAlign: "middle" };

function CoverageCell({ cov, method, onOpen, t }: { cov: Coverage; method: string; onOpen: () => void; t: (k: string) => string }) {
  if (cov.state === "disabled") {
    return <span aria-label={t("skills.coverage.disabled")} style={{ color: "var(--muted)", fontSize: 13 }}>—</span>;
  }
  // one dot per catalog tool: healthy = green, broken = amber, conflict = coral, off = faint gray
  const dotColor = (s: string) => (s === "conflict" ? "var(--accent)" : s === "broken" ? "#f0b352" : s === "off" ? "var(--muted)" : "var(--green)");
  return (
    <button onClick={onOpen} style={{ ...ic, border: 0, background: "transparent", padding: "2px 4px", gap: 8 }} aria-label={`${t("skills.coverage.title")} ${cov.healthy}/${cov.total}`}>
      <span style={{ display: "inline-flex", gap: 3 }}>
        {cov.segments.map((s, i) => (
          <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: s === "healthy" ? "var(--green)" : "transparent", border: `1px solid ${dotColor(s)}` }} />
        ))}
      </span>
      <span className="mono" style={{ fontSize: 13 }}>
        <span style={{ color: "var(--green)" }}>{cov.healthy}</span>
        <span style={{ color: "var(--muted)" }}>/{cov.total}</span>
      </span>
      <span style={{ color: "var(--muted)", fontSize: 12.5 }}>· {t(`skills.method.${method}`)}</span>
      {cov.state === "partial" && <span style={{ color: "#f0b352", fontSize: 12 }}>{cov.broken} {t("skills.coverage.broken")}</span>}
      {cov.state === "conflict" && <span style={{ color: "var(--accent)", fontSize: 12 }}>{t("skills.coverage.conflict")}</span>}
    </button>
  );
}

function SkillTargetsPopover({ row, targets, busy, t, onToggle, onResolve, onClose }: {
  row: SkillRow; targets: { id: string; label: string }[]; busy: boolean; t: (k: string) => string;
  onToggle: (targetId: string, next: boolean) => void; onResolve: (targetId: string) => void; onClose: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, maxWidth: 420, width: "100%", padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}><span className="mono">{row.name}</span></div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>{t("skills.targets.subtitle")}</div>
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden" }}>
          {targets.map((tg) => {
            const st = targetStatus(row, tg.id);
            const on = row.effective.enabled && row.effective.targets.includes(tg.id);
            return (
              <div key={tg.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                <button role="switch" aria-checked={on} aria-label={tg.label} disabled={busy || !row.effective.enabled}
                  onClick={() => onToggle(tg.id, !on)}
                  style={{ ...ic, border: 0, background: "transparent", padding: 0 }}>
                  {on ? <CheckCircle size={18} weight="fill" style={{ color: "var(--green)" }} /> : <Circle size={18} style={{ color: "var(--muted)" }} />}
                </button>
                <span style={{ flex: 1 }}>
                  {tg.label}
                  {row.external && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>
                      {row.external.label} {t("skills.external.suffix")}
                    </span>
                  )}
                </span>
                {st === "conflict" ? (
                  <button onClick={() => onResolve(tg.id)} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}>{t("skills.resolve.action")}</button>
                ) : st === "broken" && row.external ? (
                  // Externally-managed symlink: server never surfaces it as a conflict
                  // (computeConflicts skips symlinks), so this is the only reachable path
                  // to the cede action for a real external skill. ADR-0022 §3.
                  <button onClick={() => { onToggle(tg.id, false); onClose(); }} style={{ ...ic, padding: "6px 12px", fontSize: 13 }}>
                    {t("skills.external.cedePrefix")}{row.external.label ?? t("skills.external.other")}
                  </button>
                ) : st === "broken" ? (
                  <span style={{ color: "#f0b352", fontSize: 12 }}>{t("skills.coverage.broken")}</span>
                ) : st === "copy" ? (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("skills.method.copy")}</span>
                ) : st === "linked" ? (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("skills.method.symlink")}</span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} style={{ ...ic, padding: "6px 12px" }}>{t("skills.resolve.cancel")}</button>
        </div>
      </div>
    </div>
  );
}

function RowMenu({ row, busy, t, onRemove, onMethod, onToggleEnabled }: {
  row: SkillRow; busy: boolean; t: (k: string) => string;
  onRemove: () => void; onMethod: (m: SkillMethod) => void; onToggleEnabled: () => void;
}) {
  const [open, setOpen] = useState(false);
  // solid, elevated menu item (no transparency — readable over the list)
  const mi: React.CSSProperties = { background: "transparent", border: 0, width: "100%", textAlign: "left", justifyContent: "flex-start", display: "flex", alignItems: "center", color: "var(--text)", fontFamily: "var(--font)", fontSize: 13, padding: "7px 9px", borderRadius: 6, cursor: "pointer" };
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button aria-label={`actions ${row.name}`} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)} style={{ ...ic, border: 0, background: "transparent", padding: "4px 6px" }}>
        <DotsThree size={18} />
      </button>
      {open && (
        <>
          <span aria-hidden="true" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
          <div role="menu" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 91, background: "#2c2c33", border: "1px solid #3a3a42", borderRadius: 10, minWidth: 168, padding: 4, boxShadow: "0 18px 44px -14px rgba(0,0,0,.78), inset 0 1px 0 rgba(255,255,255,.05)" }}>
            <button role="menuitem" onClick={() => { setOpen(false); onToggleEnabled(); }} style={mi}>
              {row.effective.enabled ? t("skills.menu.disable") : t("skills.menu.enable")}
            </button>
            <button role="menuitem" onClick={() => { setOpen(false); onMethod(row.effective.method === "symlink" ? "copy" : "symlink"); }} style={mi}>
              {row.effective.method === "symlink" ? t("skills.menu.method") : t("skills.menu.methodSymlink")}
            </button>
            <button role="menuitem" onClick={() => { setOpen(false); onRemove(); }} style={{ ...mi, color: "var(--accent)" }}>
              {t("skills.adopt.remove")}
            </button>
          </div>
        </>
      )}
    </span>
  );
}

export function Skills() {
  const { t } = useT();
  const [view, setView] = useState<SkillsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"managed" | "discovered">("managed");
  const [cands, setCands] = useState<SkillCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ skill: string; target: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [fromChoice, setFromChoice] = useState<Record<string, string>>({}); // conflict picker
  const [confirmAdopt, setConfirmAdopt] = useState(false);
  const [decouple, setDecouple] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null); // skill pending un-adopt
  const [popover, setPopover] = useState<string | null>(null);
  const [managedFilter, setManagedFilter] = useState("");
  const [showTargets, setShowTargets] = useState(false);

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

  // ── import (scan → select → apply) ──────────────────────────────────────────
  const [gitUrl, setGitUrl] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scanResult, setScanResult] = useState<SkillScanResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importFilter, setImportFilter] = useState("");

  const onScanned = useCallback((r: SkillScanResponse) => {
    setScanResult(r);
    setImportFilter("");
    // default-select everything importable (not blocked)
    setSelected(new Set(r.skills.filter((s) => !s.blocked).map((s) => s.name)));
    if (r.skills.length === 0) setImportMsg(t("skills.import.none"));
  }, [t]);

  const scanZipFile = useCallback(
    async (file: File) => {
      if (!/\.zip$/i.test(file.name)) { setImportMsg(t("skills.import.zipOnly")); return; }
      setImportBusy(true); setImportMsg(null); setScanResult(null);
      try {
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(file);
        });
        onScanned(await postSkillsImportScan({ filename: file.name, dataBase64: dataUrl.split(",")[1] ?? "" }));
      } catch (e) {
        setImportMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setImportBusy(false);
      }
    },
    [onScanned, t],
  );

  const scanGit = useCallback(async () => {
    const url = gitUrl.trim();
    if (!url) return;
    setImportBusy(true); setImportMsg(null); setScanResult(null);
    try {
      onScanned(await postSkillsImportScan({ url }));
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, [gitUrl, onScanned]);

  const applyImport = useCallback(async () => {
    if (!scanResult || selected.size === 0) return;
    setImportBusy(true); setImportMsg(null);
    try {
      const r: SkillImportResponse = await postSkillsImportApply(scanResult.token, [...selected]);
      const parts: string[] = [];
      if (r.imported.length) parts.push(`${t("skills.import.done")}: ${r.imported.join(", ")}`);
      if (r.blocked.length) parts.push(`${t("skills.import.blocked")}: ${r.blocked.map((b) => b.id).join(", ")}`);
      setImportMsg(parts.join("  ·  ") || t("skills.import.none"));
      setScanResult(null);
      setSelected(new Set());
      setImportFilter("");
      setGitUrl("");
      await refetch();
      await scan();
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, [scanResult, selected, refetch, scan, t]);

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

  const applyAdopt = useCallback(async () => {
    const names = [...checked];
    if (names.length === 0) return;
    setBusy(true);
    try {
      const from = Object.fromEntries(Object.entries(fromChoice).filter(([k]) => checked.has(k)));
      await adoptSkills(names, { decouple, from: Object.keys(from).length ? from : undefined });
      setChecked(new Set());
      setFromChoice({});
      setConfirmAdopt(false);
      if (cands) setCands(await discoverSkills().then((r) => r.candidates)); // re-scan
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, [checked, fromChoice, decouple, cands, refetch]);

  const doUnadopt = useCallback(async (name: string) => {
    setBusy(true);
    try {
      await unadoptSkills([name]);
      setRemoving(null);
      await refetch();
      if (cands) setCands(await discoverSkills().then((r) => r.candidates));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, [refetch, cands]);

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
  const targetIds = targets.map((tg) => tg.id);
  const newCands = (cands ?? []).filter((c) => !skills.some((s) => s.name === c.id));

  // Managed tab search filter
  const q = managedFilter.trim().toLowerCase();
  const visibleSkills = q ? skills.filter((s) => s.name.toLowerCase().includes(q)) : skills;

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
        <button onClick={() => setShowTargets(true)} style={{ ...ic, marginLeft: "auto" }}>{t("skills.targets.manage")}</button>
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
        <button onClick={() => void onApplyLinks()} disabled={busy} style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)", padding: "6px 12px", fontSize: 14 }}>
          <LinkIcon size={14} />{t("skills.link")}
        </button>
      </div>

      {tab === "managed" && (
        skills.length === 0 ? (
          <EmptyState icon={<Stack size={24} />} title={t("skills.title")} subtitle={t("skills.tab.managed")} />
        ) : (
          <>
            {(() => {
              const attention = skills.filter((s) => { const st = computeCoverage(s, targetIds).state; return st === "partial" || st === "conflict"; }).length;
              return (
                <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
                  {skills.length} {t("skills.summary.managed")} ·{" "}
                  {attention > 0
                    ? <span style={{ color: "#f0b352" }}>{attention} {t("skills.summary.attention")}</span>
                    : t("skills.summary.allHealthy")}
                </div>
              );
            })()}
            <input value={managedFilter} onChange={(e) => setManagedFilter(e.target.value)} placeholder={t("skills.import.search")}
              style={{ ...ic, width: 220, padding: "5px 9px", marginBottom: 8 }} />
            {visibleSkills.length === 0 ? (
              <div style={{ ...card, padding: "10px 12px", fontSize: 13, color: "var(--muted)" }}>{t("skills.import.noMatch")}</div>
            ) : (
            <div style={{ ...card, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12.5 }}>
                    <th style={{ ...cellPad, fontWeight: 600 }}>Skill</th>
                    <th style={{ ...cellPad, fontWeight: 600 }}>{t("skills.coverage.title")}</th>
                    <th style={{ ...cellPad, fontWeight: 600 }} aria-label="actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSkills.map((row) => (
                    <tr key={row.name}>
                      {/* dim only the content cells when disabled — NOT the actions cell,
                          else CSS opacity inherits into the ⋯ menu and makes it translucent */}
                      <td style={{ ...cellPad, opacity: row.effective.enabled ? 1 : 0.5 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <Stack size={14} style={{ color: "var(--muted)" }} />
                          <span className="mono">{row.name}</span>
                          {row.external && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--muted)", background: "var(--raise)", border: "1px solid var(--border-soft)", borderRadius: 4, padding: "1px 5px" }}>
                              <Tag size={10} />
                              {row.external.label} {t("skills.external.suffix")}
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ ...cellPad, opacity: row.effective.enabled ? 1 : 0.5 }}>
                        <CoverageCell cov={computeCoverage(row, targetIds)} method={row.effective.method} onOpen={() => setPopover(row.name)} t={t} />
                      </td>
                      <td style={cellPad}>
                        <RowMenu row={row} busy={busy} t={t}
                          onRemove={() => setRemoving(row.name)}
                          onMethod={(m) => void onChangeMethod(row.name, m)}
                          onToggleEnabled={() => void onToggleMaster(row)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </>
        )
      )}

      {tab === "discovered" && (
        <div>
          <div style={{ ...card, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>{t("skills.import.title")}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void scanZipFile(f); }}
                style={{ flex: 1, minWidth: 220, border: `1px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`, borderRadius: 10, padding: "16px", textAlign: "center", cursor: importBusy ? "default" : "pointer", color: "var(--muted)", fontSize: 13, background: dragOver ? "var(--raise)" : "transparent" }}
              >
                <UploadSimple size={18} style={{ display: "block", margin: "0 auto 6px" }} />
                {t("skills.import.zipHint")}
                <input type="file" accept=".zip" style={{ display: "none" }} disabled={importBusy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanZipFile(f); e.currentTarget.value = ""; }} />
              </label>
              <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
                <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder={t("skills.import.gitPlaceholder")} disabled={importBusy}
                  onKeyDown={(e) => { if (e.key === "Enter") void scanGit(); }}
                  style={{ ...ic, width: "100%", padding: "7px 10px" }} />
                <button onClick={() => void scanGit()} disabled={importBusy || !gitUrl.trim()}
                  style={{ ...ic, justifyContent: "center", color: "var(--accent)", borderColor: "var(--accent)" }}>
                  {importBusy ? t("skills.import.scanning") : t("skills.import.scan")}
                </button>
              </div>
            </div>

            {scanResult && (() => {
              const qf = importFilter.trim().toLowerCase();
              const matches = (s: { name: string }) => !qf || s.name.toLowerCase().includes(qf);
              const visible = scanResult.skills.filter(matches);
              const visibleImportable = visible.filter((s) => !s.blocked);
              const hasImportable = scanResult.skills.some((s) => !s.blocked);
              const bulk = (fn: (n: Set<string>, name: string) => void) =>
                setSelected((prev) => { const n = new Set(prev); for (const s of visibleImportable) fn(n, s.name); return n; });
              return (
              <div style={{ marginTop: 12, border: "1px solid var(--border-soft)", borderRadius: 10, overflow: "hidden" }}>
                {hasImportable && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--border-soft)" }}>
                    <input value={importFilter} onChange={(e) => setImportFilter(e.target.value)} placeholder={t("skills.import.search")}
                      style={{ ...ic, flex: 1, padding: "5px 9px" }} />
                    <button onClick={() => bulk((n, name) => n.add(name))} style={{ ...ic }}>{t("skills.import.selectAll")}</button>
                    <button onClick={() => bulk((n, name) => { if (n.has(name)) n.delete(name); else n.add(name); })} style={{ ...ic }}>{t("skills.import.invert")}</button>
                    <button onClick={() => setSelected(new Set())} style={{ ...ic }}>{t("skills.import.clear")}</button>
                  </div>
                )}
                {scanResult.skills.length === 0 ? (
                  <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--muted)" }}>{t("skills.import.none")}</div>
                ) : visible.length === 0 ? (
                  <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--muted)" }}>{t("skills.import.noMatch")}</div>
                ) : (
                  visible.map((s) => (
                    <label key={s.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 13, opacity: s.blocked ? 0.6 : 1 }}>
                      <input type="checkbox" disabled={!!s.blocked || importBusy} checked={selected.has(s.name)}
                        onChange={() => setSelected((set) => { const n = new Set(set); if (n.has(s.name)) n.delete(s.name); else n.add(s.name); return n; })}
                        style={{ accentColor: "var(--accent)", width: 17, height: 17, cursor: s.blocked ? "default" : "pointer" }} />
                      <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                      {s.blocked && (
                        <span style={{ fontSize: 12, color: s.blocked === "secret" ? "var(--accent)" : "#f0b352" }}>
                          {s.blocked === "secret" ? t("skills.import.flagSecret") : t("skills.import.flagLarge")}{s.detail ? ` (${s.detail})` : ""}
                        </span>
                      )}
                    </label>
                  ))
                )}
                {hasImportable && (
                  <div style={{ display: "flex", gap: 8, padding: "10px 12px", alignItems: "center" }}>
                    <button onClick={() => void applyImport()} disabled={importBusy || selected.size === 0}
                      style={{ ...ic, color: "var(--accent)", borderColor: "var(--accent)" }}>
                      {importBusy ? t("skills.import.importing") : `${t("skills.import.importSelected")} (${selected.size})`}
                    </button>
                    <button onClick={() => { setScanResult(null); setSelected(new Set()); setImportFilter(""); }} disabled={importBusy} style={{ ...ic }}>
                      {t("skills.resolve.cancel")}
                    </button>
                  </div>
                )}
              </div>
              );
            })()}
            {importMsg && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)", wordBreak: "break-word" }}>{importMsg}</div>}
          </div>
          {cands === null ? (
          <EmptyState icon={<Stack size={24} />} title={t("skills.tab.discovered")} subtitle={t("dotfiles.scanning")} />
        ) : newCands.length === 0 ? (
          <EmptyState icon={<CheckCircle size={24} />} title={t("common.allAddedTitle")} subtitle={t("common.allAddedSubtitle")} />
        ) : (
          <div>
            {checked.size > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px" }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{checked.size} {t("common.selected")}</span>
                <button onClick={() => setConfirmAdopt(true)} disabled={busy} style={{ ...ic, marginLeft: "auto", color: "var(--accent)", borderColor: "var(--accent)" }}>
                  <FloppyDisk size={11} />{t("skills.adopt.action")}
                </button>
              </div>
            )}
            {Object.entries(
              newCands.reduce<Record<string, SkillCandidate[]>>((acc, c) => {
                const k = c.origin?.location ?? t("skills.adopt.unknownLocation");
                (acc[k] = acc[k] ?? []).push(c);
                return acc;
              }, {}),
            ).map(([location, items]) => {
              // Hint only when the WHOLE group is symlinked from elsewhere (an
              // external tool's dir); a group mixing direct + linked items isn't
              // entirely "managed by another tool".
              const linkedGroup = items.length > 0 && items.every((c) => c.origin?.linked);
              return (
                <div key={location} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 0 6px", fontSize: 12.5, color: "var(--muted)" }}>
                    <span className="mono">{location}</span>
                    <span>· {items.length}</span>
                  </div>
                  {linkedGroup && (
                    <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--raise)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
                      {t("skills.adopt.linkedHint")}
                    </div>
                  )}
                  <div style={card}>
                    {items.map((c) => (
                      <div key={c.id} role="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14 }}>
                        <input type="checkbox" aria-label={`select ${c.id}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} style={{ accentColor: "var(--accent)", width: 17, height: 17, cursor: "pointer" }} />
                        <Stack size={14} style={{ color: "var(--muted)" }} />
                        <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.id}</span>
                        {c.origin?.needsRepair && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#f0b352" }}>
                            <Wrench size={11} weight="fill" />{t("skills.adopt.repair")}
                          </span>
                        )}
                        {c.origin?.conflictLocations && c.origin.conflictLocations.length > 1 && (
                          <select
                            aria-label={`source for ${c.id}`}
                            value={fromChoice[c.id] ?? c.origin.conflictLocations[0]}
                            onChange={(e) => setFromChoice((m) => ({ ...m, [c.id]: e.target.value }))}
                            style={{ ...ic, padding: "3px 6px", fontSize: 12 }}
                          >
                            {c.origin.conflictLocations.map((loc) => (
                              <option key={loc} value={loc}>{loc}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}

      {/* Per-tool popover */}
      {popover && (() => {
        const row = skills.find((s) => s.name === popover);
        if (!row) return null;
        return (
          <SkillTargetsPopover row={row} targets={targets} busy={busy} t={t}
            onToggle={(tid, next) => void onToggleTarget(row, tid, next)}
            onResolve={(tid) => { setPopover(null); setPending({ skill: row.name, target: tid }); }}
            onClose={() => setPopover(null)} />
        );
      })()}

      {pending && (() => {
        const pendingRow = skills.find((s) => s.name === pending.skill);
        const ext = pendingRow?.external;
        return (
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
                {ext && (
                  <button
                    onClick={() => { void onToggleTarget(pendingRow!, pending.target, false); setPending(null); }}
                    disabled={resolving}
                    style={{ ...ic, padding: "6px 12px", fontSize: 14 }}
                  >
                    {t("skills.external.cedePrefix")}{ext.label ?? t("skills.external.other")}
                  </button>
                )}
                <button onClick={() => void confirmResolve()} disabled={resolving} style={{ ...ic, padding: "6px 12px", fontSize: 14, color: "#fff", background: "var(--accent)", borderColor: "var(--accent)" }}>
                  {t("skills.resolve.confirmAction")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmAdopt && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
          <div style={{ ...card, maxWidth: 480, width: "100%", padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t("skills.adopt.confirmTitle")} ({checked.size})</div>
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-soft)", borderRadius: 8, marginBottom: 12 }}>
              {(cands ?? []).filter((c) => checked.has(c.id)).map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5 }}>
                  <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{c.id}</span>
                  <span style={{ color: "var(--muted)" }}>{c.origin?.location}</span>
                  {typeof c.sizeBytes === "number" && <span style={{ color: "var(--muted)" }}>{Math.max(1, Math.round(c.sizeBytes / 1024))}KB</span>}
                  {c.origin?.needsRepair && <span style={{ color: "#f0b352" }}>{t("skills.adopt.repair")}</span>}
                </div>
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
              <input type="checkbox" checked={decouple} onChange={(e) => setDecouple(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
              {t("skills.adopt.decouple")}
            </label>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{t("skills.adopt.confirmNote")}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmAdopt(false)} disabled={busy} style={{ ...ic, padding: "6px 12px" }}>{t("skills.resolve.cancel")}</button>
              <button onClick={() => void applyAdopt()} disabled={busy} style={{ ...ic, padding: "6px 12px", color: "#fff", background: "var(--accent)", borderColor: "var(--accent)" }}>{t("skills.adopt.confirmAction")}</button>
            </div>
          </div>
        </div>
      )}

      {showTargets && <TargetManager initial={targets} t={t} onClose={() => setShowTargets(false)} onSaved={() => void refetch()} />}

      {removing && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
          <div style={{ ...card, maxWidth: 420, width: "100%", padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t("skills.adopt.removeTitle")}</div>
            <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.5, color: "var(--muted)" }}>{t("skills.adopt.removeNote")}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setRemoving(null)} disabled={busy} style={{ ...ic, padding: "6px 12px" }}>{t("skills.resolve.cancel")}</button>
              <button onClick={() => void doUnadopt(removing)} disabled={busy} style={{ ...ic, padding: "6px 12px", color: "var(--accent)", borderColor: "var(--accent)" }}>{t("skills.adopt.remove")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
