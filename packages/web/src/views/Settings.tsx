import { useState, useEffect } from "react";
import {
  FolderOpen,
  Cube,
  ShieldCheck,
  ArrowSquareOut,
  Key,
  GitBranch,
} from "@phosphor-icons/react";
import { Skeleton } from "../components/Skeleton";
import { useT } from "../i18n";
import { getHealth, getModules, getGitStatus, gitPush, gitPull, getKey, generateKey, rotateKey, type ModulesResponse, type GitStatus, type KeyStatus } from "../api";

export function Settings() {
  const { t } = useT();
  const [modules, setModules] = useState<ModulesResponse | null>(null);
  const [repoDir, setRepoDir] = useState<string | null>(null);
  const [ageKey, setAgeKey] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitBusy, setGitBusy] = useState<"push" | "pull" | null>(null);
  const [gitResult, setGitResult] = useState<{ kind: "push" | "pull"; ok: boolean; output: string } | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [keyBusy, setKeyBusy] = useState<"generate" | "rotate" | null>(null);
  const [keyResult, setKeyResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([getHealth(), getModules(), getGitStatus(), getKey()])
      .then(([health, mods, git, key]) => {
        if (health.status === "fulfilled") {
          setRepoDir(health.value.repoDir ?? null);
          setAgeKey(health.value.ageKey ?? null);
        }
        if (mods.status === "fulfilled") setModules(mods.value);
        if (git.status === "fulfilled") setGitStatus(git.value);
        if (key.status === "fulfilled") setKeyStatus(key.value);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleGenerateKey() {
    setKeyBusy("generate");
    setKeyResult(null);
    try {
      const r = await generateKey();
      setKeyResult({ ok: true, text: r.created ? `Generated. Recipient: ${r.recipient}` : "Key already present." });
      const s = await getKey().catch(() => null);
      if (s) { setKeyStatus(s); setAgeKey(s.exists); }
    } catch (e) {
      setKeyResult({ ok: false, text: e instanceof Error ? e.message : "Generate failed" });
    } finally {
      setKeyBusy(null);
    }
  }

  async function handleRotateKey() {
    if (!window.confirm(t("settings.key.rotateConfirm"))) return;
    setKeyBusy("rotate");
    setKeyResult(null);
    try {
      const r = await rotateKey();
      setKeyResult(
        r.swapped
          ? { ok: true, text: `Rotated ${r.rotated.length} file(s). New recipient: ${r.recipient}. Old key backed up — RE-BACK UP the new key.` }
          : { ok: false, text: `Aborted — ${r.failed.length} file(s) failed to re-encrypt; the key was left unchanged.` },
      );
      const s = await getKey().catch(() => null);
      if (s) setKeyStatus(s);
    } catch (e) {
      setKeyResult({ ok: false, text: e instanceof Error ? e.message : "Rotate failed" });
    } finally {
      setKeyBusy(null);
    }
  }

  async function handleGitPush() {
    setGitBusy("push");
    setGitResult(null);
    try {
      const res = await gitPush();
      setGitResult({ kind: "push", ok: res.ok, output: res.output });
      if (res.ok) {
        const s = await getGitStatus().catch(() => null);
        if (s) setGitStatus(s);
      }
    } finally {
      setGitBusy(null);
    }
  }

  async function handleGitPull() {
    setGitBusy("pull");
    setGitResult(null);
    try {
      const res = await gitPull();
      setGitResult({ kind: "pull", ok: res.ok, output: res.output });
      if (res.ok) {
        const s = await getGitStatus().catch(() => null);
        if (s) setGitStatus(s);
      }
    } finally {
      setGitBusy(null);
    }
  }

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

      {/* ── Git remote & sync ── */}
      <div style={sectionLabel}>{t("settings.git.heading")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Remote URL row */}
        <div style={row}>
          <GitBranch size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span style={{ color: "var(--muted)", minWidth: 80 }}>Remote</span>
          {loading ? (
            <Skeleton width={260} height={13} />
          ) : gitStatus?.remote ? (
            <span className="mono" style={{ color: "var(--text)", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {gitStatus.remote}
            </span>
          ) : (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("settings.git.noRemote")}</span>
          )}
        </div>

        {/* Branch + ahead/behind row */}
        {gitStatus?.isRepo && (
          <div style={row}>
            <GitBranch size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <span style={{ color: "var(--muted)", minWidth: 80 }}>Branch</span>
            <span className="mono" style={{ color: "var(--text)", fontSize: 12 }}>
              {gitStatus.branch ?? "—"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>
              {gitStatus.ahead === 0 && gitStatus.behind === 0 && gitStatus.clean
                ? t("settings.git.inSync")
                : `↑${gitStatus.ahead} ↓${gitStatus.behind}`}
            </span>
          </div>
        )}

        {/* Push / Pull buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { void handleGitPush(); }}
            disabled={!gitStatus?.isRepo || !gitStatus?.remote || gitBusy !== null}
            style={{
              padding: "7px 16px",
              background: "var(--surface)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--rr)",
              fontSize: 13,
              cursor: !gitStatus?.isRepo || !gitStatus?.remote || gitBusy !== null ? "not-allowed" : "pointer",
              opacity: !gitStatus?.isRepo || !gitStatus?.remote || gitBusy !== null ? 0.5 : 1,
            }}
          >
            {gitBusy === "push" ? "…" : t("settings.git.push")}
          </button>
          <button
            onClick={() => { void handleGitPull(); }}
            disabled={!gitStatus?.isRepo || !gitStatus?.remote || gitBusy !== null}
            style={{
              padding: "7px 16px",
              background: "var(--surface)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--rr)",
              fontSize: 13,
              cursor: !gitStatus?.isRepo || !gitStatus?.remote || gitBusy !== null ? "not-allowed" : "pointer",
              opacity: !gitStatus?.isRepo || !gitStatus?.remote || gitBusy !== null ? 0.5 : 1,
            }}
          >
            {gitBusy === "pull" ? "…" : t("settings.git.pull")}
          </button>
        </div>

        {/* Inline result */}
        {gitResult && (
          <div style={{ fontSize: 12, color: gitResult.ok ? "var(--green)" : "var(--destructive)", padding: "4px 2px" }}>
            {gitResult.ok
              ? gitResult.kind === "push" ? t("settings.git.pushed") : t("settings.git.pulled")
              : gitResult.output || "Failed"}
          </div>
        )}
      </div>

      {/* ── Age key (encryption) ── */}
      <div style={sectionLabel}>{t("settings.key.heading")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={row}>
          <Key size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span style={{ color: "var(--muted)", minWidth: 80 }}>{t("settings.key.recipient")}</span>
          {loading ? (
            <Skeleton width={260} height={13} />
          ) : keyStatus?.recipient ? (
            <span className="mono" style={{ color: "var(--text)", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {keyStatus.recipient}
            </span>
          ) : (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("settings.key.none")}</span>
          )}
          {keyStatus && (
            <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>
              {keyStatus.encryptedFiles} {t("settings.key.encryptedFiles")}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {!keyStatus?.exists ? (
            <button
              onClick={() => { void handleGenerateKey(); }}
              disabled={keyBusy !== null}
              style={{ padding: "7px 16px", background: "var(--accent)", color: "#0b0b0d", border: 0, borderRadius: "var(--rr)", fontSize: 13, fontWeight: 560, cursor: keyBusy ? "default" : "pointer", opacity: keyBusy ? 0.6 : 1 }}
            >
              {keyBusy === "generate" ? "…" : t("settings.key.generate")}
            </button>
          ) : (
            <button
              onClick={() => { void handleRotateKey(); }}
              disabled={keyBusy !== null}
              style={{ padding: "7px 16px", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rr)", fontSize: 13, cursor: keyBusy ? "default" : "pointer", opacity: keyBusy ? 0.6 : 1 }}
            >
              {keyBusy === "rotate" ? "…" : t("settings.key.rotate")}
            </button>
          )}
        </div>

        <div style={{ fontSize: 12, color: "var(--amber)", padding: "2px 2px", lineHeight: 1.5 }}>
          ⚠️ {t("settings.key.backupWarning")}
        </div>

        {keyResult && (
          <div style={{ fontSize: 12, color: keyResult.ok ? "var(--green)" : "var(--destructive)", padding: "4px 2px", wordBreak: "break-all" }}>
            {keyResult.text}
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
