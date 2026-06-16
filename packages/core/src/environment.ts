// First-run environment check (deps + age key + repo) for the Setup panel.
// All tool probes go through the Exec adapter (I3) so this is unit-testable.
import * as fs from "node:fs";
import type { Exec } from "@roost/shared";
import { defaultAgeKeyPath } from "./env-crypto.js";

export interface EnvCheck {
  id: string; // brew | git | chezmoi | age | mise | op | rbw | age-key | repo
  ok: boolean;
  required: boolean;
  brewFormula?: string; // present ⇒ installable via `brew install <formula>`
}

const TOOLS: { id: string; cmd: string; required: boolean; brew?: string }[] = [
  { id: "brew", cmd: "brew", required: true }, // Homebrew bootstraps itself (no formula)
  { id: "git", cmd: "git", required: true, brew: "git" },
  { id: "chezmoi", cmd: "chezmoi", required: true, brew: "chezmoi" },
  { id: "age", cmd: "age", required: true, brew: "age" },
  { id: "mise", cmd: "mise", required: false, brew: "mise" },
];

async function hasTool(exec: Exec, cmd: string): Promise<boolean> {
  const r = await exec.run(cmd, ["--version"]);
  return r.code === 0;
}

export async function checkEnvironment(
  exec: Exec,
  opts: { home: string; repoDir: string },
): Promise<EnvCheck[]> {
  const checks: EnvCheck[] = [];
  for (const t of TOOLS) {
    checks.push({ id: t.id, ok: await hasTool(exec, t.cmd), required: t.required, brewFormula: t.brew });
  }
  // Password-manager CLIs for `ref` secrets (ADR-0004). Non-required, not
  // brew-installable (op is a cask, rbw is cargo) — surfaced so the Env page
  // can warn when a chosen ref backend is unavailable.
  for (const cli of ["op", "rbw"] as const) {
    checks.push({ id: cli, ok: await hasTool(exec, cli), required: false });
  }
  checks.push({ id: "age-key", ok: fs.existsSync(defaultAgeKeyPath(opts.home)), required: false });
  let repoOk = false;
  try {
    repoOk = fs.existsSync(opts.repoDir) && fs.readdirSync(opts.repoDir).length > 0;
  } catch {
    repoOk = false;
  }
  checks.push({ id: "repo", ok: repoOk, required: false });
  return checks;
}

// One-click install of missing brew formulae. A system mutation — callers MUST
// gate this behind an explicit user action.
export async function brewInstall(
  exec: Exec,
  formulae: string[],
): Promise<{ ok: boolean; output: string }> {
  if (formulae.length === 0) return { ok: true, output: "" };
  const r = await exec.run("brew", ["install", ...formulae]);
  return { ok: r.code === 0, output: `${r.stdout}\n${r.stderr}`.trim() };
}
