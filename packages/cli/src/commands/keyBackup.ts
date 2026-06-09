import * as fs from "node:fs";

export interface KeyBackupDeps {
  keyPath: string;
  show?: boolean;
  log: (msg: string) => void;
}

// Print offline-backup guidance for the age identity. The age PRIVATE KEY is the
// recovery material: without an offline copy you cannot decrypt on a new Mac.
// The key contents are NEVER printed unless --show is passed (and then with a
// warning). This intentionally does not route through the logger redaction path.
export function runKeyBackup(deps: KeyBackupDeps): void {
  const { keyPath, show = false, log } = deps;

  const exists = fs.existsSync(keyPath);

  log("age key — offline backup");
  log(`  Location: ${keyPath}`);

  if (!exists) {
    log("  No age key found at this path yet.");
    log("  Generate one (e.g. via `roost init` / first capture) before backing it up.");
    return;
  }

  log("");
  log("  Your age PRIVATE KEY is the recovery material for every encrypted item.");
  log("  Without an offline copy you CANNOT decrypt your secrets on a new Mac.");
  log("  Back it up offline now: a password manager item, an encrypted USB drive,");
  log("  or printed and stored securely. Do not commit it to the repo.");

  if (show) {
    log("");
    log("  WARNING: printing private key material below — keep it off screen shares,");
    log("  terminal history, and logs.");
    const contents = fs.readFileSync(keyPath, "utf8").trimEnd();
    log(contents);
  } else {
    log("");
    log("  (Run with --show to display the key contents for copying — handle with care.)");
  }
}

// One-time offline-backup reminder for the key-setup path (init / first key use).
// Fires only when a key actually exists; never prints key material. Returns
// whether the reminder was emitted so callers can avoid double-prompting.
export function remindOfflineBackup(deps: { keyPath: string; log: (msg: string) => void }): boolean {
  const { keyPath, log } = deps;
  if (!fs.existsSync(keyPath)) return false;

  log(
    `Reminder: back up your age private key (${keyPath}) offline — it is the only way ` +
      "to decrypt your secrets on a new Mac. See `roost key backup`.",
  );
  return true;
}
