import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { isNoise, scanDir } from "./scan.js";

// ── isNoise unit cases ────────────────────────────────────────────────────────

describe("isNoise", () => {
  it("returns true for node_modules", () => {
    expect(isNoise("/home/user/project/node_modules")).toBe(true);
  });

  it("returns true for .git", () => {
    expect(isNoise("/home/user/project/.git")).toBe(true);
  });

  it("returns true for .DS_Store", () => {
    expect(isNoise("/home/user/.DS_Store")).toBe(true);
  });

  it("returns true for .cache (basename)", () => {
    expect(isNoise("/home/user/.cache")).toBe(true);
  });

  it("returns true for Caches (basename)", () => {
    expect(isNoise("/home/user/Library/Caches")).toBe(true);
  });

  it("returns true for *.log", () => {
    expect(isNoise("/home/user/app.log")).toBe(true);
    expect(isNoise("/home/user/debug.log")).toBe(true);
  });

  it("returns true for Library/Caches segment in path", () => {
    expect(isNoise("/Users/user/Library/Caches/com.example.app")).toBe(true);
  });

  it("returns true for .Trash segment in path", () => {
    expect(isNoise("/Users/user/.Trash/deleted-file")).toBe(true);
  });

  it("returns true for dot-prefixed basename ending with 'history'", () => {
    expect(isNoise("/home/user/.zsh_history")).toBe(true);
    expect(isNoise("/home/user/.bash_history")).toBe(true);
  });

  it("returns true for dot-prefixed basename ending with '.bak'", () => {
    expect(isNoise("/home/user/.config.bak")).toBe(true);
  });

  it("returns false for .zshrc (normal dotfile)", () => {
    expect(isNoise("/home/user/.zshrc")).toBe(false);
  });

  it("returns false for .config (normal dotdir)", () => {
    expect(isNoise("/home/user/.config")).toBe(false);
  });

  it("returns false for a regular file", () => {
    expect(isNoise("/home/user/documents/report.pdf")).toBe(false);
  });

  it("returns false for .ssh (starts with dot but doesn't end with history or .bak)", () => {
    expect(isNoise("/home/user/.ssh")).toBe(false);
  });
});

// ── scanDir ───────────────────────────────────────────────────────────────────

describe("scanDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-scan-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a normal file with correct fields", () => {
    const filePath = path.join(tmpDir, "readme.txt");
    fs.writeFileSync(filePath, "hello");
    const results = scanDir(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: filePath,
      isDir: false,
    });
    expect(results[0]!.sizeBytes).toBeGreaterThan(0);
  });

  it("excludes node_modules", () => {
    fs.mkdirSync(path.join(tmpDir, "node_modules"));
    fs.writeFileSync(path.join(tmpDir, "index.ts"), "export {}");
    const results = scanDir(tmpDir);
    expect(results.some((r) => r.path.endsWith("node_modules"))).toBe(false);
    expect(results.some((r) => r.path.endsWith("index.ts"))).toBe(true);
  });

  it("excludes .cache directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".cache"));
    fs.writeFileSync(path.join(tmpDir, ".zshrc"), "# zsh config");
    const results = scanDir(tmpDir);
    expect(results.some((r) => r.path.endsWith(".cache"))).toBe(false);
    expect(results.some((r) => r.path.endsWith(".zshrc"))).toBe(true);
  });

  it("excludes *.log files", () => {
    fs.writeFileSync(path.join(tmpDir, "foo.log"), "log data");
    fs.writeFileSync(path.join(tmpDir, "app.ts"), "code");
    const results = scanDir(tmpDir);
    expect(results.some((r) => r.path.endsWith("foo.log"))).toBe(false);
    expect(results.some((r) => r.path.endsWith("app.ts"))).toBe(true);
  });

  it("marks directories with isDir: true", () => {
    fs.mkdirSync(path.join(tmpDir, ".config"));
    const results = scanDir(tmpDir);
    const dirEntry = results.find((r) => r.path.endsWith(".config"));
    expect(dirEntry).toBeDefined();
    expect(dirEntry!.isDir).toBe(true);
  });

  it("respects maxEntries", () => {
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), "data");
    }
    const results = scanDir(tmpDir, { maxEntries: 3 });
    expect(results).toHaveLength(3);
  });

  it("tolerates unreadable entries gracefully (no throw)", () => {
    fs.writeFileSync(path.join(tmpDir, "readable.txt"), "ok");
    // scanDir should not throw even if it can't stat something
    // We test this by just verifying it returns without error
    expect(() => scanDir(tmpDir)).not.toThrow();
  });

  it("returns empty array for empty directory", () => {
    const results = scanDir(tmpDir);
    expect(results).toHaveLength(0);
  });
});
