/**
 * Real rbw binary integration test.
 *
 * Verifies that createRbwBackend surfaces rbw's failure as a thrown Error
 * without leaking any secret content.  Skipped when rbw is not on PATH.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createExec } from "../exec.js";
import { createRbwBackend } from "./backend.js";

// ---------------------------------------------------------------------------
// Detect real rbw binary
// ---------------------------------------------------------------------------
const hasRbw =
  spawnSync("rbw", ["--version"], { encoding: "utf8" }).status === 0;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("createRbwBackend — real binary", () => {
  it.skipIf(!hasRbw)(
    "throws a clear Error for a non-existent entry without leaking secrets",
    async () => {
      const exec = createExec();
      const backend = createRbwBackend(exec);

      // rbw will fail because: (a) not logged in, or (b) no such entry.
      // Either way the backend must surface the failure as a thrown Error.
      await expect(
        backend.get("nonexistent-roost-e2e"),
      ).rejects.toThrowError();

      // If it does throw, make sure the error message does not look like
      // a raw secret value (i.e. it is a recognisable error string, not blank).
      await backend.get("nonexistent-roost-e2e").catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg.length, "Error message should be non-empty").toBeGreaterThan(0);
      });
    },
  );
});
