import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult } from "@roost/shared";
import { runKeyRotate } from "./keyRotate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CallRecord = { cmd: string; args: string[] };

function makeFakeExec(
  handler: (cmd: string, args: string[]) => ExecResult,
): { exec: Exec; calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  const exec: Exec = {
    async run(cmd, args) {
      calls.push({ cmd, args });
      return handler(cmd, args);
    },
  };
  return { exec, calls };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-rotate-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runKeyRotate", () => {
  it("calls rotateAgeKey with the provided options and prints a summary", async () => {
    const ageFile = path.join(tmpDir, "secret.age");
    fs.writeFileSync(ageFile, "encrypted", "utf8");

    const { exec, calls } = makeFakeExec((cmd, args) => {
      // Simulate age writing output files for decrypt and encrypt
      const oIdx = args.indexOf("-o");
      if (oIdx >= 0) {
        const dest = args[oIdx + 1];
        if (dest) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, "payload", "utf8");
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const lines: string[] = [];
    const log = (msg: string): void => { lines.push(msg); };

    await runKeyRotate({
      exec,
      repoDir: tmpDir,
      oldKeyPath: "/old.key",
      newRecipient: "age1testrecipient",
      log,
    });

    // At least one call to age for the .age file
    expect(calls.some((c) => c.cmd === "age")).toBe(true);

    // Output includes a summary line mentioning rotated count
    const summary = lines.join("\n");
    expect(summary).toMatch(/1/); // 1 rotated
    expect(summary).toMatch(/rotat/i);
  });

  it("prints failure paths when rotation fails", async () => {
    const ageFile = path.join(tmpDir, "broken.age");
    fs.writeFileSync(ageFile, "bad", "utf8");

    const { exec } = makeFakeExec(() => ({
      code: 1, stdout: "", stderr: "decrypt error",
    }));

    const lines: string[] = [];
    const log = (msg: string): void => { lines.push(msg); };

    await runKeyRotate({
      exec,
      repoDir: tmpDir,
      oldKeyPath: "/old.key",
      newRecipient: "age1rec",
      log,
    });

    const output = lines.join("\n");
    expect(output).toMatch(/0.*rotat/i);
    expect(output).toContain(ageFile);
  });

  it("reports zero rotated when no .age files exist", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "hi", "utf8");

    const { exec } = makeFakeExec(() => ({ code: 0, stdout: "", stderr: "" }));
    const lines: string[] = [];
    await runKeyRotate({
      exec,
      repoDir: tmpDir,
      oldKeyPath: "/old.key",
      newRecipient: "age1rec",
      log: (msg) => { lines.push(msg); },
    });

    expect(lines.join("\n")).toMatch(/0.*rotat/i);
  });
});
