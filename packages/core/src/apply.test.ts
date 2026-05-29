import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { backupFiles } from "./apply.js";

/** Derive where backupFiles will write a given source file. */
function destFor(source: string, backupDir: string): string {
  const relative = source.replace(/^[/\\]/, "");
  return path.join(backupDir, relative);
}

describe("backupFiles", () => {
  let tmpDir: string;
  let backupDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-apply-test-"));
    backupDir = path.join(tmpDir, "backup");
    // Write two existing files
    fs.writeFileSync(path.join(tmpDir, "file1.txt"), "content1");
    fs.writeFileSync(path.join(tmpDir, "file2.txt"), "content2");
    // file3.txt intentionally does NOT exist
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("only copies existing files, skipping nonexistent targets", () => {
    const existing1 = path.join(tmpDir, "file1.txt");
    const existing2 = path.join(tmpDir, "file2.txt");
    const missing = path.join(tmpDir, "file3.txt");

    const backed = backupFiles([existing1, existing2, missing], backupDir);

    expect(backed).toHaveLength(2);
    expect(backed).toContain(existing1);
    expect(backed).toContain(existing2);
    expect(backed).not.toContain(missing);
  });

  it("creates backupDir (and intermediate dirs) if they do not exist", () => {
    expect(fs.existsSync(backupDir)).toBe(false);
    const existing1 = path.join(tmpDir, "file1.txt");
    backupFiles([existing1], backupDir);
    expect(fs.existsSync(destFor(existing1, backupDir))).toBe(true);
  });

  it("copies file contents preserving full path structure under backupDir", () => {
    const existing1 = path.join(tmpDir, "file1.txt");
    const existing2 = path.join(tmpDir, "file2.txt");

    backupFiles([existing1, existing2], backupDir);

    expect(fs.readFileSync(destFor(existing1, backupDir), "utf8")).toBe("content1");
    expect(fs.readFileSync(destFor(existing2, backupDir), "utf8")).toBe("content2");
  });

  it("returns empty array when all targets are nonexistent", () => {
    const missing1 = path.join(tmpDir, "no-such-a.txt");
    const missing2 = path.join(tmpDir, "no-such-b.txt");

    const backed = backupFiles([missing1, missing2], backupDir);

    expect(backed).toHaveLength(0);
  });

  it("returns empty array when targets list is empty", () => {
    const backed = backupFiles([], backupDir);
    expect(backed).toHaveLength(0);
  });

  it("two files sharing a basename in different dirs are both backed up without clobbering", () => {
    // Create two files with the same basename in different directories
    const dirA = path.join(tmpDir, "a");
    const dirB = path.join(tmpDir, "b");
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const fileA = path.join(dirA, ".zshrc");
    const fileB = path.join(dirB, ".zshrc");
    fs.writeFileSync(fileA, "content-from-a");
    fs.writeFileSync(fileB, "content-from-b");

    const backed = backupFiles([fileA, fileB], backupDir);

    expect(backed).toHaveLength(2);
    // Both destination paths exist
    const destA = destFor(fileA, backupDir);
    const destB = destFor(fileB, backupDir);
    expect(fs.existsSync(destA)).toBe(true);
    expect(fs.existsSync(destB)).toBe(true);
    // Contents are not clobbered — each gets the right content
    expect(fs.readFileSync(destA, "utf8")).toBe("content-from-a");
    expect(fs.readFileSync(destB, "utf8")).toBe("content-from-b");
  });
});
