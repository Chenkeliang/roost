import { describe, it, expect } from "vitest";
import type { SyncModule } from "@roost/shared";
import { ModuleRegistry } from "../registry.js";
import {
  ROOST_API_VERSION,
  validatePlugin,
  loadPlugins,
} from "./loader.js";
import type { RoostPlugin } from "./loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNoOpModule(name: string): SyncModule {
  return {
    name,
    async discover() { return []; },
    async status() { return { module: name, items: [] }; },
    async capture() { return { module: name, written: [], encrypted: [] }; },
    async apply() { return { module: name, applied: [], backedUp: [], skipped: [] }; },
    async diff() { return ""; },
    async unmanage() { return { module: name, applied: [], backedUp: [], skipped: [] }; },
    async doctor() { return [{ name, ok: true }]; },
  };
}

function makeValidPlugin(pluginName: string, moduleName: string): RoostPlugin {
  return {
    manifest: { name: pluginName, version: "0.1.0", roostApi: ROOST_API_VERSION },
    createModule: () => makeNoOpModule(moduleName),
  };
}

// ---------------------------------------------------------------------------
// validatePlugin
// ---------------------------------------------------------------------------

describe("validatePlugin", () => {
  it("accepts a valid plugin", () => {
    const plugin = makeValidPlugin("roost-module-fonts", "fonts");
    const result = validatePlugin(plugin);
    expect(result.manifest.name).toBe("roost-module-fonts");
  });

  it("throws when input is null", () => {
    expect(() => validatePlugin(null)).toThrow();
  });

  it("throws when manifest is missing", () => {
    expect(() => validatePlugin({ createModule: () => makeNoOpModule("x") })).toThrow(/manifest/);
  });

  it("throws when createModule is missing", () => {
    expect(() =>
      validatePlugin({ manifest: { name: "p", version: "0.1.0", roostApi: ROOST_API_VERSION } }),
    ).toThrow(/createModule/);
  });

  it("throws when manifest.name is not a string", () => {
    expect(() =>
      validatePlugin({
        manifest: { name: 42, version: "0.1.0", roostApi: ROOST_API_VERSION },
        createModule: () => makeNoOpModule("x"),
      }),
    ).toThrow(/name/);
  });

  it("throws when manifest.version is not a string", () => {
    expect(() =>
      validatePlugin({
        manifest: { name: "p", version: 1, roostApi: ROOST_API_VERSION },
        createModule: () => makeNoOpModule("x"),
      }),
    ).toThrow(/version/);
  });

  it("throws when roostApi !== ROOST_API_VERSION", () => {
    expect(() =>
      validatePlugin({
        manifest: { name: "p", version: "0.1.0", roostApi: 2 },
        createModule: () => makeNoOpModule("x"),
      }),
    ).toThrow(/api/i);
  });

  it("throws when createModule is not a function", () => {
    expect(() =>
      validatePlugin({
        manifest: { name: "p", version: "0.1.0", roostApi: ROOST_API_VERSION },
        createModule: "not-a-function",
      }),
    ).toThrow(/createModule/);
  });
});

// ---------------------------------------------------------------------------
// loadPlugins
// ---------------------------------------------------------------------------

describe("loadPlugins", () => {
  it("loads a valid plugin and registers its module", async () => {
    const reg = new ModuleRegistry();
    const validPlugin = makeValidPlugin("roost-module-fonts", "fonts");

    const importer = async (_spec: string): Promise<unknown> => validPlugin;

    const result = await loadPlugins(reg, ["roost-module-fonts"], importer);

    expect(result.loaded).toContain("roost-module-fonts");
    expect(result.rejected).toHaveLength(0);
    expect(reg.get("fonts")).toBeDefined();
    expect(reg.get("fonts")?.name).toBe("fonts");
  });

  it("rejects a plugin with api version mismatch", async () => {
    const reg = new ModuleRegistry();
    const mismatchPlugin = {
      manifest: { name: "roost-module-bad", version: "0.1.0", roostApi: 2 },
      createModule: () => makeNoOpModule("bad"),
    };

    const importer = async (_spec: string): Promise<unknown> => mismatchPlugin;

    const result = await loadPlugins(reg, ["roost-module-bad"], importer);

    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.spec).toBe("roost-module-bad");
    expect(result.rejected[0]!.reason).toMatch(/api/i);
  });

  it("rejects a malformed plugin (missing createModule)", async () => {
    const reg = new ModuleRegistry();
    const badPlugin = {
      manifest: { name: "roost-module-broken", version: "0.1.0", roostApi: ROOST_API_VERSION },
      // createModule intentionally omitted
    };

    const importer = async (_spec: string): Promise<unknown> => badPlugin;

    const result = await loadPlugins(reg, ["roost-module-broken"], importer);

    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/createModule/);
  });

  it("rejects when importer throws, other specs still load", async () => {
    const reg = new ModuleRegistry();
    const goodPlugin = makeValidPlugin("roost-module-fonts", "fonts");

    const importer = async (spec: string): Promise<unknown> => {
      if (spec === "roost-module-throws") {
        throw new Error("import failed: module not found");
      }
      return goodPlugin;
    };

    const result = await loadPlugins(
      reg,
      ["roost-module-throws", "roost-module-fonts"],
      importer,
    );

    expect(result.loaded).toContain("roost-module-fonts");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.spec).toBe("roost-module-throws");
    expect(result.rejected[0]!.reason).toMatch(/import failed/);
  });

  it("rejects duplicate registration and continues", async () => {
    const reg = new ModuleRegistry();
    // Pre-register "fonts"
    reg.register(makeNoOpModule("fonts"));

    const validPlugin = makeValidPlugin("roost-module-fonts", "fonts");
    const importer = async (_spec: string): Promise<unknown> => validPlugin;

    const result = await loadPlugins(reg, ["roost-module-fonts"], importer);

    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/already registered/i);
  });

  it("returns empty loaded/rejected for empty specs list", async () => {
    const reg = new ModuleRegistry();
    const result = await loadPlugins(reg, [], async (_s) => ({}));
    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});
