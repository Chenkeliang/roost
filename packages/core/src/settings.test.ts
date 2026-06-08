import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs"; import * as os from "node:os"; import * as path from "node:path";
import { DEFAULT_ROOST_SETTINGS, loadRoostSettings, saveRoostSettings } from "./settings.js";
let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-set-")); });
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });
describe("roost settings", () => {
  it("defaults maxCaptureMB to 100", () => { expect(DEFAULT_ROOST_SETTINGS.maxCaptureMB).toBe(100); });
  it("returns defaults when no file", () => { expect(loadRoostSettings(repo)).toEqual(DEFAULT_ROOST_SETTINGS); });
  it("round-trips", () => { saveRoostSettings(repo, { maxCaptureMB: 500 }); expect(loadRoostSettings(repo).maxCaptureMB).toBe(500); expect(fs.existsSync(path.join(repo, "roost", "settings.yaml"))).toBe(true); });
});
