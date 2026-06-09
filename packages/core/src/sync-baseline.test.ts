import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { hashContent, loadModuleBaseline } from "./sync-baseline.js";
import { writeState, stateDir } from "./state.js";

describe("hashContent", () => {
  it("null in → null out", () => {
    expect(hashContent(null)).toBeNull();
  });
  it("is deterministic and content-sensitive", () => {
    expect(hashContent("a")).toBe(hashContent("a"));
    expect(hashContent("a")).not.toBe(hashContent("b"));
    expect(hashContent("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("loadModuleBaseline", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-bl-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns {} when no state file exists", () => {
    expect(loadModuleBaseline(tmp, "appconfig")).toEqual({});
  });
  it("returns the module's baseline bag when present", () => {
    writeState(tmp, {
      host: os.hostname(),
      schemaVersion: 2,
      capturedAt: null,
      modules: { appconfig: { baseline: { "domain:x": "h1" } } },
    });
    expect(loadModuleBaseline(tmp, "appconfig")).toEqual({ "domain:x": "h1" });
  });
  it("returns {} (no throw) on a malformed state file", () => {
    const dir = stateDir(tmp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${os.hostname()}.json`), "{not json", "utf8");
    expect(loadModuleBaseline(tmp, "appconfig")).toEqual({});
  });
});
