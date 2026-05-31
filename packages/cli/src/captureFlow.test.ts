import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createExec, readState } from "@roost/core";
import { ensureGitRepo } from "./gitRepo.js";
import { finalizeCapture } from "./captureFlow.js";

let repoDir: string;

beforeEach(async () => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-finalize-"));
  fs.writeFileSync(path.join(repoDir, "README"), "hi", "utf8");
  await ensureGitRepo(createExec(), repoDir);
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe("finalizeCapture", () => {
  it("writes state/<host>.json and creates a 'roost: capture' commit", async () => {
    await finalizeCapture(createExec(), repoDir, os.homedir());

    const host = os.hostname();
    const statePath = path.join(repoDir, "state", `${host}.json`);
    expect(fs.existsSync(statePath)).toBe(true);

    const state = readState(repoDir, host);
    expect(state).not.toBeNull();
    expect(state?.host).toBe(host);
    expect(state?.schemaVersion).toBe(1);
    expect(typeof state?.capturedAt).toBe("string");
    expect(state?.modules).toEqual({});

    const exec = createExec();
    const log = await exec.run("git", ["-C", repoDir, "log", "--pretty=%s"]);
    expect(log.stdout).toContain("roost: capture");
  });
});
