/**
 * Real age-encrypted chezmoi round-trip e2e test.
 *
 * Proves — using the REAL `age-keygen`, `age`, and `chezmoi` binaries — that a
 * secret is encrypted at rest in the chezmoi source dir and decrypts correctly
 * when applied.  Skipped gracefully when chezmoi is absent.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Detect real binaries
// ---------------------------------------------------------------------------
const hasChezmoi =
  spawnSync("chezmoi", ["--version"], { encoding: "utf8" }).status === 0;
const hasAgeKeygen =
  spawnSync("age-keygen", ["--version"], { encoding: "utf8" }).status === 0;

const shouldRun = hasChezmoi && hasAgeKeygen;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runChecked(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (exit ${r.status ?? "null"}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
describe("age-encrypted chezmoi round-trip e2e", () => {
  it.skipIf(!shouldRun)(
    "secret is encrypted at rest and decrypts correctly on apply",
    () => {
      const tmpRoot = makeTmp("roost-enc-e2e-");

      const keyFile = join(tmpRoot, "key.txt");
      const srcDir = join(tmpRoot, "src");
      const cfgDir = join(tmpRoot, "cfg");
      const home1 = join(tmpRoot, "home1");
      const home2 = join(tmpRoot, "home2");

      mkdirSync(srcDir);
      mkdirSync(cfgDir);
      mkdirSync(home1);
      mkdirSync(home2);

      try {
        // 1. Generate age key and extract the public key recipient
        runChecked("age-keygen", ["-o", keyFile]);

        const keyFileContent = readFileSync(keyFile, "utf8");
        const recipientMatch = keyFileContent.match(/^# public key: (age1\S+)/m);
        if (!recipientMatch) {
          throw new Error(
            `Could not parse recipient from age-keygen output:\n${keyFileContent}`,
          );
        }
        const recipient = recipientMatch[1];

        // 2. Write chezmoi config enabling age encryption
        const cfgFile = join(cfgDir, "chezmoi.toml");
        writeFileSync(
          cfgFile,
          [
            `encryption = "age"`,
            `[age]`,
            `  identity = "${keyFile}"`,
            `  recipient = "${recipient}"`,
          ].join("\n") + "\n",
          "utf8",
        );

        // 3. Write the secret file in HOME1
        const originalContent = "TOKEN=sk-roost-e2e-SHOULD-BE-ENCRYPTED\n";
        const secretPath = join(home1, ".secret");
        writeFileSync(secretPath, originalContent, "utf8");

        // 4. Init chezmoi source (creates the chezmoi git repo in srcDir)
        //    chezmoi init is idempotent; ignore non-zero on already-init'd dirs.
        spawnSync(
          "chezmoi",
          [
            "--config", cfgFile,
            "--source", srcDir,
            "--destination", home1,
            "--no-tty",
            "init",
          ],
          { encoding: "utf8" },
        );

        // 5. Add the secret file with encryption
        runChecked("chezmoi", [
          "--config", cfgFile,
          "--source", srcDir,
          "--destination", home1,
          "add",
          "--encrypt",
          "--no-tty",
          secretPath,
        ]);

        // 6. Assert encryption at rest
        //    chezmoi names the file "encrypted_dot_secret.age" in srcDir
        const srcFiles = readdirSync(srcDir).filter(
          (f) => !f.startsWith("."),
        );
        const ageFiles = srcFiles.filter((f) => f.endsWith(".age"));

        expect(
          ageFiles.length,
          `Expected at least one .age file in src dir but found: ${srcFiles.join(", ")}`,
        ).toBeGreaterThan(0);

        const ageFilePath = join(srcDir, ageFiles[0]);
        const ageFileContent = readFileSync(ageFilePath, "utf8");

        // The age PEM wrapper header proves it is an age-encrypted file
        expect(
          ageFileContent,
          "Expected .age file to contain the age PEM header",
        ).toContain("-----BEGIN AGE ENCRYPTED FILE-----");

        // The plaintext must NOT appear anywhere in the encrypted file
        expect(
          ageFileContent,
          "Expected plaintext secret NOT to appear in the encrypted file",
        ).not.toContain("sk-roost-e2e-SHOULD-BE-ENCRYPTED");

        // 7. Apply to a fresh empty HOME2
        runChecked("chezmoi", [
          "--config", cfgFile,
          "--source", srcDir,
          "--destination", home2,
          "--no-tty",
          "apply",
          "--force",
        ]);

        // 8. Assert decryption: HOME2/.secret must equal the original plaintext
        const decrypted = readFileSync(join(home2, ".secret"), "utf8");
        expect(decrypted).toBe(originalContent);
      } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
  );
});
