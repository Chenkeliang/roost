import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult } from "@roost/shared";
import { rotateAgeKey } from "./rotate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CallRecord = { cmd: string; args: string[]; opts?: { cwd?: string } };

function makeFakeExec(
  handler: (cmd: string, args: string[]) => ExecResult,
): { exec: Exec; calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  const exec: Exec = {
    async run(cmd, args, opts) {
      calls.push({ cmd, args, opts });
      return handler(cmd, args);
    },
  };
  return { exec, calls };
}

// Fake that succeeds decrypt (writes a tmp file) and encrypt (writes the output file)
function makeSuccessExec(): { exec: Exec; calls: CallRecord[] } {
  return makeFakeExec((cmd, args) => {
    if (cmd === "age") {
      // Both decrypt (-d) and encrypt (-r) use -o <dest> <src>
      const oIdx = args.indexOf("-o");
      if (oIdx >= 0) {
        const dest = args[oIdx + 1];
        if (dest) {
          // Write a fake payload to the destination so renaming works
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, "fake-age-payload", "utf8");
        }
      }
    }
    return { code: 0, stdout: "", stderr: "" };
  });
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-rotate-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rotateAgeKey", () => {
  it("re-encrypts each .age file and leaves non-.age files untouched", async () => {
    // Arrange: two .age files + one normal file
    const ageFile1 = path.join(tmpDir, "secrets.age");
    const ageFile2 = path.join(tmpDir, "subdir", "token.age");
    const normalFile = path.join(tmpDir, "README.md");

    fs.mkdirSync(path.join(tmpDir, "subdir"), { recursive: true });
    fs.writeFileSync(ageFile1, "encrypted-content-1", "utf8");
    fs.writeFileSync(ageFile2, "encrypted-content-2", "utf8");
    fs.writeFileSync(normalFile, "not a secret", "utf8");

    const { exec, calls } = makeSuccessExec();

    const result = await rotateAgeKey(exec, {
      repoDir: tmpDir,
      oldKeyPath: "/fake/key.txt",
      newRecipient: "age1newrecipient",
    });

    // Both .age files rotated, no failures
    expect(result.rotated).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.rotated).toContain(ageFile1);
    expect(result.rotated).toContain(ageFile2);

    // Normal file never passed to age
    const ageCallArgs = calls.map((c) => c.args).flat();
    expect(ageCallArgs).not.toContain(normalFile);
  });

  it("calls age with correct decrypt then encrypt argv for each .age file", async () => {
    const ageFile = path.join(tmpDir, "data.age");
    fs.writeFileSync(ageFile, "encrypted", "utf8");

    const { exec, calls } = makeSuccessExec();

    await rotateAgeKey(exec, {
      repoDir: tmpDir,
      oldKeyPath: "/path/to/old.key",
      newRecipient: "age1abc123",
    });

    // Should have exactly 2 age calls for this one file
    expect(calls).toHaveLength(2);

    // First call: decrypt
    const decryptCall = calls[0]!;
    expect(decryptCall.cmd).toBe("age");
    expect(decryptCall.args).toContain("-d");
    expect(decryptCall.args).toContain("-i");
    expect(decryptCall.args).toContain("/path/to/old.key");
    // Source file is the .age file
    expect(decryptCall.args[decryptCall.args.length - 1]).toBe(ageFile);
    // Output (-o) is a temp path (not the original)
    const oIdx = decryptCall.args.indexOf("-o");
    expect(oIdx).toBeGreaterThan(-1);
    const tmpOut = decryptCall.args[oIdx + 1]!;
    expect(tmpOut).not.toBe(ageFile);

    // Second call: encrypt
    const encryptCall = calls[1]!;
    expect(encryptCall.cmd).toBe("age");
    expect(encryptCall.args).toContain("-r");
    expect(encryptCall.args).toContain("age1abc123");
    // Encrypts from the tmp decrypted file
    expect(encryptCall.args[encryptCall.args.length - 1]).toBe(tmpOut);
  });

  it("records failed file when decrypt exits non-zero, others still rotate", async () => {
    const goodFile = path.join(tmpDir, "good.age");
    const badFile = path.join(tmpDir, "bad.age");

    fs.writeFileSync(goodFile, "good-encrypted", "utf8");
    fs.writeFileSync(badFile, "bad-encrypted", "utf8");

    const { exec } = makeFakeExec((cmd, args) => {
      // Decrypt the bad file fails; everything else succeeds
      const lastArg = args[args.length - 1];
      if (cmd === "age" && args.includes("-d") && lastArg === badFile) {
        return { code: 1, stdout: "", stderr: "decryption error" };
      }
      // Write output file for successes
      const oIdx = args.indexOf("-o");
      if (oIdx >= 0) {
        const dest = args[oIdx + 1];
        if (dest) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, "payload", "utf8");
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await rotateAgeKey(exec, {
      repoDir: tmpDir,
      oldKeyPath: "/old.key",
      newRecipient: "age1rec",
    });

    expect(result.rotated).toHaveLength(1);
    expect(result.rotated).toContain(goodFile);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.path).toBe(badFile);
    expect(result.failed[0]!.reason).toMatch(/decryption error/);
  });

  it("does not overwrite original file when encrypt step fails", async () => {
    const ageFile = path.join(tmpDir, "data.age");
    const originalContent = "original-encrypted-content";
    fs.writeFileSync(ageFile, originalContent, "utf8");

    const { exec } = makeFakeExec((cmd, args) => {
      if (cmd === "age" && args.includes("-d")) {
        // Decrypt succeeds, write tmp
        const oIdx = args.indexOf("-o");
        const dest = args[oIdx + 1];
        if (dest) fs.writeFileSync(dest, "decrypted-plain", "utf8");
        return { code: 0, stdout: "", stderr: "" };
      }
      if (cmd === "age" && args.includes("-r")) {
        // Encrypt fails
        return { code: 1, stdout: "", stderr: "encrypt error" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await rotateAgeKey(exec, {
      repoDir: tmpDir,
      oldKeyPath: "/old.key",
      newRecipient: "age1rec",
    });

    expect(result.failed).toHaveLength(1);
    expect(result.rotated).toHaveLength(0);
    // Original file must NOT have been overwritten
    expect(fs.readFileSync(ageFile, "utf8")).toBe(originalContent);
  });

  it("cleans up tmp files after successful rotation", async () => {
    const ageFile = path.join(tmpDir, "clean.age");
    fs.writeFileSync(ageFile, "data", "utf8");

    const tmpPaths: string[] = [];

    const { exec } = makeFakeExec((cmd, args) => {
      const oIdx = args.indexOf("-o");
      if (oIdx >= 0) {
        const dest = args[oIdx + 1];
        if (dest) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, "payload", "utf8");
          // Capture tmp paths (not the final .age destination)
          if (dest !== ageFile) tmpPaths.push(dest);
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await rotateAgeKey(exec, {
      repoDir: tmpDir,
      oldKeyPath: "/old.key",
      newRecipient: "age1rec",
    });

    // All tmp paths used during rotate should be cleaned up
    for (const p of tmpPaths) {
      expect(fs.existsSync(p)).toBe(false);
    }
  });

  it("encrypted temp is written adjacent to target (same dir, avoids EXDEV)", async () => {
    const subdir = path.join(tmpDir, "secrets");
    fs.mkdirSync(subdir, { recursive: true });
    const ageFile = path.join(subdir, "data.age");
    fs.writeFileSync(ageFile, "encrypted", "utf8");

    const encTmpPaths: string[] = [];

    const { exec } = makeFakeExec((cmd, args) => {
      const oIdx = args.indexOf("-o");
      if (oIdx >= 0) {
        const dest = args[oIdx + 1];
        if (dest) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, "payload", "utf8");
          // Capture the encrypt call's output path
          if (cmd === "age" && args.includes("-r")) {
            encTmpPaths.push(dest);
          }
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await rotateAgeKey(exec, {
      repoDir: tmpDir,
      oldKeyPath: "/old.key",
      newRecipient: "age1rec",
    });

    // The encrypted temp must be in the same directory as the target .age file
    expect(encTmpPaths).toHaveLength(1);
    expect(path.dirname(encTmpPaths[0]!)).toBe(path.dirname(ageFile));
  });

  it("skips .git and node_modules directories", async () => {
    const gitFile = path.join(tmpDir, ".git", "COMMIT_EDITMSG.age");
    const nmFile = path.join(tmpDir, "node_modules", "some-pkg", "secret.age");
    const normalAgeFile = path.join(tmpDir, "real.age");

    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "node_modules", "some-pkg"), { recursive: true });
    fs.writeFileSync(gitFile, "git-encrypted", "utf8");
    fs.writeFileSync(nmFile, "nm-encrypted", "utf8");
    fs.writeFileSync(normalAgeFile, "real-encrypted", "utf8");

    const { exec, calls } = makeSuccessExec();

    const result = await rotateAgeKey(exec, {
      repoDir: tmpDir,
      oldKeyPath: "/old.key",
      newRecipient: "age1rec",
    });

    // Only the real .age file should be rotated
    expect(result.rotated).toHaveLength(1);
    expect(result.rotated).toContain(normalAgeFile);

    // .git and node_modules files must not appear in age call args
    const allArgs = calls.flatMap((c) => c.args);
    expect(allArgs).not.toContain(gitFile);
    expect(allArgs).not.toContain(nmFile);
  });
});

// ── rotateToNewKey (generate + re-encrypt + swap) ────────────────────────────

import { rotateToNewKey } from "./rotate.js";

// Fake exec: age-keygen -o writes a key file; age-keygen -y prints a recipient;
// age -d/-r write their -o dest (so renames succeed). Controlled per call.
function makeKeyRotateExec(opts?: { encFails?: boolean }) {
  return makeFakeExec((cmd, args) => {
    if (cmd === "age-keygen" && args[0] === "-o") {
      const dest = args[1]!;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, "AGE-SECRET-KEY-1FAKEKEYMATERIAL", "utf8");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "age-keygen" && args[0] === "-y") {
      return { code: 0, stdout: "age1newrecipientpublickeyfake\n", stderr: "" };
    }
    if (cmd === "age") {
      if (opts?.encFails && args.includes("-r")) return { code: 1, stdout: "", stderr: "encrypt boom" };
      const oIdx = args.indexOf("-o");
      const dest = args[oIdx + 1];
      if (dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, "x", "utf8"); }
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
}

describe("rotateToNewKey", () => {
  it("generates a new key, re-encrypts all .age, backs up old key, and swaps", async () => {
    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(path.join(repoDir, "roost", "env-secrets"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "roost", "env-secrets", "A.age"), "old-cipher");
    const keyPath = path.join(tmpDir, "keys.txt");
    fs.writeFileSync(keyPath, "AGE-SECRET-KEY-OLD");
    const { exec } = makeKeyRotateExec();
    const r = await rotateToNewKey(exec, {
      repoDir,
      keyPath,
      newKeyTmpPath: path.join(tmpDir, "new-key.tmp"),
      backupPath: path.join(tmpDir, "keys.txt.bak"),
    });
    expect(r.swapped).toBe(true);
    expect(r.recipient).toBe("age1newrecipientpublickeyfake");
    expect(r.rotated.length).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, "keys.txt.bak"))).toBe(true); // old key backed up
    expect(fs.readFileSync(keyPath, "utf8")).toContain("FAKEKEYMATERIAL"); // new key in place
  });

  it("does NOT swap the key if any .age fails to re-encrypt (old data stays readable)", async () => {
    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(path.join(repoDir, "roost", "env-secrets"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "roost", "env-secrets", "A.age"), "old-cipher");
    const keyPath = path.join(tmpDir, "keys.txt");
    fs.writeFileSync(keyPath, "AGE-SECRET-KEY-OLD");
    const { exec } = makeKeyRotateExec({ encFails: true });
    const r = await rotateToNewKey(exec, {
      repoDir,
      keyPath,
      newKeyTmpPath: path.join(tmpDir, "new-key.tmp"),
      backupPath: path.join(tmpDir, "keys.txt.bak"),
    });
    expect(r.swapped).toBe(false);
    expect(r.failed.length).toBe(1);
    expect(fs.readFileSync(keyPath, "utf8")).toBe("AGE-SECRET-KEY-OLD"); // old key untouched
    expect(fs.existsSync(path.join(tmpDir, "new-key.tmp"))).toBe(false); // new key discarded
  });
});
