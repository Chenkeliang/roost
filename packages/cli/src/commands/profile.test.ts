import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runProfile } from "./profile.js";

let tmpDir: string;
let repoDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-profile-"));
  repoDir = path.join(tmpDir, "repo");
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function capture(): { log: (m: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (m) => lines.push(m), lines };
}

describe("runProfile default action", () => {
  it("prints the resolved profile and how it was resolved (default base)", () => {
    const { log, lines } = capture();
    runProfile({ repoDir, hostname: "h", flag: undefined, env: undefined, log });
    const out = lines.join("\n");
    expect(out).toMatch(/base/);
    expect(out).toMatch(/default/i);
  });

  it("reports the flag source when --profile is given", () => {
    const { log, lines } = capture();
    runProfile({ repoDir, hostname: "h", flag: "work", env: undefined, log });
    const out = lines.join("\n");
    expect(out).toMatch(/work/);
    expect(out).toMatch(/flag/i);
  });

  it("resolves via hostname from profiles.yaml", () => {
    fs.writeFileSync(
      path.join(repoDir, "roost", "profiles.yaml"),
      "profiles:\n  - name: primary\n    hostnames: [my-host]\n",
      "utf8",
    );
    const { log, lines } = capture();
    runProfile({ repoDir, hostname: "my-host", flag: undefined, env: undefined, log });
    const out = lines.join("\n");
    expect(out).toMatch(/primary/);
    expect(out).toMatch(/hostname/i);
  });
});

describe("runProfile list action", () => {
  it("lists defined profiles and marks the active one", () => {
    fs.writeFileSync(
      path.join(repoDir, "roost", "profiles.yaml"),
      "profiles:\n  - name: primary\n    hostnames: [my-host]\n  - name: follower\n",
      "utf8",
    );
    const { log, lines } = capture();
    runProfile({ repoDir, hostname: "my-host", flag: undefined, env: undefined, log, list: true });
    const out = lines.join("\n");
    expect(out).toMatch(/primary/);
    expect(out).toMatch(/follower/);
    // active marker on primary (matched by hostname)
    const primaryLine = lines.find((l) => l.includes("primary"));
    expect(primaryLine).toMatch(/\*|active/i);
  });

  it("notes when no profiles are defined", () => {
    const { log, lines } = capture();
    runProfile({ repoDir, hostname: "h", flag: undefined, env: undefined, log, list: true });
    expect(lines.join("\n")).toMatch(/no.*profile/i);
  });
});
