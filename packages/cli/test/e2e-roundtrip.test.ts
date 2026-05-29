/**
 * Real chezmoi round-trip e2e test.
 *
 * Verifies that capture (add) → apply reproduces the original file via the
 * actual `chezmoi` binary.  Skipped gracefully when chezmoi is absent.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Detect whether the real chezmoi binary is available
// ---------------------------------------------------------------------------
const hasChezmoi = spawnSync("chezmoi", ["--version"], { encoding: "utf8" }).status === 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runChecked(cmd: string, args: string[], opts?: { cwd?: string }): void {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: opts?.cwd });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (code ${r.status ?? "null"}):\n${r.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("chezmoi real round-trip e2e", () => {
  it.skipIf(!hasChezmoi)("add .zshrc then apply reproduces the original file", () => {
    const src = makeTmp("roost-e2e-src-");
    const home1 = makeTmp("roost-e2e-home1-");
    const home2 = makeTmp("roost-e2e-home2-");

    try {
      // 1. Write a dotfile in the source home
      const originalContent = "export ROOST_E2E=1\n";
      const zshrcPath = join(home1, ".zshrc");
      writeFileSync(zshrcPath, originalContent, "utf8");

      // 2. chezmoi init --source src (creates the source dir structure)
      runChecked("chezmoi", [
        "init",
        "--source", src,
        "--destination", home1,
        "--no-tty",
      ]);

      // 3. chezmoi add the file into the source dir
      runChecked("chezmoi", [
        "--source", src,
        "--destination", home1,
        "add",
        "--no-tty",
        zshrcPath,
      ]);

      // 4. Apply to a fresh empty destination home2
      runChecked("chezmoi", [
        "--source", src,
        "--destination", home2,
        "apply",
        "--no-tty",
        "--force",
      ]);

      // 5. Assert the file was reproduced exactly
      const reproduced = readFileSync(join(home2, ".zshrc"), "utf8");
      expect(reproduced).toBe(originalContent);
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(home1, { recursive: true, force: true });
      rmSync(home2, { recursive: true, force: true });
    }
  });
});
