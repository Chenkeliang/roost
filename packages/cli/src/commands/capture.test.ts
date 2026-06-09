import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext } from "@roost/shared";
import { saveSelection, emptySelection, addItem } from "@roost/core";
import { runCapture } from "./capture.js";

type Call = { cmd: string; args: string[] };

function makeFakeExec(responses: ExecResult[]): { exec: Exec; calls: Call[] } {
  let idx = 0;
  const calls: Call[] = [];
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      const r = responses[idx] ?? { code: 0, stdout: "", stderr: "" };
      idx++;
      return r;
    },
  };
  return { exec, calls };
}

function makeCtx(overrides: Partial<ModuleContext> & { exec: Exec; home: string; repoDir: string }): ModuleContext {
  return {
    profile: "base",
    dryRun: false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (key: string) => key,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-capture-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runCapture", () => {
  it("invokes chezmoi add for dotfiles and git commit", async () => {
    const repoDir = path.join(tmpDir, "repo");
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    const dotfileId = path.join(home, ".zshrc");
    fs.writeFileSync(dotfileId, "# safe content");

    // Save a selection with the dotfile
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", dotfileId);
    saveSelection(repoDir, sel);

    // responses: chezmoi add, git add -A, git commit
    const { exec, calls } = makeFakeExec(
      Array.from({ length: 20 }, () => ({ code: 0, stdout: "", stderr: "" })),
    );
    const ctx = makeCtx({ exec, home, repoDir });

    const changeSets = await runCapture({ repoDir, ctx });

    expect(changeSets.length).toBeGreaterThan(0);

    // chezmoi add should have been called
    const chezmoiAdd = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add"));
    expect(chezmoiAdd).toBeDefined();

    // git commit should have been called
    const gitCommit = calls.find((c) => c.cmd === "git" && c.args.includes("commit"));
    expect(gitCommit).toBeDefined();
  });

  it("throws (gateSecrets) when dotfile content has a secret AND chezmoi add is never called", async () => {
    const repoDir = path.join(tmpDir, "repo");
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    // Write a dotfile with a secret
    const dotfileId = path.join(home, ".zshrc");
    fs.writeFileSync(dotfileId, "export AWS_KEY=AKIAIOSFODNN7EXAMPLE1234");

    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", dotfileId);
    saveSelection(repoDir, sel);

    const { exec, calls } = makeFakeExec(
      Array.from({ length: 20 }, () => ({ code: 0, stdout: "", stderr: "" })),
    );
    const ctx = makeCtx({ exec, home, repoDir });

    await expect(runCapture({ repoDir, ctx })).rejects.toThrow(/secret/i);

    // chezmoi add must NOT have been called — gate fired before capture
    const chezmoiAdd = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add"));
    expect(chezmoiAdd).toBeUndefined();
  });
});
