import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext } from "@roost/shared";
import { saveSelection, emptySelection, addItem } from "@roost/core";
import { runLoad } from "./load.js";

function makeFakeExec(responses: ExecResult[]): { exec: Exec } {
  let idx = 0;
  const exec: Exec = {
    async run(): Promise<ExecResult> {
      const r = responses[idx] ?? { code: 0, stdout: "", stderr: "" };
      idx++;
      return r;
    },
  };
  return { exec };
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-load-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runLoad", () => {
  it("apply=true: backs up existing managed file and reports applied work", async () => {
    const repoDir = path.join(tmpDir, "repo");
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    // Create a real dotfile in home that chezmoi manages
    const zshrcPath = path.join(home, ".zshrc");
    fs.writeFileSync(zshrcPath, "# existing zshrc");

    // Selection: dotfiles module with this file
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", zshrcPath);
    saveSelection(repoDir, sel);

    // chezmoi managed returns relative path ".zshrc", then chezmoi apply runs
    const { exec } = makeFakeExec([
      { code: 0, stdout: ".zshrc\n", stderr: "" }, // chezmoi managed
      { code: 0, stdout: "", stderr: "" },          // chezmoi apply
    ]);
    const ctx = makeCtx({ exec, home, repoDir });

    const results = await runLoad({ repoDir, ctx, apply: true });

    // A backup file should have been created under the backup dir
    const backupDir = path.join(home, ".roost-backups", "load");
    const zshrcRel = zshrcPath.replace(/^[/\\]/, "");
    expect(fs.existsSync(path.join(backupDir, zshrcRel))).toBe(true);

    // The result should show applied work (not skipped)
    const dotResult = results.find((r) => r.module === "dotfiles");
    expect(dotResult).toBeDefined();
    expect(dotResult?.backedUp).toContain(zshrcPath);
    // applied array contains the dotfile id (chezmoi apply was called in non-dry-run mode)
    expect(dotResult?.applied).toContain(zshrcPath);
  });

  it("dry-run (apply=false): no backup dir created", async () => {
    const repoDir = path.join(tmpDir, "repo");
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    let sel = emptySelection();
    sel = addItem(sel, "packages", "Brewfile");
    saveSelection(repoDir, sel);

    const { exec } = makeFakeExec(
      Array.from({ length: 10 }, () => ({ code: 0, stdout: "", stderr: "" })),
    );
    const ctx = makeCtx({ exec, home, repoDir });

    const results = await runLoad({ repoDir, ctx, apply: false });

    // Default backup dir is home/.roost-backups/load
    const backupDir = path.join(home, ".roost-backups", "load");
    expect(fs.existsSync(backupDir)).toBe(false);

    // packages should be skipped in dry-run
    const pkgResult = results.find((r) => r.module === "packages");
    expect(pkgResult?.skipped).toContain("Brewfile");
  });
});
