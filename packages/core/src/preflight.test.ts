import { describe, it, expect } from "vitest";
import type { SyncModule, Health, ModuleContext } from "@roost/shared";
import { ModuleRegistry } from "./registry.js";
import { preflight } from "./preflight.js";

function modWithDoctor(name: string, health: Health[]): SyncModule {
  return {
    name,
    async discover() { return []; },
    async status() { return { module: name, items: [] }; },
    async capture() { return { module: name, written: [], encrypted: [] }; },
    async apply() { return { module: name, applied: [], backedUp: [], skipped: [] }; },
    async diff() { return ""; },
    async unmanage() { return { module: name, applied: [], backedUp: [], skipped: [] }; },
    async doctor() { return health; },
  };
}
const ctx = {} as unknown as ModuleContext;

describe("preflight", () => {
  it("ok when no blocking check fails", async () => {
    const reg = new ModuleRegistry();
    reg.register(modWithDoctor("a", [{ name: "tool", ok: true, blocking: true }]));
    reg.register(modWithDoctor("b", [{ name: "optional", ok: false }])); // advisory failure
    const out = await preflight(reg, ctx);
    expect(out.ok).toBe(true);
    expect(out.blockers).toHaveLength(0);
    expect(out.checks).toHaveLength(2);
  });

  it("not ok and lists blockers when a blocking check fails", async () => {
    const reg = new ModuleRegistry();
    reg.register(modWithDoctor("a", [{ name: "chezmoi", ok: false, blocking: true, detail: "not installed" }]));
    reg.register(modWithDoctor("b", [{ name: "brew", ok: true, blocking: true }]));
    const out = await preflight(reg, ctx);
    expect(out.ok).toBe(false);
    expect(out.blockers.map((h) => h.name)).toEqual(["chezmoi"]);
  });
});
