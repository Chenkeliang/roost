import { useState, useEffect, useCallback } from "react";
import { getEnvironment, postBrewInstall } from "../api";
import type { EnvCheck } from "../api";
import { useT } from "../i18n";

const BREW_INSTALL_CMD =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={{ fontSize: 12, padding: "3px 9px", borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" }}
    >
      {copied ? t("setup.copied") : t("setup.copy")}
    </button>
  );
}

export function Setup({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  const { t } = useT();
  const [checks, setChecks] = useState<EnvCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installOut, setInstallOut] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getEnvironment()
      .then((d) => {
        setChecks(d.checks);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const brewOk = checks?.find((c) => c.id === "brew")?.ok ?? false;
  const missingFormulae = (checks ?? []).filter((c) => !c.ok && c.brewFormula).map((c) => c.brewFormula!) as string[];
  const requiredMissing = (checks ?? []).filter((c) => c.required && !c.ok);

  const install = useCallback(() => {
    if (missingFormulae.length === 0) return;
    setInstalling(true);
    setInstallOut(null);
    postBrewInstall(missingFormulae)
      .then((r) => {
        setInstallOut(r.output || (r.ok ? "ok" : "failed"));
        refresh();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setInstalling(false));
  }, [missingFormulae, refresh]);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ fontSize: 12.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600, marginBottom: 14 }}>
        {t("setup.title")}
      </div>

      {error ? (
        <div role="alert" style={{ padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", color: "#ff8c8c", fontSize: 14, marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {checks === null ? (
        <div style={{ color: "var(--muted)", fontSize: 14 }}>{t("setup.loading")}</div>
      ) : (
        <>
          {/* Action bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", marginBottom: 16, fontSize: 13.5, flexWrap: "wrap" }}>
            {requiredMissing.length === 0 ? (
              <span style={{ color: "#5fd08a" }}>{t("setup.allGood")}</span>
            ) : !brewOk ? (
              <>
                <span style={{ color: "#f0b352" }}>{t("setup.needBrewFirst")}</span>
                <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, background: "var(--raise)", padding: "3px 7px", borderRadius: 6, color: "var(--text)" }}>{BREW_INSTALL_CMD}</code>
                <CopyButton text={BREW_INSTALL_CMD} />
                <a href="https://brew.sh" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 13 }}>brew.sh</a>
              </>
            ) : missingFormulae.length > 0 ? (
              <>
                <button
                  onClick={install}
                  disabled={installing}
                  style={{ fontSize: 13, fontWeight: 700, padding: "6px 13px", borderRadius: 8, cursor: installing ? "default" : "pointer", background: "var(--accent)", border: "1px solid var(--accent)", color: "#1b1b1e" }}
                >
                  {installing ? t("setup.installing") : `${t("setup.installMissing")} (brew install ${missingFormulae.join(" ")})`}
                </button>
                <CopyButton text={`brew install ${missingFormulae.join(" ")}`} />
              </>
            ) : (
              <span style={{ color: "#5fd08a" }}>{t("setup.allGood")}</span>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={refresh} style={{ fontSize: 12.5, padding: "5px 11px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" }}>
              {t("setup.recheck")}
            </button>
          </div>

          {/* Check list */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", overflow: "hidden" }}>
            {checks.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 14 }}>
                <span style={{ width: 24, fontSize: 17, lineHeight: 1, color: c.ok ? "#5fd08a" : c.required ? "#ff8c8c" : "#f0b352", fontWeight: 700, textAlign: "center" }}>{c.ok ? "✓" : "✗"}</span>
                <span style={{ minWidth: 170 }}>{t(`setup.check.${c.id}`)}</span>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{c.required ? t("setup.required") : t("setup.optional")}</span>
                <span style={{ flex: 1 }} />
                {c.ok ? (
                  <span style={{ fontSize: 12.5, color: "#5fd08a" }}>{t("setup.ok")}</span>
                ) : c.id === "age-key" ? (
                  <button onClick={() => onOpenSettings?.()} style={{ fontSize: 12, fontWeight: 600, padding: "3px 11px", borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid #b79af0", color: "#b79af0" }}>
                    {t("setup.openSettingsForKey")}
                  </button>
                ) : c.id === "repo" ? (
                  <span style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-mono, monospace)" }}>{t("setup.repoHint")}</span>
                ) : (
                  <span style={{ fontSize: 12.5, color: c.required ? "#ff8c8c" : "#f0b352" }}>{t("setup.missing")}</span>
                )}
              </div>
            ))}
          </div>

          {installOut ? (
            <pre style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", fontSize: 12.5, fontFamily: "var(--font-mono, monospace)", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", color: "var(--muted)" }}>
              {installOut}
            </pre>
          ) : null}
        </>
      )}
    </div>
  );
}
