import { describe, it, expect } from "vitest";
import { runDoctor } from "./doctor.js";
import { ModuleRegistry, exampleModule, createExec, createLogger, createT } from "@roost/core";
describe("doctor", () => {
  it("aggregates health from registered modules", async () => {
    const reg = new ModuleRegistry();
    reg.register(exampleModule);
    const ctx = { repoDir: "/tmp", home: "/tmp", profile: "base", dryRun: true, exec: createExec(), log: createLogger(() => {}), t: createT("en") };
    const health = await runDoctor(reg, ctx);
    expect(health).toEqual([{ name: "example", ok: true }]);
  });
});
