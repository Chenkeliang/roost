import { describe, it, expect } from "vitest";
import { computeCoverage } from "./skillsCoverage";
import type { SkillRow } from "../api";

const ALL = ["claude", "codex", "gemini", "opencode"];
const row = (over: Partial<SkillRow>): SkillRow => ({
  name: "x",
  effective: { enabled: true, targets: ["claude", "codex", "gemini", "opencode"], method: "symlink" },
  links: [],
  conflicts: [],
  ...over,
});
const link = (target: string) => ({ skill: "x", target, path: "/p", kind: "symlink" as const });

describe("computeCoverage", () => {
  it("covered when every enabled target has a healthy link; denominator = all tools", () => {
    const c = computeCoverage(row({ links: ALL.map(link) }), ALL);
    expect(c).toMatchObject({ state: "covered", total: 4, healthy: 4 });
  });
  it("partial (amber) when an enabled target has no link", () => {
    const c = computeCoverage(row({ links: ["claude", "codex", "gemini"].map(link) }), ALL);
    expect(c).toMatchObject({ state: "partial", total: 4, healthy: 3, broken: 1 });
  });
  it("conflict (coral) when an enabled target is in conflicts", () => {
    const c = computeCoverage(row({ links: ["codex", "gemini", "opencode"].map(link), conflicts: ["claude"] }), ALL);
    expect(c.state).toBe("conflict");
    expect(c.conflict).toBe(1);
  });
  it("disabled when the skill is off; denominator is the total tool count", () => {
    const c = computeCoverage(row({ effective: { enabled: false, targets: ["claude", "codex"], method: "symlink" } }), ALL);
    expect(c).toMatchObject({ state: "disabled", total: 4 });
  });
  it("a skill enabled for 2 of 4 tools reads 2/4 with 4 segments (2 healthy, 2 off)", () => {
    const c = computeCoverage(row({ effective: { enabled: true, targets: ["claude", "codex"], method: "symlink" }, links: ["claude", "codex"].map(link) }), ALL);
    expect(c).toMatchObject({ state: "covered", total: 4, healthy: 2 });
    expect(c.segments).toEqual(["healthy", "healthy", "off", "off"]);
  });
});
