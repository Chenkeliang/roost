import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Exec, Logger } from "@roost/shared";
import { runInit } from "./init.js";
import { ensureGitRepo } from "./gitRepo.js";
import { getGitHubLogin, createPrivateRepo, type FetchImpl } from "./github.js";

export interface InitGithubDeps {
  repoDir: string;
  exec: Exec;
  log: Logger;
  dryRun: boolean;
  /** Resolve the GitHub PAT (masked prompt / env). Returns null if unavailable. */
  getToken: () => Promise<string | null>;
  /** Resolve the desired repo name; receives the default (source dir name). */
  getRepoName: (defaultName: string) => Promise<string>;
  /** Injected for tests; defaults to global fetch in the real command. */
  fetchImpl?: FetchImpl;
}

export interface InitGithubResult {
  repoName: string;
  htmlUrl?: string;
  pushed: boolean;
  dryRun: boolean;
}

/**
 * Rewrite a clone URL to embed only the username (`x-access-token`), NOT the
 * token: `https://github.com/o/r.git` → `https://x-access-token@github.com/o/r.git`.
 * git asks GIT_ASKPASS for the password; the token never lands on argv or in
 * .git/config. Returns the URL unchanged if it has no parseable https host.
 */
function usernameOnlyUrl(cloneUrl: string): string {
  try {
    const u = new URL(cloneUrl);
    if (u.protocol !== "https:") return cloneUrl;
    u.username = "x-access-token";
    u.password = "";
    return u.toString();
  } catch {
    return cloneUrl;
  }
}

/**
 * Write a temp GIT_ASKPASS helper (mode 0700). The token is NOT in the script —
 * the script prints whatever is in $ROOST_GH_TOKEN, which we pass via the child's
 * env. So the secret is never on argv, never in the script file, never logged.
 * Returns the script path; caller MUST remove it (finally) when done.
 */
function writeAskpassScript(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-askpass-"));
  const scriptPath = path.join(dir, "askpass.sh");
  fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' "$ROOST_GH_TOKEN"\n`, { mode: 0o700 });
  return scriptPath;
}

/** Remove the askpass script and its temp dir; never throws. */
function removeAskpassScript(scriptPath: string): void {
  try {
    fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function gitOrThrow(
  exec: Exec,
  repoDir: string,
  args: string[],
  what: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const res = await exec.run("git", ["-C", repoDir, ...args], env ? { env } : undefined);
  if (res.code !== 0) {
    throw new Error(`git ${what} failed: ${res.stderr.trim() || res.stdout.trim() || `exit ${res.code}`}`);
  }
}

/** Detect the current branch; falls back to "main". */
async function detectBranch(exec: Exec, repoDir: string): Promise<string> {
  const res = await exec.run("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"]);
  const name = res.stdout.trim();
  if (res.code === 0 && name.length > 0 && name !== "HEAD") return name;
  return "main";
}

/**
 * `roost init --github`:
 *   1. Run the local init (scaffold) + ensure a git repo with an initial commit.
 *   2. Create the user's PRIVATE GitHub repo via the API (token used in memory).
 *   3. Wire `origin` to a username-only URL (x-access-token@…, no token) and push,
 *      supplying the token to git via GIT_ASKPASS — never on argv.
 *
 * The token is read once, passed only to the GitHub API and the child push's env
 * (read by a temp askpass script that does NOT contain it). It is never on argv
 * (so it can't leak via `ps`/`/proc/<pid>/cmdline`), never written to
 * disk/.git/config, never logged, and goes out of scope when this returns.
 */
export async function runInitGithub(deps: InitGithubDeps): Promise<InitGithubResult> {
  const { repoDir, exec, log, dryRun, getToken, getRepoName, fetchImpl } = deps;

  // 1) Local scaffold (idempotent).
  const { created } = await runInit({ repoDir });
  if (created.length === 0) {
    log.info("roost init: already scaffolded, nothing to create");
  } else {
    for (const f of created) log.info(`created: ${f}`);
  }

  // Ensure a git repo + initial commit exist (idempotent; safe to re-run).
  await ensureGitRepo(exec, repoDir);

  const branch = await detectBranch(exec, repoDir);
  const defaultName = path.basename(repoDir) || "roost-config";
  const repoName = await getRepoName(defaultName);

  if (dryRun) {
    log.info("[dry-run] would prompt for a GitHub token (repo scope), used once and discarded");
    log.info(`[dry-run] would create a PRIVATE GitHub repo named "${repoName}"`);
    log.info("[dry-run] would add 'origin' with a username-only URL (no token)");
    log.info(`[dry-run] would push branch "${branch}" with the token supplied via GIT_ASKPASS (off argv)`);
    return { repoName, pushed: false, dryRun: true };
  }

  const token = await getToken();
  if (token === null || token.length === 0) {
    throw new Error("No GitHub token provided (set GITHUB_TOKEN or enter one when prompted).");
  }

  // 2) Resolve the login (validates the token) + create the private repo.
  const login = await getGitHubLogin(token, fetchImpl);
  log.info(`Authenticated as ${login}`);
  const { cloneUrl, htmlUrl } = await createPrivateRepo(token, repoName, fetchImpl);

  // 3) Wire origin with a username-only URL (no token), then push using GIT_ASKPASS.
  // Remove any pre-existing origin so re-runs don't fail (ignore failure if absent).
  const originUrl = usernameOnlyUrl(cloneUrl);
  await exec.run("git", ["-C", repoDir, "remote", "remove", "origin"]);
  await gitOrThrow(exec, repoDir, ["remote", "add", "origin", originUrl], "remote add origin");

  // The token is supplied to git ONLY via the child's environment (read by a temp
  // askpass script that does not contain it). It never appears on argv.
  const askpass = writeAskpassScript();
  try {
    await gitOrThrow(exec, repoDir, ["push", "-u", "origin", branch], "push", {
      ...process.env,
      ROOST_GH_TOKEN: token,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
    });
  } finally {
    removeAskpassScript(askpass);
  }

  log.info(`Pushed to ${htmlUrl}`);
  return { repoName, htmlUrl, pushed: true, dryRun: false };
}