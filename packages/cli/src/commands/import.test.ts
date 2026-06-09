import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runImport } from "./import.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-import-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runImport", () => {
  it("source=dotfiles: returns candidates from a dotfiles dir", async () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    const dotfilesDir = path.join(tmpDir, "dotfiles-repo");
    fs.mkdirSync(dotfilesDir);
    fs.writeFileSync(path.join(dotfilesDir, ".zshrc"), "# zsh");
    fs.writeFileSync(path.join(dotfilesDir, ".vimrc"), "# vim");

    const results = await runImport({ home, source: "dotfiles", path: dotfilesDir });

    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.some((c) => c.path.endsWith(".zshrc"))).toBe(true);
  });

  it("source=dotfiles: requires path option", async () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    await expect(runImport({ home, source: "dotfiles" })).rejects.toThrow(/path/i);
  });

  it("source=mackup: returns candidates from .mackup/ custom cfg", async () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(path.join(home, ".mackup"), { recursive: true });
    fs.writeFileSync(path.join(home, ".mackup.cfg"), "[applications_to_sync]\nvim\n");
    fs.writeFileSync(
      path.join(home, ".mackup", "myapp.cfg"),
      "[configuration_files]\n.myapprc\n",
    );

    const results = await runImport({ home, source: "mackup" });
    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.candidates.some((c) => c.path.endsWith(".myapprc"))).toBe(true);
  });

  it("source=auto: detects and returns results from existing importers", async () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.mkdirSync(path.join(home, "dotfiles"));
    fs.writeFileSync(path.join(home, "dotfiles", ".zshrc"), "# zsh");

    const results = await runImport({ home, source: "auto" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const allCandidates = results.flatMap((r) => r.candidates);
    expect(allCandidates.some((c) => c.path.endsWith(".zshrc"))).toBe(true);
  });

  it("source=auto with no importers returns empty results", async () => {
    const home = path.join(tmpDir, "empty-home");
    fs.mkdirSync(home);
    const results = await runImport({ home, source: "auto" });
    expect(results).toHaveLength(0);
  });

  it("returns notes from importer", async () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    const dotfilesDir = path.join(tmpDir, "dotfiles-repo");
    fs.mkdirSync(dotfilesDir);
    fs.writeFileSync(path.join(dotfilesDir, ".zshrc"), "# zsh");

    const results = await runImport({ home, source: "dotfiles", path: dotfilesDir });
    expect(results[0]!.notes.length).toBeGreaterThan(0);
  });
});
