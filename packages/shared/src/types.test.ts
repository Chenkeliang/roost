import { describe, it, expect } from "vitest";
import { RECOMMENDATIONS, isRecommendation } from "./index.js";

describe("shared types", () => {
  it("exposes recommendation kinds", () => {
    expect(RECOMMENDATIONS).toEqual(["track", "encrypt", "exclude"]);
  });
  it("validates recommendation", () => {
    expect(isRecommendation("track")).toBe(true);
    expect(isRecommendation("nope")).toBe(false);
  });
});
