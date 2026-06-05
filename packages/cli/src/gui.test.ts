import { describe, it, expect } from "vitest";
import { resolveWebDir, isInsideAppBundle } from "./gui.js";

describe("gui helpers", () => {
  it("resolveWebDir points to ../Resources/web relative to the executable", () => {
    const exec = "/Applications/Roost.app/Contents/MacOS/Roost";
    expect(resolveWebDir(exec)).toBe(
      "/Applications/Roost.app/Contents/Resources/web",
    );
  });

  it("isInsideAppBundle is true for a MacOS dir inside a .app", () => {
    expect(isInsideAppBundle("/Applications/Roost.app/Contents/MacOS/Roost")).toBe(true);
  });

  it("isInsideAppBundle is false for a normal node path", () => {
    expect(isInsideAppBundle("/usr/local/bin/node")).toBe(false);
  });
});
