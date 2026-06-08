import { loadSkillsConfig, saveSkillsConfig, skillsModule } from "@roost/core";
import type { ModuleContext } from "@roost/shared";

export async function runSkillsLink(ctx: ModuleContext, opts: { copy?: boolean; targets?: string[] }): Promise<void> {
  if (opts.copy || opts.targets) {
    const cfg = loadSkillsConfig(ctx.repoDir);
    if (opts.copy) cfg.method = "copy";
    if (opts.targets?.length) cfg.targets = opts.targets;
    saveSkillsConfig(ctx.repoDir, cfg);
  }
  const res = await skillsModule.apply(ctx, { module: "skills", actions: [] });
  ctx.log.info(`linked: ${res.applied.join(", ") || "(none)"}`);
  if (res.skipped.length) ctx.log.warn(`skipped: ${res.skipped.join(", ")}`);
}

export async function runSkillsUnlink(ctx: ModuleContext): Promise<void> {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const saved: typeof cfg = JSON.parse(JSON.stringify(cfg));
  saveSkillsConfig(ctx.repoDir, {
    ...cfg,
    targets: [],
    skills: Object.fromEntries(Object.entries(cfg.skills).map(([k, v]) => [k, { ...v, enabled: false }])),
  });
  const res = await skillsModule.apply(ctx, { module: "skills", actions: [] });
  saveSkillsConfig(ctx.repoDir, saved); // restore recipe; links already reconciled away
  ctx.log.info(`unlinked: ${res.applied.filter((a) => a.startsWith("unlink")).join(", ") || "(none)"}`);
}

export function runSkillsToggle(ctx: ModuleContext, skill: string, enabled: boolean, target?: string): void {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const entry = cfg.skills[skill] ?? {};
  if (target) {
    const set = new Set(entry.targets ?? cfg.targets);
    if (enabled) set.add(target);
    else set.delete(target);
    entry.targets = [...set];
  } else {
    entry.enabled = enabled;
  }
  cfg.skills[skill] = entry;
  saveSkillsConfig(ctx.repoDir, cfg);
  ctx.log.info(`${enabled ? "enabled" : "disabled"} ${skill}${target ? "@" + target : ""}; run 'roost skills link' to apply`);
}
