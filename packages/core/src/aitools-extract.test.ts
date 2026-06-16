import { describe, it, expect } from "vitest";
import { pickFields, mergeFields, extractArtifactPath } from "./aitools-extract.js";

describe("aitools-extract primitives", () => {
  it("pickFields keeps only listed top-level fields", () => {
    const live = { mcpServers: { a: 1 }, oauthToken: "SECRET", projects: {} };
    expect(pickFields(live, ["mcpServers"])).toEqual({ mcpServers: { a: 1 } });
  });
  it("pickFields skips absent fields", () => {
    expect(pickFields({ x: 1 }, ["mcpServers"])).toEqual({});
  });
  it("mergeFields sets only listed fields, preserving everything else", () => {
    const live = { mcpServers: { old: 1 }, oauthToken: "KEEP", projects: { p: 1 } };
    const merged = mergeFields(live, { mcpServers: { new: 2 } }, ["mcpServers"]);
    expect(merged.mcpServers).toEqual({ new: 2 });
    expect(merged.oauthToken).toBe("KEEP");
    expect(merged.projects).toEqual({ p: 1 });
  });
  it("mergeFields with absent picked field leaves live untouched for that field", () => {
    const live = { mcpServers: { old: 1 }, t: "k" };
    expect(mergeFields(live, {}, ["mcpServers"])).toEqual({ mcpServers: { old: 1 }, t: "k" });
  });
  it("artifact path is repo-scoped and slugged", () => {
    const p = extractArtifactPath("/repo", "/Users/x/.claude.json");
    expect(p).toMatch(/\/repo\/aitools-extract\/.+\.json\.age$/);
  });
});
