import { describe, it, expect } from "vitest";
import { ModuleRegistry } from "./registry.js";
import { exampleModule } from "./modules/example.js";
describe("ModuleRegistry", () => {
  it("registers and lists modules; rejects duplicates", () => {
    const r = new ModuleRegistry();
    r.register(exampleModule);
    expect(r.list().map((m) => m.name)).toEqual(["example"]);
    expect(() => r.register(exampleModule)).toThrow(/already registered/);
  });
  it("get returns the module or undefined", () => {
    const r = new ModuleRegistry();
    r.register(exampleModule);
    expect(r.get("example")?.name).toBe("example");
    expect(r.get("nope")).toBeUndefined();
  });
});
