// Update check (ADR-0020): the app's only outbound request — one GitHub call
// for release metadata, user-disableable, no telemetry.
const LATEST_URL = "https://api.github.com/repos/Chenkeliang/roost/releases/latest";

export interface UpdateInfo { version: string; url: string }

export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const parts = v.replace(/^v/, "").split(".").map(Number);
    return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : null;
  };
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

export async function checkForUpdate(currentVersion: string, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo | null> {
  try {
    const res = await fetchImpl(LATEST_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    if (body.tag_name && body.html_url && isNewerVersion(body.tag_name, currentVersion)) {
      return { version: body.tag_name, url: body.html_url };
    }
    return null;
  } catch {
    return null; // silent at launch; Settings' manual check surfaces its own copy
  }
}
