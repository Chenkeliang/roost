import type { ModuleRegistry } from "@roost/core";

export interface PluginsDeps {
  registry: ModuleRegistry;
  log: (msg: string) => void;
}

export function runPlugins(deps: PluginsDeps): void {
  const { registry, log } = deps;
  const modules = registry.list();

  if (modules.length === 0) {
    log("No modules registered.");
    return;
  }

  log("Registered modules:");
  for (const mod of modules) {
    log(`  ${mod.name}`);
  }
}
