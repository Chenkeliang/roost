import * as os from "node:os";
import type { Exec } from "@roost/shared";
import { writeState, commitRepo, STATE_SCHEMA_VERSION } from "@roost/core";

/**
 * Finalize a capture: stamp this machine's state into `state/<host>.json`, then
 * commit the repo. Shared by the CLI `capture` command and the dashboard
 * `POST /api/capture` so both produce a real snapshot + machine state.
 *
 * `home` is accepted for symmetry with the capture context; the host identity
 * comes from the OS hostname (the state file key).
 */
export async function finalizeCapture(exec: Exec, repoDir: string, _home: string): Promise<void> {
  writeState(repoDir, {
    host: os.hostname(),
    schemaVersion: STATE_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    modules: {},
  });
  await commitRepo(exec, repoDir, "roost: capture");
}
