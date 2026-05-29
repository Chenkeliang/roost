import * as crypto from "node:crypto";
import type { Exec } from "@roost/shared";

export type DomainSnapshot = Record<string, string>; // domain -> sha256 of its `defaults export` output

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function snapshotDomains(exec: Exec, domains?: string[]): Promise<DomainSnapshot> {
  let targetDomains = domains;

  if (!targetDomains) {
    const r = await exec.run("defaults", ["domains"]);
    const raw = r.stdout.trim();
    targetDomains = raw ? raw.split(", ").map((d) => d.trim()).filter(Boolean) : [];
  }

  const snapshot: DomainSnapshot = {};

  for (const domain of targetDomains) {
    const r = await exec.run("defaults", ["export", domain, "-"]);
    const content = r.code === 0 ? r.stdout : "";
    snapshot[domain] = sha256(content);
  }

  return snapshot;
}

export function diffSnapshots(
  before: DomainSnapshot,
  after: DomainSnapshot,
): { added: string[]; changed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];

  for (const [domain, hash] of Object.entries(after)) {
    if (!(domain in before)) {
      added.push(domain);
    } else if (before[domain] !== hash) {
      changed.push(domain);
    }
  }

  return { added, changed };
}

export async function quitApp(exec: Exec, appName: string): Promise<void> {
  // Tolerate non-zero — app may not be running
  await exec.run("osascript", ["-e", `quit app "${appName}"`]);
}
