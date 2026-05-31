import * as fs from "fs";
import * as path from "path";
import type { Exec } from "@roost/shared";

export const STATE_SCHEMA_VERSION = 1;

export interface MachineState {
  host: string;
  schemaVersion: number;
  capturedAt: string | null;
  modules: Record<string, unknown>;
}

export function stateDir(repoDir: string): string {
  return path.join(repoDir, "state");
}

export function writeState(repoDir: string, state: MachineState): void {
  const dir = stateDir(repoDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${state.host}.json`), JSON.stringify(state, null, 2), "utf8");
}

function isMachineState(v: unknown): v is MachineState {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj["host"] === "string" &&
    typeof obj["schemaVersion"] === "number" &&
    (typeof obj["capturedAt"] === "string" || obj["capturedAt"] === null) &&
    typeof obj["modules"] === "object" &&
    obj["modules"] !== null
  );
}

export function readState(repoDir: string, host: string): MachineState | null {
  const filePath = path.join(stateDir(repoDir), `${host}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`state file ${filePath} contains malformed JSON`);
  }
  if (!isMachineState(parsed)) {
    throw new Error(`state file ${filePath} does not have a valid MachineState shape`);
  }
  return parsed;
}

export function listStateHosts(repoDir: string): string[] {
  const dir = stateDir(repoDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5));
}

export async function commitRepo(
  exec: Exec,
  repoDir: string,
  message: string,
): Promise<void> {
  await exec.run("git", ["-C", repoDir, "add", "-A"]);
  // Pass an explicit identity for Roost's automated commit so capture works on a
  // machine (or CI runner) with no global git user.name/email configured. `-c`
  // applies only to this command — it does NOT touch the user's git config.
  const r = await exec.run("git", [
    "-C", repoDir,
    "-c", "user.name=Roost",
    "-c", "user.email=roost@localhost",
    "commit", "-m", message,
  ]);
  if (r.code !== 0) {
    const combined = `${r.stdout}\n${r.stderr}`;
    if (combined.includes("nothing to commit")) return;
    throw new Error(`git commit failed (code ${r.code}): ${r.stderr}`);
  }
}
