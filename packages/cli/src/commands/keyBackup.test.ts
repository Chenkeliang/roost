import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runKeyBackup, remindOfflineBackup } from "./keyBackup.js";

let tmpDir: string;
let keyPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-keybackup-"));
  keyPath = path.join(tmpDir, "keys.txt");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function capture(): { log: (m: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (m) => lines.push(m), lines };
}

const SECRET = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";

describe("runKeyBackup", () => {
  it("prints the key location and offline-backup guidance, without the key contents", () => {
    fs.writeFileSync(keyPath, `# created\n${SECRET}\n`, { mode: 0o600 });
    const { log, lines } = capture();
    runKeyBackup({ keyPath, log });
    const out = lines.join("\n");
    expect(out).toContain(keyPath);
    expect(out).toMatch(/offline/i);
    expect(out).toMatch(/recovery|private key/i);
    expect(out).toMatch(/new mac|cannot decrypt/i);
    // never leak the key material by default
    expect(out).not.toContain(SECRET);
  });

  it("only reveals the key contents under --show, with a warning", () => {
    fs.writeFileSync(keyPath, `${SECRET}\n`, { mode: 0o600 });
    const { log, lines } = capture();
    runKeyBackup({ keyPath, show: true, log });
    const out = lines.join("\n");
    expect(out).toContain(SECRET);
    expect(out).toMatch(/warning/i);
  });

  it("warns clearly when no key exists yet", () => {
    const { log, lines } = capture();
    runKeyBackup({ keyPath, log });
    const out = lines.join("\n");
    expect(out).toMatch(/no.*key|not found/i);
    expect(out).not.toContain(SECRET);
  });
});

describe("remindOfflineBackup", () => {
  it("fires a one-time reminder when a key exists", () => {
    fs.writeFileSync(keyPath, `${SECRET}\n`, { mode: 0o600 });
    const { log, lines } = capture();
    const fired = remindOfflineBackup({ keyPath, log });
    expect(fired).toBe(true);
    const out = lines.join("\n");
    expect(out).toMatch(/back.*up|offline/i);
    expect(out).not.toContain(SECRET);
  });

  it("does not fire when there is no key", () => {
    const { log, lines } = capture();
    const fired = remindOfflineBackup({ keyPath, log });
    expect(fired).toBe(false);
    expect(lines).toHaveLength(0);
  });
});
