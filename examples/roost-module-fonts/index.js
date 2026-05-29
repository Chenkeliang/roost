/**
 * roost-module-fonts — reference implementation of the roost-module-* contract.
 *
 * A real font-management plugin would implement discover() to list installed
 * fonts and capture()/apply() to copy them into/out of the repo.
 * This example uses no-ops so it compiles and loads without side-effects.
 */

export const manifest = {
  name: "roost-module-fonts",
  version: "0.1.0",
  roostApi: 1,
};

/** @returns {import("@roost/shared").SyncModule} */
export function createModule() {
  return {
    name: "fonts",
    async discover(_ctx) { return []; },
    async status(_ctx, _sel) { return { module: "fonts", items: [] }; },
    async capture(_ctx, _sel) { return { module: "fonts", written: [], encrypted: [] }; },
    async apply(_ctx, _plan) { return { module: "fonts", applied: [], backedUp: [], skipped: [] }; },
    async diff(_ctx, _sel) { return ""; },
    async unmanage(_ctx, _sel) { return { module: "fonts", applied: [], backedUp: [], skipped: [] }; },
    async doctor(_ctx) { return [{ name: "fonts", ok: true }]; },
  };
}

/** Default export satisfies the RoostPlugin shape expected by loadPlugins(). */
export default { manifest, createModule };
