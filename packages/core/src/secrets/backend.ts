import type { Exec } from "@roost/shared";

export interface SecretBackend {
  name: string;
  get(ref: string): Promise<string>;
}

function makeBackend(exec: Exec, cliName: string, cmdName: string, subcommand: string): SecretBackend {
  return {
    name: cliName,
    async get(ref: string): Promise<string> {
      const r = await exec.run(subcommand, [cmdName, ref]);
      if (r.code !== 0) {
        throw new Error(r.stderr || `${subcommand} exited with code ${r.code}`);
      }
      return r.stdout.trim();
    },
  };
}

export function createOpBackend(exec: Exec): SecretBackend {
  return makeBackend(exec, "1password", "read", "op");
}

export function createRbwBackend(exec: Exec): SecretBackend {
  return makeBackend(exec, "rbw", "get", "rbw");
}
