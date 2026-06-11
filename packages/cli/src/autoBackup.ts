// Auto-backup scheduler (ADR-0020). Pure orchestration with injected deps so it
// is unit-testable; runs inside the sidecar for the app's whole lifetime.
import type { BlockedItem } from "@roost/shared";
import type { RoostSettings, AutoBackupFreq } from "@roost/core";

export interface AutoBackupRun {
  at: string;
  captured: number;
  blocked: number;
  blockedDetail: BlockedItem[];
  pushed?: boolean;
  pushHint?: "auth" | "pull-first";
  error?: string;
}

export interface AutoBackupDeps {
  loadSettings: () => RoostSettings;
  isRepo: () => Promise<boolean>;
  runCapture: () => Promise<{ captured: number; blocked: number; blockedDetail: BlockedItem[] }>;
  runPush: () => Promise<{ ok: boolean; hint?: "auth" | "pull-first" }>;
  initialDelayMs?: number;
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout };
}

export interface AutoBackup {
  runNow(): Promise<void>;
  reconfigure(): void;
  lastRun(): AutoBackupRun | null;
  stop(): void;
}

export function intervalMsFor(freq: Exclude<AutoBackupFreq, "off">): number {
  return freq === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
}

export function createAutoBackup(deps: AutoBackupDeps): AutoBackup {
  const timers = deps.timers ?? { set: setTimeout, clear: clearTimeout };
  const initialDelay = deps.initialDelayMs ?? 60_000;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let last: AutoBackupRun | null = null;

  const runNow = async (): Promise<void> => {
    const settings = deps.loadSettings();
    if (settings.autoBackup === "off") return;
    if (!(await deps.isRepo())) return;
    const run: AutoBackupRun = { at: new Date().toISOString(), captured: 0, blocked: 0, blockedDetail: [] };
    try {
      const r = await deps.runCapture();
      run.captured = r.captured;
      run.blocked = r.blocked;
      run.blockedDetail = r.blockedDetail;
      if (settings.autoPush && r.captured > 0) {
        const p = await deps.runPush();
        run.pushed = p.ok;
        if (!p.ok) run.pushHint = p.hint;
      }
    } catch (e) {
      run.error = e instanceof Error ? e.message : String(e);
    }
    last = run;
  };

  const clear = (): void => {
    if (handle !== null) { timers.clear(handle); handle = null; }
  };

  const schedule = (delayMs: number): void => {
    clear();
    const freq = deps.loadSettings().autoBackup;
    if (freq === "off") return;
    handle = timers.set((): Promise<void> => {
      return runNow().finally(() => schedule(intervalMsFor(freq === "off" ? "daily" : freq)));
    }, delayMs);
    // Never keep the process alive just for the backup timer.
    (handle as { unref?: () => void }).unref?.();
  };

  return {
    runNow,
    reconfigure: () => schedule(initialDelay),
    lastRun: () => last,
    stop: clear,
  };
}
