import { describe, it, expect } from "vitest";
import type { Exec, ExecResult } from "@roost/shared";
import { createChezmoi } from "./chezmoi.js";

// Fake exec that records all calls and returns a canned result
function makeFakeExec(responses: ExecResult[]): { exec: Exec; calls: { cmd: string; args: string[] }[] } {
  const calls: { cmd: string; args: string[] }[] = [];
  let idx = 0;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      const result = responses[idx] ?? { code: 0, stdout: "", stderr: "" };
      idx++;
      return result;
    },
  };
  return { exec, calls };
}

describe("createChezmoi", () => {
  const sourceDir = "/tmp/chezmoi-source";

  it("add: passes --source and path", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    await chezmoi.add("/home/user/.zshrc");
    expect(calls[0]).toEqual({
      cmd: "chezmoi",
      args: ["--source", sourceDir, "add", "/home/user/.zshrc"],
    });
  });

  it("add with encrypt: includes --encrypt flag", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    await chezmoi.add("/home/user/.ssh/id_rsa", { encrypt: true });
    expect(calls[0]).toEqual({
      cmd: "chezmoi",
      args: ["--source", sourceDir, "add", "--encrypt", "/home/user/.ssh/id_rsa"],
    });
  });

  it("add throws on non-zero exit", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "", stderr: "some error" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    await expect(chezmoi.add("/home/user/.zshrc")).rejects.toThrow("some error");
  });

  it("apply: passes --source", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "applied!\n", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    const result = await chezmoi.apply();
    expect(calls[0]).toEqual({
      cmd: "chezmoi",
      args: ["--source", sourceDir, "apply"],
    });
    expect(result).toBe("applied!\n");
  });

  it("apply with paths: scopes to the given target paths", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    await chezmoi.apply({ paths: ["/home/u/.zshrc", "/home/u/.gitconfig"] });
    expect(calls[0]).toEqual({
      cmd: "chezmoi",
      args: ["--source", sourceDir, "apply", "/home/u/.zshrc", "/home/u/.gitconfig"],
    });
  });

  it("apply with dryRun: includes --dry-run flag", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "dry run output\n", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    const result = await chezmoi.apply({ dryRun: true });
    expect(calls[0]).toEqual({
      cmd: "chezmoi",
      args: ["--source", sourceDir, "apply", "--dry-run"],
    });
    expect(result).toBe("dry run output\n");
  });

  it("apply throws on non-zero exit", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "", stderr: "apply failed" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    await expect(chezmoi.apply()).rejects.toThrow("apply failed");
  });

  it("diff: passes --source", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "diff output\n", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    const result = await chezmoi.diff();
    expect(calls[0]).toEqual({
      cmd: "chezmoi",
      args: ["--source", sourceDir, "diff"],
    });
    expect(result).toBe("diff output\n");
  });

  it("verify: returns true on exit 0", async () => {
    const { exec } = makeFakeExec([{ code: 0, stdout: "", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    expect(await chezmoi.verify()).toBe(true);
  });

  it("verify: returns false on non-zero exit", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "", stderr: "drift found" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    expect(await chezmoi.verify()).toBe(false);
  });

  it("changedPaths: parses `chezmoi status` lines to target paths", async () => {
    const { exec, calls } = makeFakeExec([
      { code: 0, stdout: " M .zshrc\nA  .config/foo\n M Library/Application Support/App/x\n\n", stderr: "" },
    ]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    const result = await chezmoi.changedPaths();
    expect(calls[0]?.args).toContain("status");
    expect(result).toEqual([".zshrc", ".config/foo", "Library/Application Support/App/x"]);
  });

  it("managed: splits stdout on newlines and filters empty strings", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "/home/user/.zshrc\n/home/user/.vimrc\n\n", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    const result = await chezmoi.managed();
    expect(calls[0]).toEqual({
      cmd: "chezmoi",
      args: ["--source", sourceDir, "managed"],
    });
    expect(result).toEqual(["/home/user/.zshrc", "/home/user/.vimrc"]);
  });

  it("forget: passes --source, forget, --force, and path", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "", stderr: "" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    await chezmoi.forget("/home/user/.zshrc");
    expect(calls[0]).toEqual({
      cmd: "chezmoi",
      args: ["--source", sourceDir, "forget", "--force", "/home/user/.zshrc"],
    });
  });

  it("forget: throws on non-zero exit", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "", stderr: "forget failed" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    await expect(chezmoi.forget("/home/user/.zshrc")).rejects.toThrow("forget failed");
  });

  it("forget: tolerates 'not managed' as a no-op (path was never captured)", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "", stderr: "chezmoi: /home/user/.zshr: not managed" }]);
    const chezmoi = createChezmoi(exec, { sourceDir });
    await expect(chezmoi.forget("/home/user/.zshr")).resolves.toBeUndefined();
  });
});
