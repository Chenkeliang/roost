import type { SyncModule } from "@roost/shared";
export class ModuleRegistry {
  private mods = new Map<string, SyncModule>();
  register(m: SyncModule): void {
    if (this.mods.has(m.name)) throw new Error(`module already registered: ${m.name}`);
    this.mods.set(m.name, m);
  }
  get(name: string): SyncModule | undefined { return this.mods.get(name); }
  list(): SyncModule[] { return [...this.mods.values()]; }
}
