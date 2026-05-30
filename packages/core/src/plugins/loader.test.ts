import { describe, it, expect, vi } from "vitest";
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

    const result = await loadPlugins(reg, ["roost-module-fonts"], importer, {
      trusted: ["roost-module-fonts"],
    });

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

    const result = await loadPlugins(reg, ["roost-module-bad"], importer, {
      trusted: ["roost-module-bad"],
    });

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

    const result = await loadPlugins(reg, ["roost-module-broken"], importer, {
      trusted: ["roost-module-broken"],
    });

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
      { trusted: ["roost-module-throws", "roost-module-fonts"] },
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

    const result = await loadPlugins(reg, ["roost-module-fonts"], importer, {
      trusted: ["roost-module-fonts"],
    });

    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/already registered/i);
  });

  it("unwraps a default export (no top-level manifest) and loads successfully", async () => {
    const reg = new ModuleRegistry();
    const validPlugin = makeValidPlugin("roost-module-fonts", "fonts");

    // Simulate a module that only has a default export (no top-level manifest)
    const defaultExportModule = { default: validPlugin };
    const importer = async (_spec: string): Promise<unknown> => defaultExportModule;

    const result = await loadPlugins(reg, ["roost-module-fonts"], importer, {
      trusted: ["roost-module-fonts"],
    });

    expect(result.loaded).toContain("roost-module-fonts");
    expect(result.rejected).toHaveLength(0);
    expect(reg.get("fonts")).toBeDefined();
  });

  it("returns empty loaded/rejected for empty specs list", async () => {
    const reg = new ModuleRegistry();
    const result = await loadPlugins(reg, [], async (_s) => ({}));
    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Trust gate
// ---------------------------------------------------------------------------

describe("loadPlugins — trust gate", () => {
  it("rejects all specs when no opts provided (safe default) and does NOT call importer", async () => {
    const reg = new ModuleRegistry();
    const importer = vi.fn(async (_spec: string): Promise<unknown> => makeValidPlugin("roost-module-fonts", "fonts"));

    const result = await loadPlugins(reg, ["roost-module-fonts"]);

    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.spec).toBe("roost-module-fonts");
    expect(result.rejected[0]!.reason).toMatch(/trust|allowlist|confirm/i);
    // importer must NOT have been called for untrusted spec
    expect(importer).not.toHaveBeenCalled();
  });

  it("loads a spec listed in opts.trusted and calls importer", async () => {
    const reg = new ModuleRegistry();
    const validPlugin = makeValidPlugin("roost-module-fonts", "fonts");
    const importer = vi.fn(async (_spec: string): Promise<unknown> => validPlugin);

    const result = await loadPlugins(reg, ["roost-module-fonts"], importer, {
      trusted: ["roost-module-fonts"],
    });

    expect(result.loaded).toContain("roost-module-fonts");
    expect(result.rejected).toHaveLength(0);
    expect(importer).toHaveBeenCalledWith("roost-module-fonts");
  });

  it("rejects a spec NOT in opts.trusted and does NOT call importer", async () => {
    const reg = new ModuleRegistry();
    const importer = vi.fn(async (_spec: string): Promise<unknown> => makeValidPlugin("roost-module-evil", "evil"));

    const result = await loadPlugins(reg, ["roost-module-evil"], importer, {
      trusted: ["roost-module-safe"],
    });

    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.spec).toBe("roost-module-evil");
    expect(result.rejected[0]!.reason).toMatch(/trust|not trusted/i);
    expect(importer).not.toHaveBeenCalled();
  });

  it("loads trusted spec and rejects untrusted spec in the same call", async () => {
    const reg = new ModuleRegistry();
    const importer = vi.fn(async (spec: string): Promise<unknown> => makeValidPlugin(spec, spec));

    const result = await loadPlugins(
      reg,
      ["roost-module-trusted", "roost-module-evil"],
      importer,
      { trusted: ["roost-module-trusted"] },
    );

    expect(result.loaded).toContain("roost-module-trusted");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.spec).toBe("roost-module-evil");
    // importer called exactly once (for trusted only)
    expect(importer).toHaveBeenCalledOnce();
    expect(importer).toHaveBeenCalledWith("roost-module-trusted");
  });

  it("uses opts.confirm to approve a spec dynamically", async () => {
    const reg = new ModuleRegistry();
    const validPlugin = makeValidPlugin("roost-module-fonts", "fonts");
    const importer = vi.fn(async (_spec: string): Promise<unknown> => validPlugin);
    const confirm = vi.fn((_spec: string) => true);

    const result = await loadPlugins(reg, ["roost-module-fonts"], importer, { confirm });

    expect(result.loaded).toContain("roost-module-fonts");
    expect(result.rejected).toHaveLength(0);
    expect(confirm).toHaveBeenCalledWith("roost-module-fonts");
  });

  it("uses opts.confirm to deny a spec dynamically without calling importer", async () => {
    const reg = new ModuleRegistry();
    const importer = vi.fn(async (_spec: string): Promise<unknown> => ({}));
    const confirm = vi.fn((_spec: string) => false);

    const result = await loadPlugins(reg, ["roost-module-evil"], importer, { confirm });

    expect(result.loaded).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/trust|confirm|not trusted/i);
    // confirm does not import, so importer must not be called
    expect(importer).not.toHaveBeenCalled();
  });
});
