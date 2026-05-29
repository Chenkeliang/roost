import { execa } from "execa";
import type { Exec, ExecResult } from "@roost/shared";
export function createExec(): Exec {
  return {
    async run(cmd, args, opts): Promise<ExecResult> {
      const r = await execa(cmd, args, { cwd: opts?.cwd, reject: false });
      // exitCode is null when killed by a signal — report failure, never 0
      return { code: r.exitCode ?? (r.signal ? -1 : 0), stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}
