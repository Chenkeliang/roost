import { execa } from "execa";
import type { Exec, ExecResult } from "@roost/shared";

// GUI apps launched from Finder/Dock inherit launchd's minimal PATH, which omits
// Homebrew's bin dirs — so chezmoi / brew / age (installed under /opt/homebrew or
// /usr/local) become invisible to the desktop app even though they're installed.
// Prepend the standard Homebrew locations so external tools resolve in the app the
// same way they do in a login shell. macOS-only tool; harmless on other platforms.
const BREW_PATHS = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"];

export function execPath(basePath: string = process.env.PATH ?? ""): string {
  const base = basePath.split(":").filter(Boolean);
  const have = new Set(base);
  return [...BREW_PATHS.filter((p) => !have.has(p)), ...base].join(":");
}

export function createExec(): Exec {
  return {
    async run(cmd, args, opts): Promise<ExecResult> {
      const baseEnv = opts?.env ?? process.env;
      const env = { ...baseEnv, PATH: execPath(baseEnv.PATH ?? process.env.PATH ?? "") };
      const r = await execa(cmd, args, { cwd: opts?.cwd, env, reject: false });
      // exitCode is undefined when the process never ran (e.g. ENOENT — command not
      // found) or was killed by a signal. Never report 0 for those: a missing binary
      // must surface as failure, not masquerade as success (127 = command not found).
      const code = typeof r.exitCode === "number" ? r.exitCode : r.signal ? -1 : 127;
      return { code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}
