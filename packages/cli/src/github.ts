// GitHub HTTP helper — lives in the cli layer ONLY (core must never network).
// The token is used transiently for the Authorization header and is never
// persisted, never logged, and never included in thrown error messages.

const API_BASE = "https://api.github.com";
const USER_AGENT = "roost-cli";

/** Minimal fetch shape we depend on, so a fake can be injected in tests. */
export type FetchImpl = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
}

function defaultFetch(): FetchImpl {
  // global fetch (Node 18+); narrowed to our FetchImpl shape.
  return globalThis.fetch as unknown as FetchImpl;
}

/**
 * GET /user — resolve the authenticated user's login from the token.
 * 401 → a clear "invalid token" error. The token is never echoed.
 */
export async function getGitHubLogin(token: string, fetchImpl: FetchImpl = defaultFetch()): Promise<string> {
  const res = await fetchImpl(`${API_BASE}/user`, {
    method: "GET",
    headers: authHeaders(token),
  });

  if (res.status === 401) {
    throw new Error("GitHub rejected the token (401): the token is invalid or expired.");
  }
  if (res.status !== 200) {
    throw new Error(`GitHub GET /user failed (HTTP ${res.status}).`);
  }

  const body = (await res.json()) as { login?: unknown };
  if (typeof body.login !== "string" || body.login.length === 0) {
    throw new Error("GitHub GET /user returned no login.");
  }
  return body.login;
}

export interface CreatedRepo {
  cloneUrl: string;
  htmlUrl: string;
}

/**
 * POST /user/repos with { name, private: true } — create a PRIVATE repo.
 * 422 → actionable "already exists" error. The token is never echoed.
 */
export async function createPrivateRepo(
  token: string,
  name: string,
  fetchImpl: FetchImpl = defaultFetch(),
): Promise<CreatedRepo> {
  const res = await fetchImpl(`${API_BASE}/user/repos`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, private: true }),
  });

  if (res.status === 201) {
    const body = (await res.json()) as { clone_url?: unknown; html_url?: unknown };
    if (typeof body.clone_url !== "string" || typeof body.html_url !== "string") {
      throw new Error("GitHub created the repo but returned no clone/html URL.");
    }
    return { cloneUrl: body.clone_url, htmlUrl: body.html_url };
  }

  if (res.status === 401) {
    throw new Error("GitHub rejected the token (401): the token is invalid or expired.");
  }
  if (res.status === 422) {
    throw new Error(
      `GitHub could not create repo "${name}" (422): a repository with that name already exists, or the name is invalid.`,
    );
  }
  if (res.status === 403) {
    throw new Error(
      `GitHub refused the request (403): the token is missing the "repo" scope, or you hit a rate limit.`,
    );
  }
  throw new Error(`GitHub POST /user/repos failed (HTTP ${res.status}).`);
}
