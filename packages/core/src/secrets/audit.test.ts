import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { auditRepo } from "./audit.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-audit-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("auditRepo", () => {
  it("counts .age files as encrypted, not scanned", () => {
    fs.writeFileSync(path.join(tmpDir, "secret.age"), "AGE-ENCRYPTED-PAYLOAD");
    const report = auditRepo(tmpDir);
    expect(report.encryptedFiles).toBe(1);
    expect(report.scannedFiles).toBe(0);
    expect(report.plaintextFindings).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  it("counts file beginning with age header as encrypted", () => {
    fs.writeFileSync(path.join(tmpDir, "vault"), "age-encryption.org/v1\n...");
    const report = auditRepo(tmpDir);
    expect(report.encryptedFiles).toBe(1);
    expect(report.scannedFiles).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("counts file with sops header as encrypted", () => {
    fs.writeFileSync(path.join(tmpDir, "sopsfile"), "SOPS-encrypted\n...");
    const report = auditRepo(tmpDir);
    expect(report.encryptedFiles).toBe(1);
    expect(report.scannedFiles).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("scans clean dotfile, produces no findings, ok=true", () => {
    fs.writeFileSync(path.join(tmpDir, ".zshrc"), "export PATH=$HOME/bin:$PATH\nalias ll='ls -la'\n");
    const report = auditRepo(tmpDir);
    expect(report.scannedFiles).toBe(1);
    expect(report.plaintextFindings).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  it("detects AWS key in a plaintext file, finding has path+rule, no raw secret", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    fs.writeFileSync(path.join(tmpDir, ".env"), `AWS_ACCESS_KEY_ID=${awsKey}\n`);
    const report = auditRepo(tmpDir);
    expect(report.scannedFiles).toBe(1);
    expect(report.plaintextFindings).toHaveLength(1);
    expect(report.ok).toBe(false);

    const finding = report.plaintextFindings[0]!;
    expect(finding.path).toContain(".env");
    expect(finding.rule).toBe("aws-access-key");
    // rule must not contain the raw secret
    expect(finding.rule).not.toContain(awsKey);
    // path must not contain the raw secret value
    expect(finding.path).not.toContain(awsKey);
  });

  it("detects ghp_ token in a plaintext file", () => {
    const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";
    fs.writeFileSync(path.join(tmpDir, ".envrc"), `GITHUB_TOKEN=${token}\n`);
    const report = auditRepo(tmpDir);
    expect(report.ok).toBe(false);
    expect(report.plaintextFindings.some((f) => f.rule === "token-prefix")).toBe(true);
    // raw token must not appear in rule or path
    for (const f of report.plaintextFindings) {
      expect(f.rule).not.toContain(token);
      expect(f.path).not.toContain(token);
    }
  });

  it("skips .git directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    fs.writeFileSync(path.join(tmpDir, ".git", "config"), "AKIAIOSFODNN7EXAMPLE");
    const report = auditRepo(tmpDir);
    expect(report.scannedFiles).toBe(0);
    expect(report.plaintextFindings).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  it("skips node_modules directory", () => {
    fs.mkdirSync(path.join(tmpDir, "node_modules"));
    fs.writeFileSync(path.join(tmpDir, "node_modules", "leaked.js"), "AKIAIOSFODNN7EXAMPLE");
    const report = auditRepo(tmpDir);
    expect(report.plaintextFindings).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  it("ok=false when any plaintext finding exists", () => {
    fs.writeFileSync(path.join(tmpDir, ".npmrc"), "_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789\n");
    const report = auditRepo(tmpDir);
    expect(report.ok).toBe(false);
  });

  it("counts both encrypted and scanned files correctly when mixed", () => {
    fs.writeFileSync(path.join(tmpDir, "secret.age"), "ENCRYPTED");
    fs.writeFileSync(path.join(tmpDir, ".zshrc"), "alias ll='ls -la'");
    const report = auditRepo(tmpDir);
    expect(report.encryptedFiles).toBe(1);
    expect(report.scannedFiles).toBe(1);
    expect(report.ok).toBe(true);
  });

  it("returns ok=true for empty repo", () => {
    const report = auditRepo(tmpDir);
    expect(report.encryptedFiles).toBe(0);
    expect(report.scannedFiles).toBe(0);
    expect(report.plaintextFindings).toHaveLength(0);
    expect(report.ok).toBe(true);
  });
});
