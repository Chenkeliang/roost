import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
  SyncModule, ModuleContext, Candidate, Selection,
  DriftReport, DriftItem, ChangeSet, ApplyPlan, ApplyResult, Health, ModuleIndex,
} from "@roost/shared";
import { loadSkillsTargets } from "../skills-catalog.js";
import { loadSkillsConfig, loadSkillLinks } from "../skills-config.js";
import { scanPathForSecrets } from "./dotfiles.js"; // reuse bounded content scanner

function expandHome(home: string, p: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

// All scan roots on this machine: the canonical source + each catalog target dir.
function scanRoots(ctx: ModuleContext): { id: string; dir: string }[] {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const targets = loadSkillsTargets(ctx.repoDir);
  const roots = [{ id: "source", dir: expandHome(ctx.home, cfg.sourceDir) }];
  for (const t of targets) roots.push({ id: t.id, dir: path.join(ctx.home, t.path) });
  return roots;
}

function listSkillDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Stable content hash of a skill directory (sorted relative file paths + bytes).
export function hashSkillDir(dir: string): string {
  const h = crypto.createHash("sha256");
  const walk = (d: string, rel: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) { h.update(r); h.update("\0symlink\0"); h.update(fs.readlinkSync(abs)); }
      else if (e.isDirectory()) walk(abs, r);
      else { h.update(r); h.update(fs.readFileSync(abs)); }
    }
  };
  try { walk(dir, ""); } catch { /* empty/missing */ }
  return h.digest("hex");
}

function repoSkillsDir(ctx: ModuleContext): string {
  return path.join(ctx.repoDir, "skills");
}

export const skillsModule: SyncModule = {
  name: "skills",

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const managed = new Set(listSkillDirs(repoSkillsDir(ctx)));
    // name -> set of {root, hash}
    const found = new Map<string, { roots: string[]; hashes: Set<string> }>();
    for (const { id, dir } of scanRoots(ctx)) {
      for (const name of listSkillDirs(dir)) {
        if (managed.has(name)) continue;
        const entry = found.get(name) ?? { roots: [], hashes: new Set() };
        entry.roots.push(id);
        entry.hashes.add(hashSkillDir(path.join(dir, name)));
        found.set(name, entry);
      }
    }
    const out: Candidate[] = [];
    for (const [name, e] of found) {
      const conflict = e.hashes.size > 1;
      out.push({
        id: name,
        path: name,
        category: "skills",
        recommendation: "track",
        note: conflict ? `conflict: differing content across ${e.roots.join(", ")}` : `found in ${e.roots.join(", ")}`,
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  },

  async index(ctx: ModuleContext): Promise<ModuleIndex> {
    const managed = listSkillDirs(repoSkillsDir(ctx)).length;
    return { available: true, managed };
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const names = sel.modules.skills ?? [];
    const written: string[] = [];
    const blocked: string[] = [];
    for (const name of names) {
      // find the first source root that has this skill
      const root = scanRoots(ctx).map((r) => path.join(r.dir, name)).find((p) => fs.existsSync(p));
      if (!root) { blocked.push(name); continue; }
      const scan = scanPathForSecrets(root);
      if (scan.tooLarge) { ctx.log.warn(`skills: ${name} too large to scan safely; blocked`); blocked.push(name); continue; }
      if (scan.secretFiles.length > 0) {
        ctx.log.warn(
          `skills capture: skill "${name}" contains potential secrets — skipped. Rotate any exposed credentials.`,
        );
        blocked.push(name);
        continue; // I6 hard gate
      }
      const dest = path.join(repoSkillsDir(ctx), name);
      if (!ctx.dryRun) {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(root, dest, { recursive: true });
      }
      written.push(name);
    }
    return { module: "skills", written, encrypted: [], blocked };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const names = sel.modules.skills ?? [];
    const cfg = loadSkillsConfig(ctx.repoDir);
    const items: DriftItem[] = names.map((name) => {
      const repoH = hashSkillDir(path.join(repoSkillsDir(ctx), name));
      const srcH = hashSkillDir(path.join(expandHome(ctx.home, cfg.sourceDir), name));
      if (!repoH) return { id: name, state: "untracked" };
      return { id: name, state: repoH === srcH ? "synced" : "drift" };
    });
    return { module: "skills", items };
  },

  async diff(ctx: ModuleContext, sel: Selection): Promise<string> {
    const rep = await this.status(ctx, sel);
    return rep.items.map((i) => `${i.state.padEnd(9)} ${i.id}`).join("\n");
  },

  // Task 5 fills this in (materialize + reconcile links).
  async apply(_ctx: ModuleContext, _plan: ApplyPlan): Promise<ApplyResult> {
    return { module: "skills", applied: [], backedUp: [], skipped: [] };
  },

  async unmanage(_ctx: ModuleContext, _sel: Selection): Promise<ApplyResult> {
    // Task 5 removes Roost-owned links here; for now no-op shell.
    return { module: "skills", applied: [], backedUp: [], skipped: [] };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const cfg = loadSkillsConfig(ctx.repoDir);
    const src = expandHome(ctx.home, cfg.sourceDir);
    const out: Health[] = [{ name: "skills:source", ok: true, detail: src }];
    // dangling links recorded by Roost
    for (const l of loadSkillLinks(ctx.repoDir)) {
      const broken = l.kind === "symlink" && (() => { try { fs.statSync(l.path); return false; } catch { return true; } })();
      if (broken) out.push({ name: `skills:dangling:${l.skill}@${l.target}`, ok: false, detail: l.path });
    }
    return out;
  },
};
