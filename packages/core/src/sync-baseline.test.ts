import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { hashContent, loadModuleBaseline, recordModuleBaseline, loadModuleEncHashes, recordModuleEncHashes } from "./sync-baseline.js";
import { writeState, stateDir, readState, readBaseline } from "./state.js";

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

describe("recordModuleBaseline", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-rec-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates a state file with the baseline + sync metadata when none exists", () => {
    recordModuleBaseline(tmp, "h1", "appconfig", { "domain:x": "hx" }, {
      lastSyncedCommit: "9f3a1c2def",
      lastSeen: "2026-06-08T00:00:00Z",
    });
    const st = readState(tmp, "h1")!;
    expect(st.schemaVersion).toBe(2);
    expect(st.lastSyncedCommit).toBe("9f3a1c2def");
    expect(loadModuleBaseline(tmp, "appconfig")).toEqual({}); // different host (os.hostname) → empty
    expect((st.modules["appconfig"] as { baseline: unknown }).baseline).toEqual({ "domain:x": "hx" });
  });

  it("merges into an existing state file without clobbering other modules", () => {
    recordModuleBaseline(tmp, "h2", "appconfig", { a: "1" });
    recordModuleBaseline(tmp, "h2", "env", { "env.sh": "2" });
    const st = readState(tmp, "h2")!;
    expect((st.modules["appconfig"] as { baseline: unknown }).baseline).toEqual({ a: "1" });
    expect((st.modules["env"] as { baseline: unknown }).baseline).toEqual({ "env.sh": "2" });
  });

  it("starts fresh (no throw) when the prior state file is malformed", () => {
    const dir = stateDir(tmp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "h3.json"), "{bad", "utf8");
    expect(() => recordModuleBaseline(tmp, "h3", "env", { "env.sh": "z" })).not.toThrow();
    const st = readState(tmp, "h3")!;
    expect((st.modules["env"] as { baseline: unknown }).baseline).toEqual({ "env.sh": "z" });
  });
});

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-ench-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("encHashes (ADR-0021)", () => {
  it("round-trips and MERGES per-module plaintext hashes", () => {
    const host = "test-host";
    recordModuleEncHashes(tmpDir, host, "dotfiles", { "/a": "h1", "/b": "h2" });
    recordModuleEncHashes(tmpDir, host, "dotfiles", { "/b": "h2x", "/c": "h3" });
    // loadModuleEncHashes reads THIS machine's host; emulate by reading state directly
    const st = readState(tmpDir, host);
    expect(st).not.toBeNull();
    const entry = st!.modules["dotfiles"] as { encHashes?: Record<string, string> };
    expect(entry.encHashes).toEqual({ "/a": "h1", "/b": "h2x", "/c": "h3" });
  });

  it("does not disturb the ADR-0018 baseline bag", () => {
    const host = "test-host";
    recordModuleEncHashes(tmpDir, host, "dotfiles", { "/a": "h1" });
    const st = readState(tmpDir, host)!;
    expect(readBaseline(st, "dotfiles")).toEqual({});
  });

  it("loadModuleEncHashes returns {} when no state exists", () => {
    expect(loadModuleEncHashes(tmpDir, "dotfiles")).toEqual({});
  });
});
