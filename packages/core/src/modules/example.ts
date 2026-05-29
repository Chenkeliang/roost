import type { SyncModule } from "@roost/shared";
export const exampleModule: SyncModule = {
  name: "example",
  async discover() { return []; },
  async status() { return { module: "example", items: [] }; },
  async capture() { return { module: "example", written: [], encrypted: [] }; },
  async apply() { return { module: "example", applied: [], backedUp: [], skipped: [] }; },
  async diff() { return ""; },
  async unmanage() { return { module: "example", applied: [], backedUp: [], skipped: [] }; },
  async doctor() { return [{ name: "example", ok: true }]; },
};
