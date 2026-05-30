import * as path from "node:path";
import type { Exec, Logger } from "@roost/shared";
import { runInit } from "./init.js";
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

/** Base64 of `x-access-token:<token>` for a transient Basic Authorization header. */
function basicAuthHeaderValue(token: string): string {
  const encoded = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return `AUTHORIZATION: basic ${encoded}`;
}

async function gitOrThrow(exec: Exec, repoDir: string, args: string[], what: string): Promise<void> {
  const res = await exec.run("git", ["-C", repoDir, ...args]);
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
 *   3. Wire `origin` to a credential-free clone URL and push, authenticating
 *      with the token via a transient `-c http.extraHeader` (never persisted).
 *
 * The token is read once, passed only to the GitHub API and the one-off push
 * header, never written to disk/.git/config, never logged, and goes out of
 * scope when this function returns.
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
  await ensureGitRepo(exec, repoDir, log);

  const branch = await detectBranch(exec, repoDir);
  const defaultName = path.basename(repoDir) || "roost-config";
  const repoName = await getRepoName(defaultName);

  if (dryRun) {
    log.info("[dry-run] would prompt for a GitHub token (repo scope), used once and discarded");
    log.info(`[dry-run] would create a PRIVATE GitHub repo named "${repoName}"`);
    log.info("[dry-run] would add 'origin' with a credential-free clone URL");
    log.info(`[dry-run] would push branch "${branch}" using a transient auth header (not persisted)`);
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

  // 3) Wire origin WITHOUT credentials in the URL, then push with a transient header.
  // Remove any pre-existing origin so re-runs don't fail (ignore failure if absent).
  await exec.run("git", ["-C", repoDir, "remote", "remove", "origin"]);
  await gitOrThrow(exec, repoDir, ["remote", "add", "origin", cloneUrl], "remote add origin");

  // The token rides in a one-off `-c http.extraHeader` arg (redacted by the exec
  // adapter's logging) and is NOT written to .git/config.
  await gitOrThrow(
    exec,
    repoDir,
    ["-c", `http.extraHeader=${basicAuthHeaderValue(token)}`, "push", "-u", "origin", branch],
    "push",
  );

  log.info(`Pushed to ${htmlUrl}`);
  return { repoName, htmlUrl, pushed: true, dryRun: false };
}

/** Initialize a git repo (if needed) and create an initial commit (if needed). */
async function ensureGitRepo(exec: Exec, repoDir: string, log: Logger): Promise<void> {
  const inside = await exec.run("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    await gitOrThrow(exec, repoDir, ["init", "-b", "main"], "init");
    log.info("Initialized empty git repository");
  }

  // Is there at least one commit?
  const hasHead = await exec.run("git", ["-C", repoDir, "rev-parse", "--verify", "HEAD"]);
  if (hasHead.code !== 0) {
    await gitOrThrow(exec, repoDir, ["add", "-A"], "add");
    await gitOrThrow(exec, repoDir, ["commit", "-m", "chore: initial roost config"], "commit");
    log.info("Created initial commit");
  }
}
