// Helpers for modules to emit three-way hashes (ADR-0016/0017). Hashing is pure;
// baseline loading reads this machine's persisted state.
import { createHash } from "node:crypto";
import * as os from "node:os";
import { readState, readBaseline } from "./state.js";
import type { ModuleBaseline } from "./state.js";

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
