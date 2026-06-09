import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createExec } from "@roost/core";
import { ensureGitRepo } from "./gitRepo.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-gitrepo-"));
  // Seed a file so the initial commit is non-empty.
  fs.writeFileSync(path.join(dir, "README"), "hi", "utf8");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function isInsideWorkTree(d: string): Promise<boolean> {
  const exec = createExec();
  const r = await exec.run("git", ["-C", d, "rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

async function commitCount(d: string): Promise<number> {
  const exec = createExec();
  const r = await exec.run("git", ["-C", d, "rev-list", "--count", "HEAD"]);
  if (r.code !== 0) return 0;
  return parseInt(r.stdout.trim(), 10) || 0;
}

describe("ensureGitRepo", () => {
  it("initializes a git repo with an initial commit in a non-git dir", async () => {
    expect(await isInsideWorkTree(dir)).toBe(false);
    await ensureGitRepo(createExec(), dir);
    expect(await isInsideWorkTree(dir)).toBe(true);
    expect(await commitCount(dir)).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — re-running does not create extra commits or fail", async () => {
    await ensureGitRepo(createExec(), dir);
    const after1 = await commitCount(dir);
    await ensureGitRepo(createExec(), dir);
    const after2 = await commitCount(dir);
    expect(after2).toBe(after1);
    expect(await isInsideWorkTree(dir)).toBe(true);
  });
});
