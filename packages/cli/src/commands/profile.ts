import { loadProfiles, resolveProfile } from "@roost/core";

export interface ProfileDeps {
  repoDir: string;
  hostname: string;
  flag?: string;
  env?: string;
  log: (msg: string) => void;
  list?: boolean;
}

const VIA_TEXT: Record<string, string> = {
  flag: "--profile flag",
  env: "ROOST_PROFILE env",
  hostname: "hostname match in profiles.yaml",
  default: "default (no override)",
};

export function runProfile(deps: ProfileDeps): void {
  const { repoDir, hostname, flag, env, log, list = false } = deps;

  const profiles = loadProfiles(repoDir);
  const resolved = resolveProfile({ flag, env, hostname, profiles });

  if (list) {
    if (profiles.length === 0) {
      log("No profiles defined (add roost/profiles.yaml to differentiate machines).");
      log(`Active profile: ${resolved.profile} (${VIA_TEXT[resolved.via]})`);
      return;
    }
    log("Defined profiles:");
    for (const p of profiles) {
      const active = p.name === resolved.profile && resolved.via === "hostname";
      const marker = active ? "* " : "  ";
      const hosts = p.hostnames && p.hostnames.length > 0 ? ` [${p.hostnames.join(", ")}]` : "";
      log(`${marker}${p.name}${hosts}`);
    }
    log(`Active profile: ${resolved.profile} (${VIA_TEXT[resolved.via]})`);
    return;
  }

  log(`Active profile: ${resolved.profile}`);
  log(`Resolved via: ${VIA_TEXT[resolved.via]}`);
}
