import { execa } from "execa";
import type { Exec, ExecResult } from "@roost/shared";
export function createExec(): Exec {
  return {
    async run(cmd, args, opts): Promise<ExecResult> {
      const r = await execa(cmd, args, { cwd: opts?.cwd, env: opts?.env, reject: false });
      // exitCode is undefined when the process never ran (e.g. ENOENT — command not
      // found) or was killed by a signal. Never report 0 for those: a missing binary
      // must surface as failure, not masquerade as success (127 = command not found).
      const code = typeof r.exitCode === "number" ? r.exitCode : r.signal ? -1 : 127;
      return { code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}
