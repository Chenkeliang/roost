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

type CallRecord = { cmd: string; args: string[] };

function makeFakeExec(
  handler: (cmd: string, args: string[]) => ExecResult,
): { exec: Exec; calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  const exec: Exec = {
    async run(cmd, args) {
      calls.push({ cmd, args });
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
  it("happy path: creates repo, adds token-free origin, and pushes with a transient auth header", async () => {
    const { exec, calls } = makeFakeExec(gitHappyHandler({ headExists: true }));
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

    // origin added with a CREDENTIAL-FREE clone URL (no token in the URL).
    const remoteAdd = calls.find((c) => c.args.includes("remote") && c.args.includes("add"));
    expect(remoteAdd).toBeDefined();
    const originUrl = remoteAdd?.args[remoteAdd.args.length - 1] ?? "";
    expect(originUrl).toBe(CLONE_URL);
    expect(originUrl).not.toContain(TOKEN);

    // push happened, authenticated via a transient `-c http.extraHeader=...basic <base64>`.
    const push = calls.find((c) => c.args.includes("push"));
    expect(push).toBeDefined();
    const headerArg = push?.args.find((a) => a.startsWith("http.extraHeader="));
    expect(headerArg).toBeDefined();
    expect(headerArg).toMatch(/^http\.extraHeader=AUTHORIZATION: basic /);
    // The header carries base64(x-access-token:<token>), NOT the raw token.
    expect(headerArg).not.toContain(TOKEN);
    const b64 = (headerArg ?? "").replace("http.extraHeader=AUTHORIZATION: basic ", "");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(`x-access-token:${TOKEN}`);

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
