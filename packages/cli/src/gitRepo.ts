import type { Exec } from "@roost/shared";

async function gitOrThrow(exec: Exec, repoDir: string, args: string[], what: string): Promise<void> {
  const res = await exec.run("git", ["-C", repoDir, ...args]);
  if (res.code !== 0) {
    throw new Error(`git ${what} failed: ${res.stderr.trim() || res.stdout.trim() || `exit ${res.code}`}`);
  }
}

/**
 * Ensure `repoDir` is a git repo with at least one commit (idempotent; safe to
 * re-run). If not inside a work tree, `git init -b main`; then if there is no
 * HEAD, `git add -A` + an initial commit. Tolerates "nothing to commit".
 *
 * All git access goes through the single `exec` adapter (I3).
 */
export async function ensureGitRepo(exec: Exec, repoDir: string): Promise<void> {
  const inside = await exec.run("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    await gitOrThrow(exec, repoDir, ["init", "-b", "main"], "init");
  }

  const hasHead = await exec.run("git", ["-C", repoDir, "rev-parse", "--verify", "HEAD"]);
  if (hasHead.code !== 0) {
    await gitOrThrow(exec, repoDir, ["add", "-A"], "add");
    // Explicit identity so init works on a machine/CI with no git user configured
    // (`-c` is per-command; it does not modify the user's git config).
    const commit = await exec.run("git", [
      "-C", repoDir,
      "-c", "user.name=Roost",
      "-c", "user.email=roost@localhost",
      "commit", "-m", "roost: init",
    ]);
    if (commit.code !== 0) {
      const combined = `${commit.stdout}\n${commit.stderr}`;
      if (!combined.includes("nothing to commit")) {
        throw new Error(`git commit failed: ${commit.stderr.trim() || combined.trim()}`);
      }
    }
  }
}
