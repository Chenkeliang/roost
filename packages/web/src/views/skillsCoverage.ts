import type { SkillRow } from "../api";

// Per-(skill,target) status derived from effective state + links.
export function targetStatus(row: SkillRow, targetId: string): "linked" | "copy" | "conflict" | "broken" | "off" {
  const wanted = row.effective.enabled && row.effective.targets.includes(targetId);
  const link = row.links.find((l) => l.target === targetId);
  if (!wanted) return "off";
  if (row.conflicts?.includes(targetId)) return "conflict"; // real non-Roost dir occupies the dest
  if (!link) return "broken"; // wanted but no link on disk yet
  if (link.kind === "copy") return "copy";
  return "linked";
}

export type CoverageState = "covered" | "partial" | "conflict" | "disabled";
export type Segment = "healthy" | "broken" | "conflict" | "off";
export interface Coverage {
  state: CoverageState;
  total: number; // m — ALL catalog targets (denominator)
  healthy: number; // n — enabled + linked (numerator, the green count)
  broken: number;
  conflict: number;
  segments: Segment[]; // one per CATALOG target, in catalog order ("off" = not distributed there)
}

// Coverage over ALL catalog targets: m = total tools, n = how many the skill is
// healthily distributed to (the green count). A skill enabled for 2 of 4 tools
// reads 2/4 with 4 dots (2 green, 2 off).
export function computeCoverage(row: SkillRow, allTargetIds: string[]): Coverage {
  if (!row.effective.enabled) {
    return { state: "disabled", total: allTargetIds.length, healthy: 0, broken: 0, conflict: 0, segments: [] };
  }
  const enabled = new Set(row.effective.targets);
  const segments: Segment[] = allTargetIds.map((id) => {
    if (!enabled.has(id)) return "off"; // tool exists but skill isn't distributed there
    if (row.conflicts?.includes(id)) return "conflict";
    return row.links.some((l) => l.target === id) ? "healthy" : "broken";
  });
  const healthy = segments.filter((s) => s === "healthy").length;
  const conflict = segments.filter((s) => s === "conflict").length;
  const broken = segments.filter((s) => s === "broken").length;
  const state: CoverageState = conflict > 0 ? "conflict" : broken > 0 ? "partial" : "covered";
  return { state, total: allTargetIds.length, healthy, broken, conflict, segments };
}
