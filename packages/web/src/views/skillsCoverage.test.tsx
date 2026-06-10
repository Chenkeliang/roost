import { describe, it, expect } from "vitest";
import { computeCoverage } from "./skillsCoverage";
import type { SkillRow } from "../api";

const row = (over: Partial<SkillRow>): SkillRow => ({
  name: "x",
  effective: { enabled: true, targets: ["claude", "codex", "gemini", "opencode"], method: "symlink" },
  links: [],
  conflicts: [],
  ...over,
});
const link = (target: string) => ({ skill: "x", target, path: "/p", kind: "symlink" as const });

describe("computeCoverage", () => {
  it("covered when every desired target has a healthy link", () => {
    const c = computeCoverage(row({ links: ["claude", "codex", "gemini", "opencode"].map(link) }));
    expect(c).toMatchObject({ state: "covered", desired: 4, healthy: 4 });
  });
  it("partial (amber) when a desired target has no link", () => {
    const c = computeCoverage(row({ links: ["claude", "codex", "gemini"].map(link) }));
    expect(c).toMatchObject({ state: "partial", desired: 4, healthy: 3, broken: 1 });
  });
  it("conflict (coral) when a desired target is in conflicts", () => {
    const c = computeCoverage(row({ links: ["codex", "gemini", "opencode"].map(link), conflicts: ["claude"] }));
    expect(c.state).toBe("conflict");
    expect(c.conflict).toBe(1);
  });
  it("disabled when the skill is off, denominator is its desired set size", () => {
    const c = computeCoverage(row({ effective: { enabled: false, targets: ["claude", "codex"], method: "symlink" } }));
    expect(c.state).toBe("disabled");
  });
  it("a skill scoped to 2 targets reads 2/2 when both linked (not 2/4)", () => {
    const c = computeCoverage(row({ effective: { enabled: true, targets: ["claude", "codex"], method: "symlink" }, links: ["claude", "codex"].map(link) }));
    expect(c).toMatchObject({ state: "covered", desired: 2, healthy: 2 });
  });
});
