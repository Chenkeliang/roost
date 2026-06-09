// Second-machine onboarding git helpers (ADR-0016). All I/O via the Exec
// adapter (I3) so this is unit-testable and never shells out in tests.
import type { Exec } from "@roost/shared";
import { classifyPushSafety } from "./sync-state.js";
import type { PushSafety } from "./sync-state.js";

export async function cloneRepo(
  exec: Exec,
  url: string,
  dest: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await exec.run("git", ["clone", url, dest]);
  if (r.code === 0) return { ok: true };
  return { ok: false, error: r.stderr.trim() || `git clone exited ${r.code}` };
}

// The commit the remote default branch (HEAD) points to, or null if unknown.
export async function remoteHead(exec: Exec, repoDir: string): Promise<string | null> {
  const r = await exec.run("git", ["-C", repoDir, "ls-remote", "origin", "HEAD"]);
  if (r.code !== 0) return null;
  const first = r.stdout.split("\n")[0]?.trim();
  if (!first) return null;
  const sha = first.split(/\s+/)[0];
  return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

// Should a capture push proceed, given this machine's recorded sync head?
// Unknown remote → "ok" (never block on a network hiccup).
export async function checkPushSafety(
  exec: Exec,
  repoDir: string,
  recordedRemoteHead: string | undefined,
): Promise<PushSafety> {
  const current = await remoteHead(exec, repoDir);
  if (current === null) return "ok";
  return classifyPushSafety(recordedRemoteHead, current);
}
