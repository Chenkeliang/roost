import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { backupFiles } from "./apply.js";

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

  it("creates backupDir if it does not exist", () => {
    expect(fs.existsSync(backupDir)).toBe(false);
    const existing1 = path.join(tmpDir, "file1.txt");
    backupFiles([existing1], backupDir);
    expect(fs.existsSync(backupDir)).toBe(true);
  });

  it("copies file contents into backupDir preserving basename", () => {
    const existing1 = path.join(tmpDir, "file1.txt");
    const existing2 = path.join(tmpDir, "file2.txt");

    backupFiles([existing1, existing2], backupDir);

    const copiedContent1 = fs.readFileSync(path.join(backupDir, "file1.txt"), "utf8");
    const copiedContent2 = fs.readFileSync(path.join(backupDir, "file2.txt"), "utf8");

    expect(copiedContent1).toBe("content1");
    expect(copiedContent2).toBe("content2");
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
});
