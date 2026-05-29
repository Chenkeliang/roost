import { execa } from "execa";
import type { Exec, ExecResult } from "@roost/shared";
export function createExec(): Exec {
  return {
    async run(cmd, args, opts): Promise<ExecResult> {
      const r = await execa(cmd, args, { cwd: opts?.cwd, reject: false });
      return { code: r.exitCode ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}
