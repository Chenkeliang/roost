import { describe, it, expect } from "vitest";
import type { Exec, ExecResult } from "@roost/shared";
import { cloneRepo, remoteHead, checkPushSafety } from "./onboarding.js";

function fakeExec(handler: (cmd: string, args: string[]) => Partial<ExecResult>): Exec {
  return {
    async run(cmd, args) {
      const r = handler(cmd, args);
      return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}

describe("cloneRepo", () => {
  it("ok on exit 0", async () => {
    const exec = fakeExec(() => ({ code: 0 }));
    expect(await cloneRepo(exec, "git@host:me/cfg.git", "/dest")).toEqual({ ok: true });
  });
  it("returns error on non-zero", async () => {
    const exec = fakeExec(() => ({ code: 128, stderr: "fatal: repository not found" }));
    const out = await cloneRepo(exec, "bad", "/dest");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("not found");
  });
});

describe("remoteHead", () => {
  it("parses the sha from ls-remote", async () => {
    const exec = fakeExec(() => ({ code: 0, stdout: "9f3a1c2deadbeef\tHEAD\n" }));
    expect(await remoteHead(exec, "/r")).toBe("9f3a1c2deadbeef");
  });
  it("null when ls-remote fails", async () => {
    const exec = fakeExec(() => ({ code: 1, stderr: "no remote" }));
    expect(await remoteHead(exec, "/r")).toBeNull();
  });
  it("null on empty output", async () => {
    const exec = fakeExec(() => ({ code: 0, stdout: "" }));
    expect(await remoteHead(exec, "/r")).toBeNull();
  });
});

describe("checkPushSafety", () => {
  it("ok when remote unreachable (do not block)", async () => {
    const exec = fakeExec(() => ({ code: 1 }));
    expect(await checkPushSafety(exec, "/r", "abc")).toBe("ok");
  });
  it("ok when remote head matches recorded", async () => {
    const exec = fakeExec(() => ({ code: 0, stdout: "abc1234def\tHEAD" }));
    expect(await checkPushSafety(exec, "/r", "abc1234def")).toBe("ok");
  });
  it("pull-first when remote advanced", async () => {
    const exec = fakeExec(() => ({ code: 0, stdout: "def5678abc\tHEAD" }));
    expect(await checkPushSafety(exec, "/r", "abc1234def")).toBe("pull-first");
  });
});
