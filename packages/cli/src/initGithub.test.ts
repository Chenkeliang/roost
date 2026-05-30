import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Exec, ExecResult, Logger } from "@roost/shared";
import { runInitGithub } from "./initGithub.js";
import type { FetchImpl } from "./github.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type CallRecord = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv };

function makeFakeExec(
  handler: (cmd: string, args: string[]) => ExecResult,
  onCall?: (rec: CallRecord) => void,
): { exec: Exec; calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  const exec: Exec = {
    async run(cmd, args, opts) {
      const rec: CallRecord = { cmd, args, env: opts?.env };
      calls.push(rec);
      onCall?.(rec);
      return handler(cmd, args);
    },
  };
  return { exec, calls };
}

function makeCaptureLogger(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const push = (msg: string): void => {
    lines.push(msg);
  };
  return { log: { info: push, warn: push, error: push }, lines };
}

type FetchCall = { url: string; method: string; headers: Record<string, string>; body?: string };

function makeFakeFetch(
  responder: (call: FetchCall) => { status: number; json?: unknown },
): { fetchImpl: FetchImpl; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    const call: FetchCall = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const r = responder(call);
    return { status: r.status, json: async () => r.json, text: async () => "" };
  };
  return { fetchImpl, calls };
}

// Simulates a healthy git repo with an existing initial commit on `main` so the
// flow proceeds straight to remote + push. Records all git invocations.
function gitHappyHandler(state: { headExists: boolean }) {
  return (cmd: string, args: string[]): ExecResult => {
    if (cmd !== "git") return { code: 0, stdout: "", stderr: "" };
    const sub = args[2]; // args = ["-C", repoDir, <sub>, ...] (or "-c k=v" before sub)
    const joined = args.join(" ");
    if (joined.includes("rev-parse --is-inside-work-tree")) return { code: 0, stdout: "true", stderr: "" };
    if (joined.includes("rev-parse --verify HEAD"))
      return state.headExists ? { code: 0, stdout: "abc123", stderr: "" } : { code: 128, stdout: "", stderr: "no HEAD" };
    if (joined.includes("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "main", stderr: "" };
    if (sub === "remote" || sub === "init" || sub === "add" || sub === "commit") return { code: 0, stdout: "", stderr: "" };
    if (joined.includes("push")) return { code: 0, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
}

const TOKEN = "ghp_super_secret_token_abcdef0123456789";
const CLONE_URL = "https://github.com/octocat/roost-config.git";
const HTML_URL = "https://github.com/octocat/roost-config";

let repoDir: string;

beforeEach(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-init-gh-"));
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

// Recursively reads every file in a dir and concatenates contents.
function readAllFiles(dir: string): string {
  let out = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out += readAllFiles(full);
    else out += fs.readFileSync(full, "utf8");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runInitGithub", () => {
  it("happy path: creates repo, adds username-only origin, and pushes with token off argv via GIT_ASKPASS", async () => {
    // Snapshot the askpass script state AT PUSH TIME (it is removed afterwards).
    let askpassAtPush: { existed: boolean; mode: number; body: string } | undefined;
    const { exec, calls } = makeFakeExec(gitHappyHandler({ headExists: true }), (rec) => {
      if (rec.args.includes("push")) {
        const p = rec.env?.GIT_ASKPASS as string | undefined;
        if (p && fs.existsSync(p)) {
          askpassAtPush = {
            existed: true,
            mode: fs.statSync(p).mode & 0o777,
            body: fs.readFileSync(p, "utf8"),
          };
        } else {
          askpassAtPush = { existed: false, mode: 0, body: "" };
        }
      }
    });
    const { fetchImpl, calls: fetchCalls } = makeFakeFetch((call) => {
      if (call.url.endsWith("/user")) return { status: 200, json: { login: "octocat" } };
      if (call.url.endsWith("/user/repos"))
        return { status: 201, json: { clone_url: CLONE_URL, html_url: HTML_URL } };
      return { status: 500 };
    });
    const { log, lines } = makeCaptureLogger();

    const result = await runInitGithub({
      repoDir,
      exec,
      log,
      dryRun: false,
      getToken: async () => TOKEN,
      getRepoName: async () => "roost-config",
      fetchImpl,
    });

    expect(result.pushed).toBe(true);
    expect(result.htmlUrl).toBe(HTML_URL);

    // origin added with a username-only URL (x-access-token@…), NO token in it.
    const remoteAdd = calls.find((c) => c.args.includes("remote") && c.args.includes("add"));
    expect(remoteAdd).toBeDefined();
    const originUrl = remoteAdd?.args[remoteAdd.args.length - 1] ?? "";
    expect(originUrl).toBe("https://x-access-token@github.com/octocat/roost-config.git");
    expect(originUrl).not.toContain(TOKEN);

    // H1: the token is OFF argv entirely. It must not appear in ANY element of
    // ANY git invocation (push included) — no `-c http.extraHeader` carrying it.
    const push = calls.find((c) => c.args.includes("push"));
    expect(push).toBeDefined();
    expect(push?.args.some((a) => a.includes("http.extraHeader"))).toBe(false);
    for (const c of calls) {
      for (const a of c.args) expect(a).not.toContain(TOKEN);
    }

    // H1: auth is supplied via GIT_ASKPASS pointing at a temp script + the token
    // in ROOST_GH_TOKEN (read by the script, not embedded in it).
    expect(push?.env).toBeDefined();
    expect(push?.env?.GIT_ASKPASS).toBeTruthy();
    expect(push?.env?.ROOST_GH_TOKEN).toBe(TOKEN);
    expect(push?.env?.GIT_TERMINAL_PROMPT).toBe("0");
    const askpassPath = push?.env?.GIT_ASKPASS as string;
    // The askpass temp script is removed after the push (even on success).
    expect(fs.existsSync(askpassPath)).toBe(false);

    // At push time the script existed, was mode 0700, and did NOT embed the token
    // (it reads $ROOST_GH_TOKEN from the environment).
    expect(askpassAtPush?.existed).toBe(true);
    expect(askpassAtPush?.mode).toBe(0o700);
    expect(askpassAtPush?.body).not.toContain(TOKEN);
    expect(askpassAtPush?.body).toContain("ROOST_GH_TOKEN");

    // The raw token never appears in any log line.
    expect(lines.join("\n")).not.toContain(TOKEN);

    // The token is never written to any file on disk (incl. .git/config — there's none here).
    expect(readAllFiles(repoDir)).not.toContain(TOKEN);

    // Two API calls were made (login + create).
    expect(fetchCalls).toHaveLength(2);
  });

  it("creates an initial commit when the repo has no HEAD yet", async () => {
    const { exec, calls } = makeFakeExec(gitHappyHandler({ headExists: false }));
    const { fetchImpl } = makeFakeFetch((call) => {
      if (call.url.endsWith("/user")) return { status: 200, json: { login: "octocat" } };
      return { status: 201, json: { clone_url: CLONE_URL, html_url: HTML_URL } };
    });
    const { log } = makeCaptureLogger();

    await runInitGithub({
      repoDir,
      exec,
      log,
      dryRun: false,
      getToken: async () => TOKEN,
      getRepoName: async () => "roost-config",
      fetchImpl,
    });

    expect(calls.some((c) => c.args.includes("commit"))).toBe(true);
  });

  it("dry-run makes NO fetch calls, NO push, and prints intent", async () => {
    const { exec, calls } = makeFakeExec(gitHappyHandler({ headExists: true }));
    const { fetchImpl, calls: fetchCalls } = makeFakeFetch(() => ({ status: 500 }));
    const { log, lines } = makeCaptureLogger();

    let tokenRequested = false;
    const result = await runInitGithub({
      repoDir,
      exec,
      log,
      dryRun: true,
      getToken: async () => {
        tokenRequested = true;
        return TOKEN;
      },
      getRepoName: async () => "roost-config",
      fetchImpl,
    });

    expect(result.dryRun).toBe(true);
    expect(result.pushed).toBe(false);
    expect(fetchCalls).toHaveLength(0);
    expect(calls.some((c) => c.args.includes("push"))).toBe(false);
    expect(calls.some((c) => c.args.includes("remote") && c.args.includes("add"))).toBe(false);
    expect(tokenRequested).toBe(false); // never asks for the token in dry-run
    const out = lines.join("\n");
    expect(out).toMatch(/dry-run/i);
    expect(out).toContain("roost-config");
    expect(out).not.toContain(TOKEN);
  });

  it("throws when no token is provided (non-dry-run)", async () => {
    const { exec } = makeFakeExec(gitHappyHandler({ headExists: true }));
    const { fetchImpl } = makeFakeFetch(() => ({ status: 200, json: { login: "x" } }));
    const { log } = makeCaptureLogger();

    await expect(
      runInitGithub({
        repoDir,
        exec,
        log,
        dryRun: false,
        getToken: async () => null,
        getRepoName: async () => "roost-config",
        fetchImpl,
      }),
    ).rejects.toThrow(/no github token/i);
  });
});
