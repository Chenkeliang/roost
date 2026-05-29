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
