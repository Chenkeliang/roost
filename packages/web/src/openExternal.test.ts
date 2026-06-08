import { describe, it, expect, vi, afterEach } from "vitest";
import { openExternal } from "./openExternal";

afterEach(() => { vi.restoreAllMocks(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

describe("openExternal", () => {
  it("uses window.open in a browser (no Tauri)", async () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternal("https://example.com");
    expect(spy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
  });
});
