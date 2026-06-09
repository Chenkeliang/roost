// Load preflight (ADR-0016 §5 step 2): run every module's doctor and gate the
// load on any failing check marked `blocking`. Advisory (non-blocking) failures
// are returned too, but never gate.
import type { ModuleContext, Health } from "@roost/shared";
import type { ModuleRegistry } from "./registry.js";

export interface PreflightResult {
  ok: boolean;
  blockers: Health[];
  checks: Health[];
}

export async function preflight(reg: ModuleRegistry, ctx: ModuleContext): Promise<PreflightResult> {
  const checks: Health[] = [];
  for (const mod of reg.list()) {
    const hs = await mod.doctor(ctx);
    checks.push(...hs);
  }
  const blockers = checks.filter((h) => h.blocking === true && !h.ok);
  return { ok: blockers.length === 0, blockers, checks };
}
