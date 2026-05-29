import type { Exec } from "@roost/shared";

export interface Chezmoi {
  add(path: string, opts?: { encrypt?: boolean }): Promise<void>;
  apply(opts?: { dryRun?: boolean }): Promise<string>;
  diff(): Promise<string>;
  verify(): Promise<boolean>;
  managed(): Promise<string[]>;
}

export function createChezmoi(exec: Exec, opts: { sourceDir: string }): Chezmoi {
  const { sourceDir } = opts;

  async function runChecked(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const r = await exec.run("chezmoi", ["--source", sourceDir, ...args]);
    if (r.code !== 0) throw new Error(r.stderr || `chezmoi exited with code ${r.code}`);
    return { stdout: r.stdout, stderr: r.stderr };
  }

  return {
    async add(path: string, addOpts?: { encrypt?: boolean }): Promise<void> {
      const args = ["add", ...(addOpts?.encrypt ? ["--encrypt"] : []), path];
      await runChecked(args);
    },

    async apply(applyOpts?: { dryRun?: boolean }): Promise<string> {
      const args = ["apply", ...(applyOpts?.dryRun ? ["--dry-run"] : [])];
      const { stdout } = await runChecked(args);
      return stdout;
    },

    async diff(): Promise<string> {
      const { stdout } = await runChecked(["diff"]);
      return stdout;
    },

    async verify(): Promise<boolean> {
      const r = await exec.run("chezmoi", ["--source", sourceDir, "verify"]);
      return r.code === 0;
    },

    async managed(): Promise<string[]> {
      const { stdout } = await runChecked(["managed"]);
      return stdout.split("\n").filter((line) => line.length > 0);
    },
  };
}
