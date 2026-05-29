import { describe, it, expect } from "vitest";
import type { Exec, ExecResult } from "@roost/shared";
import { createOpBackend, createRbwBackend } from "./backend.js";

function makeFakeExec(
  result: ExecResult,
): { exec: Exec; calls: { cmd: string; args: string[] }[] } {
  const calls: { cmd: string; args: string[] }[] = [];
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      return result;
    },
  };
  return { exec, calls };
}

describe("createOpBackend", () => {
  it("name is '1password'", () => {
    const { exec } = makeFakeExec({ code: 0, stdout: "", stderr: "" });
    expect(createOpBackend(exec).name).toBe("1password");
  });

  it("calls op read with ref and returns trimmed stdout", async () => {
    const { exec, calls } = makeFakeExec({ code: 0, stdout: "  my-secret\n  ", stderr: "" });
    const backend = createOpBackend(exec);
    const result = await backend.get("op://vault/item/field");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ cmd: "op", args: ["read", "op://vault/item/field"] });
    expect(result).toBe("my-secret");
  });

  it("throws with stderr on non-zero exit", async () => {
    const { exec } = makeFakeExec({ code: 1, stdout: "", stderr: "not signed in" });
    const backend = createOpBackend(exec);
    await expect(backend.get("op://vault/item/field")).rejects.toThrow("not signed in");
  });

  it("throws generic message when stderr is empty on non-zero exit", async () => {
    const { exec } = makeFakeExec({ code: 2, stdout: "", stderr: "" });
    const backend = createOpBackend(exec);
    await expect(backend.get("op://vault/item/field")).rejects.toThrow(/op exited with code 2/);
  });
});

describe("createRbwBackend", () => {
  it("name is 'rbw'", () => {
    const { exec } = makeFakeExec({ code: 0, stdout: "", stderr: "" });
    expect(createRbwBackend(exec).name).toBe("rbw");
  });

  it("calls rbw get with ref and returns trimmed stdout", async () => {
    const { exec, calls } = makeFakeExec({ code: 0, stdout: "bitwarden-secret\n", stderr: "" });
    const backend = createRbwBackend(exec);
    const result = await backend.get("mylogin");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ cmd: "rbw", args: ["get", "mylogin"] });
    expect(result).toBe("bitwarden-secret");
  });

  it("throws with stderr on non-zero exit", async () => {
    const { exec } = makeFakeExec({ code: 1, stdout: "", stderr: "locked" });
    const backend = createRbwBackend(exec);
    await expect(backend.get("mylogin")).rejects.toThrow("locked");
  });

  it("throws generic message when stderr is empty on non-zero exit", async () => {
    const { exec } = makeFakeExec({ code: 3, stdout: "", stderr: "" });
    const backend = createRbwBackend(exec);
    await expect(backend.get("mylogin")).rejects.toThrow(/rbw exited with code 3/);
  });
});
