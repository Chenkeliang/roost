import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runAudit } from "./audit.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-audit-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runAudit", () => {
  it("returns ok=true for a clean repo", async () => {
    fs.writeFileSync(path.join(tmpDir, ".zshrc"), "export PATH=$HOME/bin:$PATH\n");
    const report = await runAudit({ repoDir: tmpDir });
    expect(report.ok).toBe(true);
    expect(report.plaintextFindings).toHaveLength(0);
  });

  it("returns ok=false and lists finding when a secret is present", async () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    fs.writeFileSync(path.join(tmpDir, ".env"), `AWS_ACCESS_KEY_ID=${awsKey}\n`);
    const report = await runAudit({ repoDir: tmpDir });
    expect(report.ok).toBe(false);
    expect(report.plaintextFindings).toHaveLength(1);

    const finding = report.plaintextFindings[0]!;
    expect(finding.path).toContain(".env");
    expect(finding.rule).toBe("aws-access-key");
    // the raw secret must not appear in finding.path or finding.rule
    expect(finding.path).not.toContain(awsKey);
    expect(finding.rule).not.toContain(awsKey);
  });

  it("counts encrypted .age file", async () => {
    fs.writeFileSync(path.join(tmpDir, "secret.age"), "ENCRYPTED");
    const report = await runAudit({ repoDir: tmpDir });
    expect(report.encryptedFiles).toBe(1);
    expect(report.ok).toBe(true);
  });

  it("reports both encryptedFiles and scannedFiles counts", async () => {
    fs.writeFileSync(path.join(tmpDir, "secret.age"), "ENCRYPTED");
    fs.writeFileSync(path.join(tmpDir, ".zshrc"), "alias ll='ls -la'");
    const report = await runAudit({ repoDir: tmpDir });
    expect(report.encryptedFiles).toBe(1);
    expect(report.scannedFiles).toBe(1);
  });
});
