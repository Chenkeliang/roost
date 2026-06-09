import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

// OPTIONAL, additive data file (like projects.yaml) — NOT selection.yaml.
// Maps machines to a profile name for cross-machine differentiation.
export interface Profile {
  name: string;
  hostnames?: string[];
}

export type ProfileVia = "flag" | "env" | "hostname" | "default";
export interface ResolvedProfile {
  profile: string;
  via: ProfileVia;
}

export const DEFAULT_PROFILE = "base";

function profilesPath(repoDir: string): string {
  return path.join(repoDir, "roost", "profiles.yaml");
}

export function loadProfiles(repoDir: string): Profile[] {
  const filePath = profilesPath(repoDir);
  if (!fs.existsSync(filePath)) return [];

  const raw = yaml.load(fs.readFileSync(filePath, "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("profiles.yaml must be a YAML object");
  }
  const list = (raw as Record<string, unknown>)["profiles"];
  if (!Array.isArray(list)) {
    throw new Error("profiles.yaml: profiles must be an array");
  }

  const profiles: Profile[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("profiles.yaml: each profile entry must be an object");
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry["name"] !== "string" || entry["name"].length === 0) {
      throw new Error("profiles.yaml: each profile entry must have a non-empty name");
    }
    const profile: Profile = { name: entry["name"] };
    if (entry["hostnames"] !== undefined) {
      const hns = entry["hostnames"];
      if (!Array.isArray(hns) || !hns.every((h) => typeof h === "string")) {
        throw new Error(`profiles.yaml: ${profile.name}.hostnames must be an array of strings`);
      }
      profile.hostnames = hns as string[];
    }
    profiles.push(profile);
  }
  return profiles;
}

// Precedence: flag > env > hostname match > "base".
export function resolveProfile(args: {
  flag?: string;
  env?: string;
  hostname: string;
  profiles: Profile[];
}): ResolvedProfile {
  const { flag, env, hostname, profiles } = args;

  if (flag && flag.length > 0) return { profile: flag, via: "flag" };
  if (env && env.length > 0) return { profile: env, via: "env" };

  const matched = profiles.find((p) => (p.hostnames ?? []).includes(hostname));
  if (matched) return { profile: matched.name, via: "hostname" };

  return { profile: DEFAULT_PROFILE, via: "default" };
}
