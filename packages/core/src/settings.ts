import * as fs from "node:fs"; import * as path from "node:path"; import * as yaml from "js-yaml";
export type AutoBackupFreq = "off" | "daily" | "weekly";
export interface RoostSettings { maxCaptureMB: number; autoBackup: AutoBackupFreq; autoPush: boolean; checkUpdates: boolean }
export const DEFAULT_ROOST_SETTINGS: RoostSettings = { maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true };
function settingsPath(repoDir: string): string { return path.join(repoDir, "roost", "settings.yaml"); }
const FREQS: AutoBackupFreq[] = ["off", "daily", "weekly"];
export function loadRoostSettings(repoDir: string): RoostSettings {
  const s = { ...DEFAULT_ROOST_SETTINGS };
  try {
    const raw = yaml.load(fs.readFileSync(settingsPath(repoDir), "utf8"));
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      if (typeof r["maxCaptureMB"] === "number" && r["maxCaptureMB"] >= 0) s.maxCaptureMB = r["maxCaptureMB"];
      if (FREQS.includes(r["autoBackup"] as AutoBackupFreq)) s.autoBackup = r["autoBackup"] as AutoBackupFreq;
      if (typeof r["autoPush"] === "boolean") s.autoPush = r["autoPush"];
      if (typeof r["checkUpdates"] === "boolean") s.checkUpdates = r["checkUpdates"];
    }
  } catch { /* missing/corrupt file → defaults */ }
  return s;
}
export function saveRoostSettings(repoDir: string, s: RoostSettings): void {
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  fs.writeFileSync(settingsPath(repoDir), yaml.dump(s), "utf8");
}
