import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult } from "@roost/shared";
import { checkEnvironment, brewInstall } from "./environment.js";

// exec that reports a given set of tools as present (exit 0), others missing.
function execWith(present: Set<string>, calls?: { cmd: string; args: string[] }[]): Exec {
  return {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls?.push({ cmd, args });
      return present.has(cmd) ? { code: 0, stdout: "v", stderr: "" } : { code: 127, stdout: "", stderr: "not found" };
    },
  };
}

describe("checkEnvironment", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-env-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("flags missing required tools and marks brew-installable ones", async () => {
    const exec = execWith(new Set(["git"])); // only git present
    const checks = await checkEnvironment(exec, { home: tmp, repoDir: tmp });
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by["git"]!.ok).toBe(true);
    expect(by["chezmoi"]!.ok).toBe(false);
    expect(by["chezmoi"]!.required).toBe(true);
    expect(by["chezmoi"]!.brewFormula).toBe("chezmoi");
    expect(by["age"]!.ok).toBe(false);
    expect(by["brew"]!.brewFormula).toBeUndefined(); // Homebrew has no formula
    expect(by["mise"]!.required).toBe(false);
  });

  it("detects the age key file and a populated repo dir", async () => {
    const exec = execWith(new Set(["brew", "git", "chezmoi", "age"]));
    const keyDir = path.join(tmp, ".config", "sops", "age");
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(path.join(keyDir, "keys.txt"), "k", "utf8");
    fs.writeFileSync(path.join(tmp, "something"), "x", "utf8"); // repo non-empty
    const checks = await checkEnvironment(exec, { home: tmp, repoDir: tmp });
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by["age-key"]!.ok).toBe(true);
    expect(by["repo"]!.ok).toBe(true);
  });

  it("includes op and rbw as non-required, non-brew checks", async () => {
    const exec = execWith(new Set(["brew", "git", "chezmoi", "age", "rbw"])); // op missing, rbw present
    const checks = await checkEnvironment(exec, { home: tmp, repoDir: tmp });
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by["op"]!.ok).toBe(false);
    expect(by["op"]!.required).toBe(false);
    expect(by["op"]!.brewFormula).toBeUndefined();
    expect(by["rbw"]!.ok).toBe(true);
    expect(by["rbw"]!.required).toBe(false);
  });
});

describe("brewInstall", () => {
  it("no-ops on empty list", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const exec = execWith(new Set(["brew"]), calls);
    const out = await brewInstall(exec, []);
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it("runs brew install with the formulae", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const exec = execWith(new Set(["brew"]), calls);
    const out = await brewInstall(exec, ["chezmoi", "age"]);
    expect(out.ok).toBe(true);
    expect(calls[0]).toEqual({ cmd: "brew", args: ["install", "chezmoi", "age"] });
  });
});
