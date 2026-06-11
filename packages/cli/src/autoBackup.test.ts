import { describe, it, expect, vi } from "vitest";
import type { RoostSettings } from "@roost/core";
import { createAutoBackup, intervalMsFor } from "./autoBackup.js";

const SETTINGS = (over: Partial<RoostSettings> = {}): RoostSettings =>
  ({ maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true, ...over });

function makeDeps(over: Partial<Parameters<typeof createAutoBackup>[0]> = {}) {
  const timer = { handles: [] as { fn: () => void; ms: number }[] };
  return {
    timer,
    deps: {
      loadSettings: () => SETTINGS(),
      isRepo: async () => true,
      runCapture: vi.fn().mockResolvedValue({ captured: 2, blocked: 0, blockedDetail: [] }),
      runPush: vi.fn().mockResolvedValue({ ok: true }),
      initialDelayMs: 0,
      timers: {
        set: ((fn: () => void, ms: number) => { timer.handles.push({ fn, ms }); return timer.handles.length as unknown as NodeJS.Timeout; }) as typeof setTimeout,
        clear: (() => {}) as typeof clearTimeout,
      },
      ...over,
    },
  };
}

describe("intervalMsFor", () => {
  it("maps daily/weekly", () => {
    expect(intervalMsFor("daily")).toBe(24 * 60 * 60 * 1000);
    expect(intervalMsFor("weekly")).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("createAutoBackup", () => {
  it("runNow captures and records lastRun", async () => {
    const { deps } = makeDeps();
    const ab = createAutoBackup(deps);
    await ab.runNow();
    expect(deps.runCapture).toHaveBeenCalledOnce();
    expect(ab.lastRun()).toMatchObject({ captured: 2, blocked: 0 });
    expect(deps.runPush).not.toHaveBeenCalled(); // autoPush off
  });

  it("pushes after capture when autoPush is on and something was captured", async () => {
    const { deps } = makeDeps({ loadSettings: () => SETTINGS({ autoPush: true }) });
    const ab = createAutoBackup(deps);
    await ab.runNow();
    expect(deps.runPush).toHaveBeenCalledOnce();
    expect(ab.lastRun()?.pushed).toBe(true);
  });

  it("skips push when nothing captured, records pushHint on failure", async () => {
    const { deps } = makeDeps({
      loadSettings: () => SETTINGS({ autoPush: true }),
      runCapture: vi.fn().mockResolvedValue({ captured: 0, blocked: 0, blockedDetail: [] }),
    });
    const ab = createAutoBackup(deps);
    await ab.runNow();
    expect(deps.runPush).not.toHaveBeenCalled();

    const failing = makeDeps({
      loadSettings: () => SETTINGS({ autoPush: true }),
      runPush: vi.fn().mockResolvedValue({ ok: false, hint: "auth" as const }),
    });
    const ab2 = createAutoBackup(failing.deps);
    await ab2.runNow();
    expect(ab2.lastRun()?.pushed).toBe(false);
    expect(ab2.lastRun()?.pushHint).toBe("auth");
  });

  it("does nothing when no repo or autoBackup off", async () => {
    const noRepo = makeDeps({ isRepo: async () => false });
    const ab = createAutoBackup(noRepo.deps);
    await ab.runNow();
    expect(noRepo.deps.runCapture).not.toHaveBeenCalled();

    const off = makeDeps({ loadSettings: () => SETTINGS({ autoBackup: "off" }) });
    const ab2 = createAutoBackup(off.deps);
    await ab2.runNow();
    expect(off.deps.runCapture).not.toHaveBeenCalled();
  });

  it("captures errors into lastRun instead of throwing", async () => {
    const { deps } = makeDeps({ runCapture: vi.fn().mockRejectedValue(new Error("boom")) });
    const ab = createAutoBackup(deps);
    await ab.runNow();
    expect(ab.lastRun()?.error).toBe("boom");
  });

  it("reconfigure schedules with the initial delay then the frequency interval", async () => {
    const { deps, timer } = makeDeps({ initialDelayMs: 60_000 });
    const ab = createAutoBackup(deps);
    ab.reconfigure();
    expect(timer.handles[0]?.ms).toBe(60_000); // first run delayed
    await timer.handles[0]!.fn();              // fire it
    expect(deps.runCapture).toHaveBeenCalledOnce();
    expect(timer.handles[1]?.ms).toBe(24 * 60 * 60 * 1000); // next: daily
  });

  it("reconfigure with off clears and schedules nothing", () => {
    const { deps, timer } = makeDeps({ loadSettings: () => SETTINGS({ autoBackup: "off" }) });
    const ab = createAutoBackup(deps);
    ab.reconfigure();
    expect(timer.handles.length).toBe(0);
  });
});
