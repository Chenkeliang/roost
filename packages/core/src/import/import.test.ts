import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createDotfilesRepoImporter,
  createMackupImporter,
  detectImporters,
} from "./index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-import-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── dotfilesRepo importer ─────────────────────────────────────────────────────

describe("createDotfilesRepoImporter", () => {
  it("detect returns false when path does not exist", () => {
    const importer = createDotfilesRepoImporter(path.join(tmpDir, "nonexistent"));
    expect(importer.detect()).toBe(false);
  });

  it("detect returns true when path is an existing directory", () => {
    const repoPath = path.join(tmpDir, "dotfiles");
    fs.mkdirSync(repoPath);
    const importer = createDotfilesRepoImporter(repoPath);
    expect(importer.detect()).toBe(true);
  });

  it("detect returns false when path is a file (not a dir)", () => {
    const filePath = path.join(tmpDir, "afile");
    fs.writeFileSync(filePath, "data");
    const importer = createDotfilesRepoImporter(filePath);
    expect(importer.detect()).toBe(false);
  });

  it("run: yields 2 candidates from 2 regular files, excludes .git", () => {
    const repoPath = path.join(tmpDir, "dotfiles");
    fs.mkdirSync(repoPath);
    fs.writeFileSync(path.join(repoPath, ".zshrc"), "# zsh");
    fs.writeFileSync(path.join(repoPath, ".vimrc"), "# vim");
    fs.mkdirSync(path.join(repoPath, ".git"));
    fs.writeFileSync(path.join(repoPath, ".git", "config"), "[core]");

    const importer = createDotfilesRepoImporter(repoPath);
    const result = importer.run();

    expect(result.candidates).toHaveLength(2);
    const paths = result.candidates.map((c) => c.path);
    expect(paths.some((p) => p.endsWith(".zshrc"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".vimrc"))).toBe(true);
    expect(paths.some((p) => p.includes(".git"))).toBe(false);
  });

  it("run: candidates have category 'dotfiles' and recommendation 'track'", () => {
    const repoPath = path.join(tmpDir, "dotfiles");
    fs.mkdirSync(repoPath);
    fs.writeFileSync(path.join(repoPath, ".zshrc"), "# zsh");

    const importer = createDotfilesRepoImporter(repoPath);
    const { candidates } = importer.run();

    expect(candidates[0]?.category).toBe("dotfiles");
    expect(candidates[0]?.recommendation).toBe("track");
    expect(candidates[0]?.id).toBe(candidates[0]?.path);
  });

  it("run: candidate id and path are absolute", () => {
    const repoPath = path.join(tmpDir, "dotfiles");
    fs.mkdirSync(repoPath);
    fs.writeFileSync(path.join(repoPath, ".bashrc"), "# bash");

    const importer = createDotfilesRepoImporter(repoPath);
    const { candidates } = importer.run();

    expect(path.isAbsolute(candidates[0]!.id)).toBe(true);
    expect(path.isAbsolute(candidates[0]!.path)).toBe(true);
  });

  it("run: notes contains the count and repoPath", () => {
    const repoPath = path.join(tmpDir, "dotfiles");
    fs.mkdirSync(repoPath);
    fs.writeFileSync(path.join(repoPath, ".zshrc"), "# zsh");
    fs.writeFileSync(path.join(repoPath, ".vimrc"), "# vim");

    const importer = createDotfilesRepoImporter(repoPath);
    const { notes } = importer.run();

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/2/);
    expect(notes[0]).toContain(repoPath);
  });

  it("run: files nested inside subdirs are included (depth <= 3)", () => {
    const repoPath = path.join(tmpDir, "dotfiles");
    fs.mkdirSync(path.join(repoPath, "config"), { recursive: true });
    fs.writeFileSync(path.join(repoPath, ".zshrc"), "# zsh");
    fs.writeFileSync(path.join(repoPath, "config", "settings.conf"), "setting=1");

    const importer = createDotfilesRepoImporter(repoPath);
    const { candidates } = importer.run();

    const candidatePaths = candidates.map((c) => c.path);
    expect(candidatePaths.some((p) => p.endsWith(".zshrc"))).toBe(true);
    expect(candidatePaths.some((p) => p.endsWith("settings.conf"))).toBe(true);
  });

  it("run: source is set to repoPath", () => {
    const repoPath = path.join(tmpDir, "dotfiles");
    fs.mkdirSync(repoPath);

    const importer = createDotfilesRepoImporter(repoPath);
    const result = importer.run();

    expect(result.source).toBe(repoPath);
  });
});

// ── mackup importer ───────────────────────────────────────────────────────────

describe("createMackupImporter", () => {
  it("detect returns false when neither .mackup.cfg nor .mackup/ exists", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    const importer = createMackupImporter(home);
    expect(importer.detect()).toBe(false);
  });

  it("detect returns true when .mackup.cfg exists", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, ".mackup.cfg"), "[storage]\nengine = icloud\n");
    const importer = createMackupImporter(home);
    expect(importer.detect()).toBe(true);
  });

  it("detect returns true when .mackup/ dir exists", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.mkdirSync(path.join(home, ".mackup"));
    const importer = createMackupImporter(home);
    expect(importer.detect()).toBe(true);
  });

  it("run: notes list apps from [applications_to_sync] in .mackup.cfg", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.writeFileSync(
      path.join(home, ".mackup.cfg"),
      "[applications_to_sync]\nvim\nzsh\ngit\n",
    );

    const importer = createMackupImporter(home);
    const { notes } = importer.run();

    const appsNote = notes.find((n) => n.includes("vim"));
    expect(appsNote).toBeDefined();
    expect(appsNote).toContain("zsh");
    expect(appsNote).toContain("git");
  });

  it("run: emits candidates for paths in custom .mackup/*.cfg [configuration_files]", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(path.join(home, ".mackup"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".mackup.cfg"),
      "[applications_to_sync]\ncustomapp\n",
    );
    fs.writeFileSync(
      path.join(home, ".mackup", "customapp.cfg"),
      "[application]\nname = Custom App\n\n[configuration_files]\n.config/foo\n.config/bar\n",
    );

    const importer = createMackupImporter(home);
    const { candidates, notes } = importer.run();

    const candidatePaths = candidates.map((c) => c.path);
    expect(candidatePaths.some((p) => p.endsWith(".config/foo"))).toBe(true);
    expect(candidatePaths.some((p) => p.endsWith(".config/bar"))).toBe(true);

    // candidate id should be home/<path>
    const fooCand = candidates.find((c) => c.path.endsWith(".config/foo"));
    expect(fooCand?.id).toBe(path.join(home, ".config/foo"));

    // There should be a note about custom-cfg paths
    const customNote = notes.find((n) => n.includes("customapp"));
    expect(customNote).toBeDefined();
  });

  it("run: candidates from custom cfg have recommendation 'track'", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(path.join(home, ".mackup"), { recursive: true });
    fs.writeFileSync(path.join(home, ".mackup.cfg"), "");
    fs.writeFileSync(
      path.join(home, ".mackup", "myapp.cfg"),
      "[configuration_files]\n.myapprc\n",
    );

    const importer = createMackupImporter(home);
    const { candidates } = importer.run();

    expect(candidates[0]?.recommendation).toBe("track");
    expect(candidates[0]?.category).toBe("dotfiles");
  });

  it("run: handles .mackup.cfg without [applications_to_sync] gracefully", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, ".mackup.cfg"), "[storage]\nengine = dropbox\n");

    const importer = createMackupImporter(home);
    expect(() => importer.run()).not.toThrow();
  });

  it("run: handles empty home gracefully (just .mackup dir, no files)", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(path.join(home, ".mackup"), { recursive: true });

    const importer = createMackupImporter(home);
    const result = importer.run();
    expect(result.candidates).toHaveLength(0);
  });
});

// ── detectImporters ───────────────────────────────────────────────────────────

describe("detectImporters", () => {
  it("returns empty array when no known setup exists", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    const importers = detectImporters(home);
    expect(importers).toHaveLength(0);
  });

  it("includes mackup importer when .mackup.cfg exists", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, ".mackup.cfg"), "");
    const importers = detectImporters(home);
    expect(importers.some((i) => i.name === "mackup")).toBe(true);
  });

  it("includes dotfiles importer when ~/dotfiles exists", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.mkdirSync(path.join(home, "dotfiles"));
    const importers = detectImporters(home);
    expect(importers.some((i) => i.name === "dotfiles-repo")).toBe(true);
  });

  it("includes dotfiles importer when ~/.dotfiles exists", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.mkdirSync(path.join(home, ".dotfiles"));
    const importers = detectImporters(home);
    expect(importers.some((i) => i.name === "dotfiles-repo")).toBe(true);
  });

  it("returns both mackup and dotfiles importers when both exist", () => {
    const home = path.join(tmpDir, "home");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, ".mackup.cfg"), "");
    fs.mkdirSync(path.join(home, "dotfiles"));
    const importers = detectImporters(home);
    expect(importers.some((i) => i.name === "mackup")).toBe(true);
    expect(importers.some((i) => i.name === "dotfiles-repo")).toBe(true);
  });
});
