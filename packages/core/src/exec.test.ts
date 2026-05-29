import { describe, it, expect } from "vitest";
import { createExec } from "./exec.js";
describe("exec adapter", () => {
  it("runs a command and captures stdout/code", async () => {
    const exec = createExec();
    const r = await exec.run("printf", ["hi"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("hi");
  });
  it("captures non-zero exit without throwing", async () => {
    const exec = createExec();
    const r = await exec.run("bash", ["-c", "exit 3"]);
    expect(r.code).toBe(3);
  });
  it("reports failure (not 0) for signal-killed processes", async () => {
    const exec = createExec();
    const r = await exec.run("bash", ["-c", "kill -TERM $$"]);
    expect(r.code).toBe(-1);
  });
});
