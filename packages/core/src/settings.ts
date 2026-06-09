import * as fs from "node:fs"; import * as path from "node:path"; import * as yaml from "js-yaml";
export interface RoostSettings { maxCaptureMB: number }
export const DEFAULT_ROOST_SETTINGS: RoostSettings = { maxCaptureMB: 100 };
function settingsPath(repoDir: string): string { return path.join(repoDir, "roost", "settings.yaml"); }
export function loadRoostSettings(repoDir: string): RoostSettings {
  try {
    const raw = yaml.load(fs.readFileSync(settingsPath(repoDir), "utf8"));
    if (raw && typeof raw === "object" && typeof (raw as { maxCaptureMB?: unknown }).maxCaptureMB === "number") {
      return { maxCaptureMB: (raw as { maxCaptureMB: number }).maxCaptureMB };
    }
  } catch { /* fall through to default */ }
  return { ...DEFAULT_ROOST_SETTINGS };
}
export function saveRoostSettings(repoDir: string, s: RoostSettings): void {
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  fs.writeFileSync(settingsPath(repoDir), yaml.dump(s), "utf8");
}
