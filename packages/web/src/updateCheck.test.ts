import { describe, it, expect, vi } from "vitest";
import { isNewerVersion, checkForUpdate } from "./updateCheck";

describe("isNewerVersion", () => {
  it.each([
    ["v0.2.0", "0.1.0", true],
    ["0.1.1", "0.1.0", true],
    ["1.0.0", "0.9.9", true],
    ["0.1.0", "0.1.0", false],
    ["v0.1.0", "0.2.0", false],
    ["garbage", "0.1.0", false],
  ])("latest=%s current=%s → %s", (latest, current, want) => {
    expect(isNewerVersion(latest, current)).toBe(want);
  });
});

describe("checkForUpdate", () => {
  it("returns UpdateInfo when GitHub reports a newer tag", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v0.9.0", html_url: "https://github.com/Chenkeliang/roost/releases/tag/v0.9.0" }),
    }) as unknown as typeof fetch;
    const r = await checkForUpdate("0.1.0", fetchImpl);
    expect(r).toEqual({ version: "v0.9.0", url: "https://github.com/Chenkeliang/roost/releases/tag/v0.9.0" });
  });
  it("returns null when up to date or on any failure", async () => {
    const same = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v0.1.0", html_url: "x" }) }) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", same)).toBeNull();
    const bad = vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", bad)).toBeNull();
    const http = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", http)).toBeNull();
  });
});
