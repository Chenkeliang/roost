import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext } from "@roost/shared";
import { loadSelection } from "@roost/core";
import { runSelect } from "./select.js";

function makeFakeExec(responses: ExecResult[]): Exec {
  let idx = 0;
  return {
    async run(): Promise<ExecResult> {
      const r = responses[idx] ?? { code: 0, stdout: "", stderr: "" };
      idx++;
      return r;
    },
  };
}

function makeCtx(overrides: Partial<ModuleContext> & { exec: Exec; home: string }): ModuleContext {
  return {
    repoDir: overrides.home!, // we'll set repoDir explicitly from the test
    profile: "base",
    dryRun: false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (key: string) => key,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-select-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runSelect", () => {
  it("--all: discovers candidates and saves a selection file", async () => {
    const repoDir = path.join(tmpDir, "repo");
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    // Create a dotfile in home
    fs.writeFileSync(path.join(home, ".zshrc"), "# zsh");

    const exec = makeFakeExec([
      { code: 0, stdout: "", stderr: "" }, // brew --version (packages discover)
    ]);
    const ctx = makeCtx({ exec, home, repoDir });

    const sel = await runSelect({ repoDir, ctx, all: true });

    // Selection should have been saved
    const loaded = loadSelection(repoDir);
    expect(loaded.modules).toBeDefined();

    // The returned selection should include .zshrc (track candidate) in dotfiles
    const dotfileIds = sel.modules["dotfiles"] ?? [];
    expect(dotfileIds.some((id) => id.endsWith(".zshrc"))).toBe(true);
  });

  it("--preset developer-essentials: selects only preset candidates", async () => {
    const repoDir = path.join(tmpDir, "repo");
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    // Create a .zshrc and an unrelated dotfile
    fs.writeFileSync(path.join(home, ".zshrc"), "# zsh");
    fs.writeFileSync(path.join(home, ".vimrc"), "# vim");

    const exec = makeFakeExec([
      { code: 0, stdout: "", stderr: "" }, // brew --version
    ]);
    const ctx = makeCtx({ exec, home, repoDir });

    const sel = await runSelect({ repoDir, ctx, preset: "developer-essentials" });

    const dotfileIds = sel.modules["dotfiles"] ?? [];
    expect(dotfileIds.some((id) => id.endsWith(".zshrc"))).toBe(true);
    // .vimrc is not in developer-essentials
    expect(dotfileIds.some((id) => id.endsWith(".vimrc"))).toBe(false);
  });

  it("throws when neither --all nor --preset is specified", async () => {
    const repoDir = path.join(tmpDir, "repo");
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    const exec = makeFakeExec([]);
    const ctx = makeCtx({ exec, home, repoDir });

    await expect(runSelect({ repoDir, ctx })).rejects.toThrow(/--all or --preset/i);
  });
});
