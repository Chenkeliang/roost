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
export type Segment = "healthy" | "broken" | "conflict";
export interface Coverage {
  state: CoverageState;
  desired: number; // m
  healthy: number; // n
  broken: number;
  conflict: number;
  segments: Segment[]; // one per desired target, in effective.targets order
}

// Coverage by the DESIRED set (effective.targets). A skill intentionally scoped
// to 2 tools reads 2/2 (covered), never 2/4.
export function computeCoverage(row: SkillRow): Coverage {
  const desired = row.effective.targets;
  if (!row.effective.enabled) {
    return { state: "disabled", desired: desired.length, healthy: 0, broken: 0, conflict: 0, segments: [] };
  }
  const segments: Segment[] = desired.map((id) => {
    if (row.conflicts?.includes(id)) return "conflict";
    return row.links.some((l) => l.target === id) ? "healthy" : "broken";
  });
  const healthy = segments.filter((s) => s === "healthy").length;
  const conflict = segments.filter((s) => s === "conflict").length;
  const broken = segments.filter((s) => s === "broken").length;
  const state: CoverageState = conflict > 0 ? "conflict" : broken > 0 ? "partial" : "covered";
  return { state, desired: desired.length, healthy, broken, conflict, segments };
}
