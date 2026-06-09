import { describe, it, expect } from "vitest";
import { getGitHubLogin, createPrivateRepo, type FetchImpl } from "./github.js";

// ---------------------------------------------------------------------------
// Fake fetch helper
// ---------------------------------------------------------------------------

type FetchCall = { url: string; method: string; headers: Record<string, string>; body?: string };

function makeFakeFetch(
  responder: (call: FetchCall) => { status: number; json?: unknown; text?: string },
): { fetchImpl: FetchImpl; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    const call: FetchCall = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const r = responder(call);
    return {
      status: r.status,
      json: async () => r.json,
      text: async () => r.text ?? "",
    };
  };
  return { fetchImpl, calls };
}

const TOKEN = "ghp_fake_secret_token_value_1234567890";

// ---------------------------------------------------------------------------
// getGitHubLogin
// ---------------------------------------------------------------------------

describe("getGitHubLogin", () => {
  it("sends a Bearer Authorization header and parses the login", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({ status: 200, json: { login: "octocat" } }));

    const login = await getGitHubLogin(TOKEN, fetchImpl);

    expect(login).toBe("octocat");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.github.com/user");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.headers["Accept"]).toBe("application/vnd.github+json");
    expect(calls[0]?.headers["User-Agent"]).toBeTruthy();
  });

  it("throws a clear 'invalid token' error on 401 WITHOUT leaking the token", async () => {
    const { fetchImpl } = makeFakeFetch(() => ({ status: 401, json: { message: "Bad credentials" } }));

    await expect(getGitHubLogin(TOKEN, fetchImpl)).rejects.toThrow(/invalid|expired/i);

    // The thrown message must not contain the token.
    let message = "";
    try {
      await getGitHubLogin(TOKEN, fetchImpl);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain(TOKEN);
  });

  it("throws when /user returns no login", async () => {
    const { fetchImpl } = makeFakeFetch(() => ({ status: 200, json: {} }));
    await expect(getGitHubLogin(TOKEN, fetchImpl)).rejects.toThrow(/no login/i);
  });
});

// ---------------------------------------------------------------------------
// createPrivateRepo
// ---------------------------------------------------------------------------

describe("createPrivateRepo", () => {
  it("POSTs { private: true } and returns the clone/html URLs", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({
      status: 201,
      json: {
        clone_url: "https://github.com/octocat/roost-config.git",
        html_url: "https://github.com/octocat/roost-config",
      },
    }));

    const result = await createPrivateRepo(TOKEN, "roost-config", fetchImpl);

    expect(result.cloneUrl).toBe("https://github.com/octocat/roost-config.git");
    expect(result.htmlUrl).toBe("https://github.com/octocat/roost-config");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.github.com/user/repos");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(calls[0]?.body ?? "{}") as { name?: string; private?: boolean };
    expect(body.name).toBe("roost-config");
    expect(body.private).toBe(true);
  });

  it("throws a clear 'already exists' error on 422 WITHOUT leaking the token", async () => {
    const { fetchImpl } = makeFakeFetch(() => ({
      status: 422,
      json: { message: "Repository creation failed." },
    }));

    await expect(createPrivateRepo(TOKEN, "taken", fetchImpl)).rejects.toThrow(/already exists|invalid/i);

    let message = "";
    try {
      await createPrivateRepo(TOKEN, "taken", fetchImpl);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("taken");
    expect(message).not.toContain(TOKEN);
  });

  it("throws on 403 mentioning the repo scope WITHOUT leaking the token", async () => {
    const { fetchImpl } = makeFakeFetch(() => ({ status: 403, json: {} }));

    let message = "";
    try {
      await createPrivateRepo(TOKEN, "x", fetchImpl);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/scope|rate limit/i);
    expect(message).not.toContain(TOKEN);
  });
});
