import type { ModuleContext, Health } from "@roost/shared";
import type { ModuleRegistry } from "@roost/core";
export async function runDoctor(reg: ModuleRegistry, ctx: ModuleContext): Promise<Health[]> {
  const out: Health[] = [];
  for (const m of reg.list()) out.push(...(await m.doctor(ctx)));
  return out;
}
