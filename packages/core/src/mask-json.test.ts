import { describe, it, expect } from "vitest";
import { maskJsonStructure } from "./mask-json.js";

describe("maskJsonStructure", () => {
  it("keeps keys + structure but masks every leaf value", () => {
    const out = maskJsonStructure('{"mcpServers":{"ctx7":{"command":"node","args":["x"],"env":{"API_KEY":"sk-secret-123"}}},"oauthToken":"tok-abc"}');
    expect(out).not.toBeNull();
    // keys preserved
    expect(out).toContain("mcpServers");
    expect(out).toContain("ctx7");
    expect(out).toContain("command");
    expect(out).toContain("env");
    expect(out).toContain("API_KEY");
    expect(out).toContain("oauthToken");
    // NO leaf value survives
    expect(out).not.toContain("sk-secret-123");
    expect(out).not.toContain("tok-abc");
    expect(out).not.toContain("node");
    expect(out).not.toContain("\"x\"");
    expect(out).toContain("••••");
  });
  it("masks values inside arrays of objects", () => {
    const out = maskJsonStructure('[{"name":"a","secret":"s1"},{"name":"b","secret":"s2"}]');
    expect(out).toContain("name");
    expect(out).toContain("secret");
    expect(out).not.toContain("s1");
    expect(out).not.toContain("s2");
    expect(out).not.toContain("\"a\"");
  });
  it("returns null for non-JSON", () => {
    expect(maskJsonStructure("not json {")).toBeNull();
    expect(maskJsonStructure("")).toBeNull();
  });
});
