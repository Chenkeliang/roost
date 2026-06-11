import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs"; import * as os from "node:os"; import * as path from "node:path";
import { DEFAULT_ROOST_SETTINGS, loadRoostSettings, saveRoostSettings } from "./settings.js";
let repo: string;
let tmpDir: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-set-"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-settings-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
describe("roost settings", () => {
  it("defaults maxCaptureMB to 100", () => { expect(DEFAULT_ROOST_SETTINGS.maxCaptureMB).toBe(100); });
  it("returns defaults when no file", () => { expect(loadRoostSettings(repo)).toEqual(DEFAULT_ROOST_SETTINGS); });
  it("round-trips", () => { saveRoostSettings(repo, { maxCaptureMB: 500, autoBackup: "off", autoPush: false, checkUpdates: true }); expect(loadRoostSettings(repo).maxCaptureMB).toBe(500); expect(fs.existsSync(path.join(repo, "roost", "settings.yaml"))).toBe(true); });
});

describe("RoostSettings freshness fields", () => {
  it("defaults: autoBackup daily, autoPush off, checkUpdates on", () => {
    const s = loadRoostSettings(tmpDir);
    expect(s).toEqual({ maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true });
  });
  it("round-trips all fields", () => {
    saveRoostSettings(tmpDir, { maxCaptureMB: 50, autoBackup: "weekly", autoPush: true, checkUpdates: false });
    expect(loadRoostSettings(tmpDir)).toEqual({ maxCaptureMB: 50, autoBackup: "weekly", autoPush: true, checkUpdates: false });
  });
  it("invalid values fall back per-field (forward compatible)", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "roost", "settings.yaml"), "maxCaptureMB: 25\nautoBackup: hourly\nautoPush: maybe\n", "utf8");
    const s = loadRoostSettings(tmpDir);
    expect(s.maxCaptureMB).toBe(25);
    expect(s.autoBackup).toBe(DEFAULT_ROOST_SETTINGS.autoBackup);
    expect(s.autoPush).toBe(false);
    expect(s.checkUpdates).toBe(true);
  });
});
