import { describe, it, expect } from "vitest";
import { createT } from "./index.js";
describe("i18n", () => {
  it("returns english by default and interpolates", () => {
    const t = createT("en");
    expect(t("captured", { n: "12" })).toBe("Captured 12 items");
  });
  it("falls back to key when missing", () => {
    const t = createT("zh");
    expect(t("nonexistent_key")).toBe("nonexistent_key");
  });
  it("uses the zh catalog with interpolation", () => {
    const t = createT("zh");
    expect(t("captured", { n: "12" })).toBe("已备份 12 项");
  });
});
