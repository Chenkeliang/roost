import type { Exec } from "@roost/shared";

export interface Chezmoi {
  add(path: string, opts?: { encrypt?: boolean }): Promise<void>;
  // `paths` (target paths) scopes the apply to just those entries; omit to apply
  // everything. Scoping avoids touching unrelated (possibly encrypted / scripted)
  // dotfiles when resolving a single item.
  apply(opts?: { dryRun?: boolean; paths?: string[] }): Promise<string>;
  diff(): Promise<string>;
  verify(): Promise<boolean>;
  // Target-relative paths (relative to home) that differ from the source — i.e.
  // the per-file equivalent of `verify` (parses `chezmoi status`).
  changedPaths(): Promise<string[]>;
  // The contents chezmoi would write for a target path (the "repo" side of a
  // diff). Returns null if the path is not managed / cannot be produced.
  cat(targetPath: string): Promise<string | null>;
  managed(): Promise<string[]>;
  forget(path: string): Promise<void>;
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

    async apply(applyOpts?: { dryRun?: boolean; paths?: string[] }): Promise<string> {
      // --force: apply non-interactively. chezmoi otherwise prompts (needs a TTY)
      // before overwriting a locally-modified target — which fails in the
      // headless sidecar. Safe because Roost backs up every target first (I7).
      const args = [
        "apply",
        "--force",
        ...(applyOpts?.dryRun ? ["--dry-run"] : []),
        ...(applyOpts?.paths ?? []),
      ];
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

    async changedPaths(): Promise<string[]> {
      // `chezmoi status` is git-status-like: two status columns, a space, then
      // the target path (relative to home). Any non-blank line = a change.
      const { stdout } = await runChecked(["status"]);
      return stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const m = /^..\s(.*)$/.exec(line);
          return (m ? m[1]! : line.trim()).trim();
        })
        .filter((p) => p.length > 0);
    },

    async cat(targetPath: string): Promise<string | null> {
      const r = await exec.run("chezmoi", ["--source", sourceDir, "cat", targetPath]);
      return r.code === 0 ? r.stdout : null;
    },

    async managed(): Promise<string[]> {
      const { stdout } = await runChecked(["managed"]);
      return stdout.split("\n").filter((line) => line.length > 0);
    },

    async forget(forgetPath: string): Promise<void> {
      const r = await exec.run("chezmoi", ["--source", sourceDir, "forget", "--force", forgetPath]);
      if (r.code !== 0) {
        // Forgetting a path chezmoi never managed is already the desired end
        // state (e.g. removing a dotfile that was selected but not yet captured),
        // so treat "not managed" as a successful no-op rather than an error.
        if (/not managed/i.test(r.stderr)) return;
        throw new Error(r.stderr || `chezmoi exited with code ${r.code}`);
      }
    },
  };
}
