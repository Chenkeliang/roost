import { describe, it, expect, vi } from "vitest";
import { createLogger } from "./logger.js";
describe("redacting logger", () => {
  it("masks token-like and key=value secrets", () => {
    const sink = vi.fn();
    const log = createLogger(sink);
    log.info("token=ghp_ABCDEF123456 done");
    log.info("Authorization: Bearer sk-supersecretvalue");
    expect(sink).toHaveBeenCalledWith("info", "token=*** done");
    expect(sink).toHaveBeenCalledWith("info", "Authorization: Bearer ***");
    log.info("pulled with ghp_ABCDEF123");
    expect(sink).toHaveBeenCalledWith("info", "pulled with ghp_***");
  });
});
