import * as os from "node:os";
import type { Exec } from "@roost/shared";
import { writeState, readState, commitRepo, STATE_SCHEMA_VERSION } from "@roost/core";

/**
 * Finalize a capture: stamp this machine's state into `state/<host>.json`, then
 * commit the repo. Shared by the CLI `capture` command and the dashboard
 * `POST /api/capture` so both produce a real snapshot + machine state.
 *
 * `home` is accepted for symmetry with the capture context; the host identity
 * comes from the OS hostname (the state file key).
 */
export async function finalizeCapture(exec: Exec, repoDir: string, _home: string): Promise<void> {
  const host = os.hostname();
  // Preserve any existing per-module baseline (written by a prior load) — do NOT
  // wipe it, or the next status() loses its three-way reference point.
  let prevModules: Record<string, unknown> = {};
  try {
    const prev = readState(repoDir, host);
    if (prev) prevModules = prev.modules;
  } catch {
    // malformed prior state → start fresh
  }
  const now = new Date().toISOString();
  writeState(repoDir, {
    host,
    schemaVersion: STATE_SCHEMA_VERSION,
    capturedAt: now,
    lastSeen: now,
    modules: prevModules,
  });
  await commitRepo(exec, repoDir, "roost: capture");
}
