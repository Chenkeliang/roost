import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, Logger } from "@roost/shared";
import { runClone } from "./clone.js";

function fakeExec(handler: (cmd: string, args: string[]) => Partial<ExecResult>): Exec {
  return {
    async run(cmd, args) {
      const r = handler(cmd, args);
      return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}
const silentLog: Logger = { info() {}, warn() {}, error() {} };

describe("runClone", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-clone-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("clones into an empty/nonexistent destination", async () => {
    const dest = path.join(tmp, "chezmoi");
    const exec = fakeExec((cmd, args) => {
      expect(cmd).toBe("git");
      expect(args[0]).toBe("clone");
      return { code: 0 };
    });
    const res = await runClone({ url: "git@host:me/cfg.git", dest, exec, log: silentLog });
    expect(res.ok).toBe(true);
  });

  it("refuses a non-empty destination (no clobber)", async () => {
    const dest = path.join(tmp, "existing");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "keep.txt"), "x", "utf8");
    let cloneCalled = false;
    const exec = fakeExec(() => {
      cloneCalled = true;
      return { code: 0 };
    });
    const res = await runClone({ url: "u", dest, exec, log: silentLog });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not empty");
    expect(cloneCalled).toBe(false);
  });

  it("propagates a clone failure", async () => {
    const dest = path.join(tmp, "chezmoi");
    const exec = fakeExec(() => ({ code: 128, stderr: "fatal: repository not found" }));
    const res = await runClone({ url: "bad", dest, exec, log: silentLog });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not found");
  });
});
