import { describe, it, expect } from "vitest";
import { createExec, execPath } from "./exec.js";
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
  it("reports failure (not 0) when the command does not exist", async () => {
    const exec = createExec();
    const r = await exec.run("roost-definitely-not-a-real-command-xyz", []);
    expect(r.code).not.toBe(0);
  });
});

describe("execPath (GUI PATH fix)", () => {
  it("prepends Homebrew bin dirs to a minimal PATH", () => {
    expect(execPath("/usr/bin:/bin")).toBe(
      "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin",
    );
  });
  it("does not duplicate dirs already present", () => {
    const p = execPath("/opt/homebrew/bin:/usr/bin");
    expect(p.split(":").filter((x) => x === "/opt/homebrew/bin")).toHaveLength(1);
  });
  it("handles an empty base PATH", () => {
    expect(execPath("")).toBe("/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin");
  });
  it("createExec augments the child PATH so Homebrew tools resolve under a minimal (GUI) PATH", async () => {
    // Simulate the launchd minimal PATH a Finder/Dock-launched app would inherit.
    const r = await createExec().run("bash", ["-c", "echo $PATH"], { env: { PATH: "/usr/bin:/bin" } });
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith("/opt/homebrew/bin")).toBe(true);
  });
});
