// Helpers for modules to emit three-way hashes (ADR-0016/0017). Hashing is pure;
// baseline loading reads this machine's persisted state.
import { createHash } from "node:crypto";
import * as os from "node:os";
import { readState, writeState, readBaseline, writeBaseline, STATE_SCHEMA_VERSION } from "./state.js";
import type { MachineState, ModuleBaseline } from "./state.js";

export function hashContent(content: string | null): string | null {
  if (content === null) return null;
  return createHash("sha256").update(content).digest("hex");
}

// This machine's persisted baseline bag for a module (empty if none / unreadable).
export function loadModuleBaseline(repoDir: string, moduleName: string): ModuleBaseline {
  try {
    const st = readState(repoDir, os.hostname());
    return st ? readBaseline(st, moduleName) : {};
  } catch {
    return {};
  }
}

// Persist a module's baseline for this machine after a successful sync, so the
// next status() can tell Ahead from Behind (ADR-0016/0018). Tolerates a missing
// or malformed prior state file by starting fresh. Optionally records sync
// metadata used by the push-safety gate.
export function recordModuleBaseline(
  repoDir: string,
  host: string,
  moduleName: string,
  baseline: ModuleBaseline,
  meta?: { lastSyncedCommit?: string; lastSeen?: string },
): void {
  let st: MachineState | null = null;
  try {
    st = readState(repoDir, host);
  } catch {
    st = null;
  }
  let next: MachineState = st ?? {
    host,
    schemaVersion: STATE_SCHEMA_VERSION,
    capturedAt: null,
    modules: {},
  };
  next = writeBaseline(next, moduleName, baseline);
  next.schemaVersion = STATE_SCHEMA_VERSION;
  if (meta?.lastSyncedCommit !== undefined) next.lastSyncedCommit = meta.lastSyncedCommit;
  if (meta?.lastSeen !== undefined) next.lastSeen = meta.lastSeen;
  writeState(repoDir, next);
}
