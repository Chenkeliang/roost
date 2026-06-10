import { useEffect, useState } from "react";
import { getGitStatus, gitPush } from "../../api";
import type { HudMessage } from "../../components/Hud";
import { Setup } from "../Setup";
import { StepRepo } from "./StepRepo";
import { StepSelect } from "./StepSelect";
import { StepCapture } from "./StepCapture";

const STEP_KEYS = ["onboard.step.repo", "onboard.step.check", "onboard.step.select", "onboard.step.capture", "onboard.step.push"];

export function Onboarding({ t, showHud, onComplete }: { t: (k: string) => string; showHud?: (m: HudMessage) => void; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [remote, setRemote] = useState<string | null>(null);
  const [envReady, setEnvReady] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);

  const refreshGit = () => { void getGitStatus().then((s) => setRemote(s.remote)).catch(() => {}); };
  useEffect(() => { refreshGit(); }, []);

  const push = async () => {
    setPushBusy(true); setPushErr(null);
    try {
      const r = await gitPush();
      if (r.ok) { showHud?.({ text: t("onboard.push.done"), type: "success" }); onComplete(); }
      else setPushErr(r.hint === "auth" ? t("onboard.push.auth") : r.output || t("onboard.push.failed"));
    } catch (e) { setPushErr(e instanceof Error ? e.message : String(e)); }
    finally { setPushBusy(false); }
  };

  const primary: React.CSSProperties = { appearance: "none", border: "1px solid var(--accent)", background: "var(--accent)", color: "#0b0b0d", fontFamily: "var(--font)", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ fontSize: 16, fontWeight: 600, margin: "8px 0 14px" }}>{t("onboard.title")}</div>

      {/* Step strip */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {STEP_KEYS.map((k, i) => (
          <span key={k} style={{ fontSize: 11.5, padding: "4px 11px", borderRadius: 20, background: i === step ? "var(--accent)" : i < step ? "var(--green)" : "var(--raise)", color: i === step ? "#fff" : i < step ? "#0b0b0d" : "var(--muted)" }}>
            {i + 1} · {t(k)}
          </span>
        ))}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: "var(--rc)", padding: 18 }}>
        {step === 0 && <StepRepo t={t} showHud={showHud} onDone={() => { refreshGit(); setStep(1); }} />}
        {step === 1 && (
          <div>
            <Setup embedded onReady={setEnvReady} />
            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setStep(2)} disabled={!envReady} style={{ ...primary, opacity: envReady ? 1 : 0.6, cursor: envReady ? "pointer" : "not-allowed" }}>{t("onboard.next")}</button>
            </div>
          </div>
        )}
        {step === 2 && <StepSelect t={t} showHud={showHud} onDone={() => setStep(3)} />}
        {step === 3 && <StepCapture t={t} showHud={showHud} onDone={() => setStep(4)} />}
        {step === 4 && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("onboard.push.heading")}</div>
            {remote ? (
              <>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>{t("onboard.push.ready")} <span className="mono" style={{ color: "var(--text)" }}>{remote}</span></p>
                <button onClick={() => void push()} disabled={pushBusy} style={primary}>{pushBusy ? "…" : t("onboard.push.btn")}</button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--amber)", margin: "0 0 12px" }}>{t("onboard.push.localOnly")}</p>
                <button onClick={onComplete} style={primary}>{t("onboard.finish")}</button>
              </>
            )}
            {pushErr && <div style={{ color: "var(--accent)", fontSize: 12.5, marginTop: 10 }}>{pushErr}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
