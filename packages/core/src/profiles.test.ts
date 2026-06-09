import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadProfiles, resolveProfile } from "./profiles.js";

let tmpDir: string;
let repoDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-profiles-"));
  repoDir = path.join(tmpDir, "repo");
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadProfiles", () => {
  it("returns [] when profiles.yaml is absent", () => {
    expect(loadProfiles(repoDir)).toEqual([]);
  });

  it("parses a list of {name, hostnames?}", () => {
    fs.writeFileSync(
      path.join(repoDir, "roost", "profiles.yaml"),
      "profiles:\n  - name: primary\n    hostnames: [macbook-pro, work-mac]\n  - name: follower\n",
      "utf8",
    );
    expect(loadProfiles(repoDir)).toEqual([
      { name: "primary", hostnames: ["macbook-pro", "work-mac"] },
      { name: "follower" },
    ]);
  });

  it("throws on a malformed file", () => {
    fs.writeFileSync(path.join(repoDir, "roost", "profiles.yaml"), "profiles:\n  - hostnames: [x]\n", "utf8");
    expect(() => loadProfiles(repoDir)).toThrow(/name/i);
  });
});

describe("resolveProfile", () => {
  const profiles = [
    { name: "primary", hostnames: ["macbook-pro"] },
    { name: "follower", hostnames: ["mini"] },
  ];

  it("prefers the explicit flag above all", () => {
    const r = resolveProfile({ flag: "x", env: "y", hostname: "macbook-pro", profiles });
    expect(r).toEqual({ profile: "x", via: "flag" });
  });

  it("falls back to env when no flag", () => {
    const r = resolveProfile({ env: "y", hostname: "macbook-pro", profiles });
    expect(r).toEqual({ profile: "y", via: "env" });
  });

  it("matches a hostname when no flag/env", () => {
    const r = resolveProfile({ hostname: "macbook-pro", profiles });
    expect(r).toEqual({ profile: "primary", via: "hostname" });
  });

  it("defaults to base when nothing matches", () => {
    const r = resolveProfile({ hostname: "unknown-host", profiles });
    expect(r).toEqual({ profile: "base", via: "default" });
  });

  it("defaults to base with no profiles file", () => {
    const r = resolveProfile({ hostname: "macbook-pro", profiles: [] });
    expect(r).toEqual({ profile: "base", via: "default" });
  });

  it("ignores empty flag/env strings", () => {
    const r = resolveProfile({ flag: "", env: "", hostname: "mini", profiles });
    expect(r).toEqual({ profile: "follower", via: "hostname" });
  });
});
