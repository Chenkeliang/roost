import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult } from "@roost/shared";
import type { SecretBackend } from "./backend.js";
import { ensureAgeKey } from "./agekey.js";

function makeFakeExec(
  handler?: (cmd: string, args: string[]) => ExecResult,
): { exec: Exec; calls: { cmd: string; args: string[] }[] } {
  const calls: { cmd: string; args: string[] }[] = [];
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      if (handler) return handler(cmd, args);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { exec, calls };
}

function makeFakeBackend(secret: string, calls: string[] = []): SecretBackend {
  return {
    name: "fake",
    async get(ref: string): Promise<string> {
      calls.push(ref);
      return secret;
    },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agekey-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureAgeKey", () => {
  it("returns existing when keyPath already exists", async () => {
    const keyPath = path.join(tmpDir, "age.key");
    fs.writeFileSync(keyPath, "AGE-SECRET-KEY-EXISTING", "utf8");

    const { exec, calls } = makeFakeExec();
    const backendCalls: string[] = [];
    const backend = makeFakeBackend("should-not-be-called", backendCalls);

    const result = await ensureAgeKey(exec, { keyPath, backend, backendRef: "some/ref" });

    expect(result.path).toBe(keyPath);
    expect(result.created).toBe(false);
    expect(result.source).toBe("existing");
    expect(calls).toHaveLength(0);
    expect(backendCalls).toHaveLength(0);
  });

  it("fetches from backend when provided and writes file with mode 0o600", async () => {
    const keyPath = path.join(tmpDir, "subdir", "age.key");
    const backendSecret = "AGE-SECRET-KEY-FROMBACKEND";
    const backendRef = "op://vault/age-key/value";

    const { exec, calls } = makeFakeExec();
    const backendCalls: string[] = [];
    const backend = makeFakeBackend(backendSecret, backendCalls);

    const result = await ensureAgeKey(exec, { keyPath, backend, backendRef });

    expect(result.path).toBe(keyPath);
    expect(result.created).toBe(true);
    expect(result.source).toBe("backend");

    // file exists with correct content
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.readFileSync(keyPath, "utf8")).toBe(backendSecret);

    // mode 0o600
    const mode = fs.statSync(keyPath).mode & 0o777;
    expect(mode).toBe(0o600);

    // backend was called with correct ref
    expect(backendCalls).toEqual([backendRef]);

    // exec not called for age-keygen
    expect(calls).toHaveLength(0);
  });

  it("throws if backend is provided but backendRef is missing", async () => {
    const keyPath = path.join(tmpDir, "age.key");
    const { exec } = makeFakeExec();
    const backend = makeFakeBackend("secret");

    await expect(ensureAgeKey(exec, { keyPath, backend })).rejects.toThrow(/backendRef/);
  });

  it("generates via age-keygen when no backend provided", async () => {
    const keyPath = path.join(tmpDir, "age.key");
    const fakeKey = "AGE-SECRET-KEY-GENERATED";

    const { exec, calls } = makeFakeExec((cmd, args) => {
      // fake age-keygen writes the file itself (simulating real behavior)
      if (cmd === "age-keygen") {
        const outIdx = args.indexOf("-o");
        if (outIdx >= 0) {
          const dest = args[outIdx + 1];
          if (dest) fs.writeFileSync(dest, fakeKey, "utf8");
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await ensureAgeKey(exec, { keyPath });

    expect(result.path).toBe(keyPath);
    expect(result.created).toBe(true);
    expect(result.source).toBe("generated");

    // exec was called with age-keygen -o <keyPath>
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ cmd: "age-keygen", args: ["-o", keyPath] });

    // file exists (written by fake exec) and mode is 0o600
    expect(fs.existsSync(keyPath)).toBe(true);
    const mode = fs.statSync(keyPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("throws when age-keygen exits non-zero", async () => {
    const keyPath = path.join(tmpDir, "age.key");
    const { exec } = makeFakeExec(() => ({ code: 1, stdout: "", stderr: "age-keygen failed" }));

    await expect(ensureAgeKey(exec, { keyPath })).rejects.toThrow("age-keygen failed");
  });

  it("creates parent directories when they do not exist", async () => {
    const keyPath = path.join(tmpDir, "deep", "nested", "dir", "age.key");
    const { exec } = makeFakeExec((cmd, args) => {
      if (cmd === "age-keygen") {
        const outIdx = args.indexOf("-o");
        const dest = args[outIdx + 1];
        if (dest) fs.writeFileSync(dest, "key-content", "utf8");
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await ensureAgeKey(exec, { keyPath });
    expect(result.source).toBe("generated");
    expect(fs.existsSync(keyPath)).toBe(true);
  });
});
