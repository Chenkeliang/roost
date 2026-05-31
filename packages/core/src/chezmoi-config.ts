import * as fs from "node:fs";
import * as path from "node:path";
import type { Exec } from "@roost/shared";
import { defaultAgeKeyPath, recipientFromKey } from "./env-crypto.js";

function chezmoiConfigPath(home: string): string {
  return path.join(home, ".config", "chezmoi", "chezmoi.toml");
}

function ageConfigBody(identityPath: string, recipient: string): string {
  return `encryption = "age"\n[age]\n  identity = "${identityPath}"\n  recipient = "${recipient}"\n`;
}

export interface ChezmoiAgeReady {
  ready: boolean;
  recipient: string | null;
}

/**
 * Make `chezmoi add --encrypt` usable: it requires `encryption="age"` plus an
 * [age] identity/recipient in chezmoi's config. We derive the recipient from the
 * existing age key and write the runtime config (`~/.config/chezmoi/chezmoi.toml`)
 * and record it in the repo's `.chezmoi.toml.tmpl` (recipient is public; the
 * identity path is per-machine via chezmoi's homeDir template) so a follower
 * configures itself on init.
 *
 * Returns ready:false (no write) when there is no age key yet — the caller should
 * tell the user to generate one. The private key is never logged.
 */
export async function ensureChezmoiAgeConfig(
  exec: Exec,
  opts: { home: string; repoDir: string },
): Promise<ChezmoiAgeReady> {
  const { home, repoDir } = opts;
  const keyPath = defaultAgeKeyPath(home);
  const recipient = await recipientFromKey(exec, keyPath);
  if (recipient === null) return { ready: false, recipient: null };

  // Runtime config (absolute identity path) — what chezmoi reads now.
  const cfg = chezmoiConfigPath(home);
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, ageConfigBody(keyPath, recipient), "utf8");

  // Repo template (portable identity via chezmoi homeDir) — travels to followers.
  const tmpl = path.join(repoDir, ".chezmoi.toml.tmpl");
  fs.mkdirSync(path.dirname(tmpl), { recursive: true });
  fs.writeFileSync(
    tmpl,
    ageConfigBody("{{ .chezmoi.homeDir }}/.config/sops/age/keys.txt", recipient),
    "utf8",
  );

  return { ready: true, recipient };
}
