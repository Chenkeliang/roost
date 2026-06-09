import { describe, it, expect } from "vitest";
import { runPlugins } from "./plugins.js";
import { ModuleRegistry } from "@roost/core";

describe("runPlugins", () => {
  it("lists the names of all registered modules", () => {
    const reg = new ModuleRegistry();
    // Mimic the 4 default modules the defaultRegistry() registers
    const names = ["dotfiles", "packages", "appconfig", "projects"];
    for (const n of names) {
      reg.register({
        name: n,
        async discover() { return []; },
        async status() { return { module: n, items: [] }; },
        async capture() { return { module: n, written: [], encrypted: [] }; },
        async apply() { return { module: n, applied: [], backedUp: [], skipped: [] }; },
        async diff() { return ""; },
        async unmanage() { return { module: n, applied: [], backedUp: [], skipped: [] }; },
        async doctor() { return [{ name: n, ok: true }]; },
      });
    }

    const lines: string[] = [];
    runPlugins({ registry: reg, log: (msg) => { lines.push(msg); } });

    const output = lines.join("\n");
    for (const n of names) {
      expect(output).toContain(n);
    }
  });

  it("prints a message when no modules are registered", () => {
    const reg = new ModuleRegistry();
    const lines: string[] = [];
    runPlugins({ registry: reg, log: (msg) => { lines.push(msg); } });
    expect(lines.join("\n")).toMatch(/no.*module/i);
  });
});
