import { describe, it, expect } from "vitest";
import type { Exec, ExecResult } from "@roost/shared";
import { diffSnapshots, snapshotDomains, quitApp } from "./learn.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeExec(
  responses: Array<ExecResult | ((cmd: string, args: string[]) => ExecResult)>,
): {
  exec: Exec;
  calls: { cmd: string; args: string[] }[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
  let idx = 0;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      const resp = responses[idx] ?? { code: 0, stdout: "", stderr: "" };
      idx++;
      if (typeof resp === "function") return resp(cmd, args);
      return resp;
    },
  };
  return { exec, calls };
}

// ── diffSnapshots ─────────────────────────────────────────────────────────────

describe("diffSnapshots", () => {
  it("detects added domains", () => {
    const before = { "com.apple.dock": "abc123" };
    const after = { "com.apple.dock": "abc123", "com.apple.Finder": "def456" };
    const result = diffSnapshots(before, after);
    expect(result.added).toEqual(["com.apple.Finder"]);
    expect(result.changed).toHaveLength(0);
  });

  it("detects changed domains", () => {
    const before = { "com.apple.dock": "abc123", "com.apple.Finder": "def456" };
    const after = { "com.apple.dock": "newHash", "com.apple.Finder": "def456" };
    const result = diffSnapshots(before, after);
    expect(result.changed).toEqual(["com.apple.dock"]);
    expect(result.added).toHaveLength(0);
  });

  it("reports unchanged domains in neither list", () => {
    const before = { "com.apple.dock": "same" };
    const after = { "com.apple.dock": "same" };
    const result = diffSnapshots(before, after);
    expect(result.added).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it("handles both added and changed simultaneously", () => {
    const before = { "a": "h1", "b": "h2" };
    const after = { "a": "h1_changed", "b": "h2", "c": "h3" };
    const result = diffSnapshots(before, after);
    expect(result.changed).toContain("a");
    expect(result.added).toContain("c");
    expect(result.changed).not.toContain("b");
  });

  it("is pure — does not mutate inputs", () => {
    const before = { "a": "h1" };
    const after = { "a": "h2" };
    const beforeCopy = { ...before };
    const afterCopy = { ...after };
    diffSnapshots(before, after);
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });
});

// ── snapshotDomains ───────────────────────────────────────────────────────────

describe("snapshotDomains", () => {
  it("returns a map of domain -> sha256 hash (explicit domains list)", async () => {
    const xml = "<?xml version=\"1.0\"?><plist><dict></dict></plist>";
    const { exec } = makeFakeExec([
      { code: 0, stdout: xml, stderr: "" }, // export com.apple.dock
      { code: 0, stdout: xml, stderr: "" }, // export com.apple.Finder
    ]);

    const snap = await snapshotDomains(exec, ["com.apple.dock", "com.apple.Finder"]);

    expect(Object.keys(snap)).toContain("com.apple.dock");
    expect(Object.keys(snap)).toContain("com.apple.Finder");
    // Both have same xml -> same hash
    expect(snap["com.apple.dock"]).toBe(snap["com.apple.Finder"]);
    // Hash is a non-empty string
    expect(typeof snap["com.apple.dock"]).toBe("string");
    expect((snap["com.apple.dock"] ?? "").length).toBeGreaterThan(0);
  });

  it("produces stable hashes — same input always same hash", async () => {
    const xml = "stable content";
    const { exec: exec1 } = makeFakeExec([{ code: 0, stdout: xml, stderr: "" }]);
    const { exec: exec2 } = makeFakeExec([{ code: 0, stdout: xml, stderr: "" }]);

    const snap1 = await snapshotDomains(exec1, ["com.apple.dock"]);
    const snap2 = await snapshotDomains(exec2, ["com.apple.dock"]);

    expect(snap1["com.apple.dock"]).toBe(snap2["com.apple.dock"]);
  });

  it("produces different hashes for different content", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "content A", stderr: "" },
      { code: 0, stdout: "content B", stderr: "" },
    ]);

    const snap = await snapshotDomains(exec, ["com.apple.dock", "com.apple.Finder"]);

    expect(snap["com.apple.dock"]).not.toBe(snap["com.apple.Finder"]);
  });

  it("uses defaults domains when no explicit list given", async () => {
    const { exec, calls } = makeFakeExec([
      { code: 0, stdout: "com.apple.dock, com.apple.Finder", stderr: "" }, // defaults domains
      { code: 0, stdout: "<xml1>", stderr: "" }, // export dock
      { code: 0, stdout: "<xml2>", stderr: "" }, // export Finder
    ]);

    const snap = await snapshotDomains(exec);

    // first call should be defaults domains
    expect(calls[0]?.cmd).toBe("defaults");
    expect(calls[0]?.args).toContain("domains");

    expect(Object.keys(snap)).toContain("com.apple.dock");
    expect(Object.keys(snap)).toContain("com.apple.Finder");
  });

  it("handles export failure gracefully — domain gets empty hash", async () => {
    // When a domain fails to export, it should not crash the whole snapshot
    const { exec } = makeFakeExec([
      { code: 1, stdout: "", stderr: "export failed" },
    ]);

    // Should not throw
    const snap = await snapshotDomains(exec, ["com.apple.badDomain"]);
    // Domain still appears but with a hash (of empty string or similar)
    expect(Object.keys(snap)).toContain("com.apple.badDomain");
  });
});

// ── quitApp ───────────────────────────────────────────────────────────────────

describe("quitApp", () => {
  it("calls osascript with quit app <name>", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "", stderr: "" }]);
    await quitApp(exec, "Safari");

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.cmd).toBe("osascript");
    expect(call.args).toContain("-e");
    const script = call.args.find((a) => a.includes("quit app"));
    expect(script).toBeDefined();
    expect(script).toContain("Safari");
  });

  it("tolerates non-zero exit (app may not be running)", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "", stderr: "not running" }]);
    // Must not throw
    await expect(quitApp(exec, "Finder")).resolves.toBeUndefined();
  });
});
