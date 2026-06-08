import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Exec, ExecResult } from "@roost/shared";
import {
  STATE_SCHEMA_VERSION,
  stateDir,
  writeState,
  readState,
  listStateHosts,
  commitRepo,
  readBaseline,
  writeBaseline,
} from "./state.js";
import type { MachineState } from "./state.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeExec(responses: Array<{ code: number; stdout?: string; stderr?: string }>): {
  exec: Exec;
  calls: { cmd: string; args: string[] }[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
  let idx = 0;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      const r = responses[idx] ?? { code: 0 };
      idx++;
      return { code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
  return { exec, calls };
}

function makeState(overrides?: Partial<MachineState>): MachineState {
  return {
    host: "testbox",
    schemaVersion: STATE_SCHEMA_VERSION,
    capturedAt: "2025-01-01T00:00:00.000Z",
    modules: {},
    ...overrides,
  };
}

// ── setup / teardown ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-state-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── stateDir ──────────────────────────────────────────────────────────────────

describe("stateDir", () => {
  it("returns <repoDir>/state", () => {
    expect(stateDir("/my/repo")).toBe("/my/repo/state");
  });
});

// ── writeState / readState round-trip ─────────────────────────────────────────

describe("writeState + readState", () => {
  it("round-trips a MachineState by host", () => {
    const state = makeState({ host: "laptop", modules: { packages: { count: 42 } } });
    writeState(tmpDir, state);
    const loaded = readState(tmpDir, "laptop");
    expect(loaded).toEqual(state);
  });

  it("writes pretty JSON (indented)", () => {
    const state = makeState({ host: "mac" });
    writeState(tmpDir, state);
    const raw = fs.readFileSync(path.join(stateDir(tmpDir), "mac.json"), "utf8");
    expect(raw).toContain("\n");
  });

  it("creates the state directory if it does not exist", () => {
    const nested = path.join(tmpDir, "a", "b", "repo");
    const state = makeState({ host: "box" });
    writeState(nested, state);
    expect(fs.existsSync(path.join(stateDir(nested), "box.json"))).toBe(true);
  });

  it("overwrites existing file on second write", () => {
    const state1 = makeState({ host: "box", capturedAt: "2025-01-01T00:00:00.000Z" });
    const state2 = makeState({ host: "box", capturedAt: "2025-06-01T00:00:00.000Z" });
    writeState(tmpDir, state1);
    writeState(tmpDir, state2);
    expect(readState(tmpDir, "box")?.capturedAt).toBe("2025-06-01T00:00:00.000Z");
  });
});

// ── readState edge cases ──────────────────────────────────────────────────────

describe("readState", () => {
  it("returns null when file does not exist", () => {
    expect(readState(tmpDir, "no-such-host")).toBeNull();
  });

  it("throws when file contains malformed JSON", () => {
    fs.mkdirSync(stateDir(tmpDir), { recursive: true });
    fs.writeFileSync(path.join(stateDir(tmpDir), "bad.json"), "not json {{{");
    expect(() => readState(tmpDir, "bad")).toThrow();
  });

  it("throws when file contains a non-object value (null)", () => {
    fs.mkdirSync(stateDir(tmpDir), { recursive: true });
    fs.writeFileSync(path.join(stateDir(tmpDir), "null.json"), "null");
    expect(() => readState(tmpDir, "null")).toThrow();
  });

  it("throws when parsed JSON lacks required MachineState fields", () => {
    fs.mkdirSync(stateDir(tmpDir), { recursive: true });
    // Object but missing schemaVersion, host, etc.
    fs.writeFileSync(path.join(stateDir(tmpDir), "partial.json"), JSON.stringify({ foo: "bar" }));
    expect(() => readState(tmpDir, "partial")).toThrow();
  });
});

// ── listStateHosts ────────────────────────────────────────────────────────────

describe("listStateHosts", () => {
  it("returns hostnames from state/*.json files", () => {
    writeState(tmpDir, makeState({ host: "alpha" }));
    writeState(tmpDir, makeState({ host: "beta" }));
    const hosts = listStateHosts(tmpDir);
    expect(hosts).toContain("alpha");
    expect(hosts).toContain("beta");
    expect(hosts).toHaveLength(2);
  });

  it("returns empty array when state dir does not exist", () => {
    expect(listStateHosts(path.join(tmpDir, "nonexistent"))).toEqual([]);
  });

  it("ignores non-.json files in state dir", () => {
    fs.mkdirSync(stateDir(tmpDir), { recursive: true });
    fs.writeFileSync(path.join(stateDir(tmpDir), "README"), "not json");
    writeState(tmpDir, makeState({ host: "gamma" }));
    const hosts = listStateHosts(tmpDir);
    expect(hosts).toEqual(["gamma"]);
  });
});

// ── commitRepo ────────────────────────────────────────────────────────────────

describe("commitRepo", () => {
  it("calls git add -A then git commit -m <message>", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0 }, { code: 0 }]);
    await commitRepo(exec, "/my/repo", "test: save state");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.cmd).toBe("git");
    expect(calls[0]!.args).toEqual(["-C", "/my/repo", "add", "-A"]);
    expect(calls[1]!.cmd).toBe("git");
    expect(calls[1]!.args).toEqual([
      "-C", "/my/repo",
      "-c", "user.name=Roost",
      "-c", "user.email=roost@localhost",
      "commit", "-m", "test: save state",
    ]);
  });

  it("does not throw when commit exits non-zero with 'nothing to commit' stdout", async () => {
    const { exec } = makeFakeExec([
      { code: 0 },
      { code: 1, stdout: "nothing to commit, working tree clean", stderr: "" },
    ]);
    await expect(commitRepo(exec, "/my/repo", "chore: noop")).resolves.toBeUndefined();
  });

  it("does not throw when commit exits non-zero with 'nothing to commit' in stderr", async () => {
    const { exec } = makeFakeExec([
      { code: 0 },
      { code: 1, stdout: "", stderr: "nothing to commit" },
    ]);
    await expect(commitRepo(exec, "/my/repo", "chore: noop")).resolves.toBeUndefined();
  });

  it("throws on real commit failure (non-zero, no 'nothing to commit')", async () => {
    const { exec } = makeFakeExec([
      { code: 0 },
      { code: 1, stdout: "", stderr: "error: pathspec does not match" },
    ]);
    await expect(commitRepo(exec, "/my/repo", "fail")).rejects.toThrow();
  });
});

describe("MachineState v2 baseline", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-state-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("STATE_SCHEMA_VERSION is 2", () => {
    expect(STATE_SCHEMA_VERSION).toBe(2);
  });

  it("reads a v1 state file tolerantly (new fields default)", () => {
    const dir = stateDir(tmp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "old.json"),
      JSON.stringify({ host: "old", schemaVersion: 1, capturedAt: null, modules: {} }),
      "utf8",
    );
    const s = readState(tmp, "old");
    expect(s).not.toBeNull();
    expect(s!.lastSyncedCommit).toBeUndefined();
    expect(readBaseline(s!, "dotfiles")).toEqual({});
  });

  it("writeBaseline + readBaseline round-trips per module", () => {
    const s: MachineState = {
      host: "h",
      schemaVersion: STATE_SCHEMA_VERSION,
      capturedAt: null,
      modules: {},
    };
    const next = writeBaseline(s, "env", { EDITOR: "hash1", PAGER: "hash2" });
    expect(readBaseline(next, "env")).toEqual({ EDITOR: "hash1", PAGER: "hash2" });
    expect(readBaseline(next, "dotfiles")).toEqual({}); // untouched module
  });
});
