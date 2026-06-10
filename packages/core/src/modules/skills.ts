import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
  SyncModule, ModuleContext, Candidate, Selection,
  DriftReport, DriftItem, ChangeSet, ApplyPlan, ApplyResult, Health, ModuleIndex, BlockedItem,
} from "@roost/shared";
import { loadSkillsTargets } from "../skills-catalog.js";
import { loadSkillsConfig, loadSkillLinks, saveSkillLinks, effectiveSkill } from "../skills-config.js";
import type { SkillLink } from "../skills-config.js";
import { scanPathForSecrets } from "./dotfiles.js"; // reuse bounded content scanner

function expandHome(home: string, p: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

function collapseHome(home: string, abs: string): string {
  if (abs === home) return "~";
  if (abs.startsWith(home + path.sep)) return "~/" + abs.slice(home.length + 1);
  return abs;
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

// Remove a Roost-created distribution ONLY if we still own it. Returns true if
// removed; false if the path was left untouched (user replaced it / gone).
function removeOwnedLink(ctx: ModuleContext, link: SkillLink): boolean {
  let st: ReturnType<typeof fs.lstatSync> | undefined;
  try { st = fs.lstatSync(link.path); } catch { return false; } // already gone → nothing to delete
  if (link.kind === "symlink") {
    if (!st.isSymbolicLink()) {
      ctx.log.warn(`skills: ${link.path} is no longer a Roost symlink; left in place`);
      return false; // user replaced our link with a real file/dir — never delete
    }
    // unlink (not rmSync) removes only the symlink itself, never its target
    if (!ctx.dryRun) fs.unlinkSync(link.path);
    return true;
  }
  // kind === "copy": only remove if the dir's content still matches the canonical
  // source (i.e. it's still our unmodified copy). If the user changed it, leave it.
  const cfg = loadSkillsConfig(ctx.repoDir);
  const srcHash = hashSkillDir(path.join(expandHome(ctx.home, cfg.sourceDir), link.skill));
  const curHash = hashSkillDir(link.path);
  if (st.isSymbolicLink() || curHash !== srcHash) {
    ctx.log.warn(`skills: ${link.path} was modified or replaced; left in place`);
    return false;
  }
  if (!ctx.dryRun) fs.rmSync(link.path, { recursive: true, force: true });
  return true;
}

// Source of truth for skills = roost/skills.yaml (recipe) + <repo>/skills/ +
// state/skills-links.json — NOT selection.yaml. `sel.modules.skills` is accepted
// by the generic capture/status path (so the orchestrator can pass names), but it
// is intentionally not the truth here; do NOT wire skills into select/Manage —
// that would create a competing truth source.
function materializeOne(ctx: ModuleContext, sourceRoot: string, repoDirSkills: string, name: string): void {
  const src = path.join(sourceRoot, name);
  if (ctx.dryRun) return;
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.rmSync(src, { recursive: true, force: true }); // removes only the symlink/dir here, never its target
  fs.cpSync(path.join(repoDirSkills, name), src, { recursive: true });
}

// Materialize repo content into the canonical source dir, replacing any symlink
// (decouples a skill from whatever tool the symlink pointed at). Skips names with
// no repo content. Returns the names actually materialized.
export function materializeSource(ctx: ModuleContext, names: string[]): string[] {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const sourceRoot = expandHome(ctx.home, cfg.sourceDir);
  const repoDirSkills = repoSkillsDir(ctx);
  const done: string[] = [];
  for (const name of names) {
    if (!fs.existsSync(path.join(repoDirSkills, name))) continue;
    materializeOne(ctx, sourceRoot, repoDirSkills, name);
    done.push(name);
  }
  return done;
}

export const skillsModule = {
  name: "skills",

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const repoDir = repoSkillsDir(ctx);
    // repo state per name: "real" (properly managed → skip), "broken" (symlink/empty → repair), "none"
    const repoState = (name: string): "real" | "broken" | "none" => {
      const p = path.join(repoDir, name);
      let st: fs.Stats;
      try { st = fs.lstatSync(p); } catch { return "none"; }
      if (st.isSymbolicLink()) return "broken";
      return hashSkillDir(p) ? "real" : "broken";
    };
    type Entry = { real: string; displayDir: string; hash: string; linked: boolean };
    const byName = new Map<string, Entry[]>();
    for (const { dir } of scanRoots(ctx)) {
      for (const name of listSkillDirs(dir)) {
        if (name.startsWith(".")) continue; // skip dotfile / junk entries
        const abs = path.join(dir, name);
        let real: string;
        try { real = fs.realpathSync(abs); } catch { continue; } // dangling link
        if (!fs.existsSync(path.join(real, "SKILL.md"))) continue; // must be a real skill
        let linked = false;
        try { linked = fs.lstatSync(abs).isSymbolicLink(); } catch { /* */ }
        // displayDir: for symlinks, the resolved parent of the target (where real content lives);
        // for non-symlinks, the scan dir. We use the readlink target's parent to show where content lives.
        let displayDir = dir;
        if (linked) {
          try {
            const target = fs.readlinkSync(abs);
            const resolvedTarget = path.isAbsolute(target) ? target : path.join(path.dirname(abs), target);
            displayDir = path.dirname(resolvedTarget);
          } catch { displayDir = path.dirname(real); }
        }
        const arr = byName.get(name) ?? [];
        arr.push({ real, displayDir, hash: hashSkillDir(real), linked });
        byName.set(name, arr);
      }
    }
    const loc = (displayDir: string): string => {
      // Try collapsing with the raw home first; if that works, use it.
      const collapsed = collapseHome(ctx.home, displayDir);
      if (collapsed !== displayDir) return collapsed; // home prefix matched without resolving
      // On macOS, ctx.home may be /var/... while realpathSync gives /private/var/...
      // Only attempt realpath normalization when the path might be under home.
      try {
        const rHome = fs.realpathSync(ctx.home);
        const rDir = fs.realpathSync(displayDir);
        const c2 = collapseHome(rHome, rDir);
        if (c2 !== rDir) return c2; // collapsed under resolved home
      } catch { /* ignore */ }
      return displayDir; // not under home: return absolute as-is
    };
    const out: Candidate[] = [];
    for (const [name, entries] of byName) {
      const rs = repoState(name);
      if (rs === "real") continue; // already properly managed
      const seen = new Map<string, Entry>();
      for (const e of entries) if (!seen.has(e.real)) seen.set(e.real, e);
      const distinct = [...seen.values()];
      const conflict = new Set(distinct.map((e) => e.hash)).size > 1;
      const rep = distinct[0]!;
      const scan = scanPathForSecrets(rep.real);
      out.push({
        id: name,
        path: name,
        category: "skills",
        recommendation: "track",
        sizeBytes: scan.bytes,
        note: conflict
          ? `conflict: differing content across ${distinct.map((e) => loc(e.displayDir)).join(", ")}`
          : rs === "broken"
            ? "needs repair (stored as symlink)"
            : `found in ${loc(rep.displayDir)}`,
        origin: {
          location: loc(rep.displayDir),
          linked: distinct.some((e) => e.linked),
          ...(rs === "broken" ? { needsRepair: true } : {}),
          ...(conflict ? { conflictLocations: distinct.map((e) => loc(e.displayDir)) } : {}),
        },
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  },

  async index(ctx: ModuleContext): Promise<ModuleIndex> {
    const managed = listSkillDirs(repoSkillsDir(ctx)).length;
    return { available: true, managed };
  },

  async capture(ctx: ModuleContext, sel: Selection, opts?: { from?: Record<string, string> }): Promise<ChangeSet> {
    const names = sel.modules.skills ?? [];
    const written: string[] = [];
    const blocked: string[] = [];
    const blockedDetail: BlockedItem[] = [];
    for (const name of names) {
      // prefer a user-chosen source dir (conflict picker), else first scan root that has it
      const chosen = opts?.from?.[name];
      const chosenPath = chosen ? path.join(expandHome(ctx.home, chosen), name) : undefined;
      const root = chosenPath && fs.existsSync(chosenPath)
        ? chosenPath
        : scanRoots(ctx).map((r) => path.join(r.dir, name)).find((p) => fs.existsSync(p));
      if (!root) { blocked.push(name); blockedDetail.push({ id: name, reason: "error", detail: "not found" }); continue; }
      const scan = scanPathForSecrets(root);
      if (scan.tooLarge) {
        ctx.log.warn(`skills: ${name} too large to scan safely; blocked`);
        blocked.push(name);
        blockedDetail.push({ id: name, reason: "too-large", detail: `${Math.round(scan.bytes / 1048576)}MB / ${scan.files} files` });
        continue;
      }
      if (scan.secretFiles.length > 0) {
        ctx.log.warn(`skills capture: skill "${name}" contains potential secrets — skipped. Rotate any exposed credentials.`);
        blocked.push(name);
        blockedDetail.push({ id: name, reason: "secret", detail: `${scan.secretFiles.length} file(s)` });
        continue; // I6 hard gate
      }
      // dereference a top-level symlink so REAL content lands in the repo (inner symlinks preserved)
      const realRoot = fs.lstatSync(root).isSymbolicLink() ? fs.realpathSync(root) : root;
      const dest = path.join(repoSkillsDir(ctx), name);
      if (!ctx.dryRun) {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(realRoot, dest, { recursive: true });
      }
      written.push(name);
    }
    return { module: "skills", written, encrypted: [], blocked, blockedDetail };
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

  async apply(ctx: ModuleContext, _plan: ApplyPlan): Promise<ApplyResult> {
    const cfg = loadSkillsConfig(ctx.repoDir);
    const targets = loadSkillsTargets(ctx.repoDir);
    const targetById = new Map(targets.map((t) => [t.id, t]));
    const sourceRoot = expandHome(ctx.home, cfg.sourceDir);
    const repoDirSkills = repoSkillsDir(ctx);
    const managed = listSkillDirs(repoDirSkills);

    const applied: string[] = [];
    const backedUp: string[] = [];
    const skipped: string[] = [];
    let links = loadSkillLinks(ctx.repoDir);

    const backupBase = path.join(ctx.home, ".roost-backups", "skills");

    // Desired set: enabled skill × its targets.
    const desired = new Set<string>(); // key `${skill}@${targetId}`
    for (const name of managed) {
      // 1) materialize repo -> sourceDir
      const src = path.join(sourceRoot, name);
      materializeOne(ctx, sourceRoot, repoDirSkills, name);
      const eff = effectiveSkill(cfg, name);
      if (!eff.enabled) continue;
      // 2) distribute to each enabled target
      for (const tid of eff.targets) {
        const t = targetById.get(tid);
        if (!t) { skipped.push(`${name}@${tid} (unknown target)`); continue; }
        desired.add(`${name}@${tid}`);
        const targetDir = path.join(ctx.home, t.path);
        const dest = path.join(targetDir, name);
        const ownsExisting = links.some((l) => l.skill === name && l.target === tid && l.path === dest);
        let existsKind: "none" | "link" | "real" = "none";
        try {
          const st = fs.lstatSync(dest);
          existsKind = st.isSymbolicLink() ? "link" : "real";
        } catch { existsKind = "none"; }

        if (existsKind === "real" && !ownsExisting) { skipped.push(`${name}@${tid} (conflict: real dir)`); continue; }

        if (ctx.dryRun) { applied.push(`${name}@${tid}`); continue; }

        fs.mkdirSync(targetDir, { recursive: true });
        if (existsKind !== "none") {
          // back up before replacing (real backup dir created lazily)
          const stamp = path.join(backupBase, String(Date.now()), tid);
          fs.mkdirSync(stamp, { recursive: true });
          fs.cpSync(dest, path.join(stamp, name), { recursive: true });
          backedUp.push(dest);
          fs.rmSync(dest, { recursive: true, force: true });
        }
        if (eff.method === "copy") fs.cpSync(src, dest, { recursive: true });
        else fs.symlinkSync(src, dest);
        links = links.filter((l) => !(l.skill === name && l.target === tid));
        links.push({ skill: name, target: tid, path: dest, kind: eff.method });
        applied.push(`${name}@${tid}`);
      }
    }

    // 3) reconcile: remove Roost-owned links no longer desired
    const keep: typeof links = [];
    for (const l of links) {
      if (desired.has(`${l.skill}@${l.target}`)) { keep.push(l); continue; }
      if (ctx.dryRun) { keep.push(l); continue; }
      removeOwnedLink(ctx, l); // removes only if still owned; user content preserved either way
      applied.push(`unlink ${l.skill}@${l.target}`);
    }
    if (!ctx.dryRun) saveSkillLinks(ctx.repoDir, keep);
    return { module: "skills", applied, backedUp, skipped };
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const names = new Set(sel.modules.skills ?? []);
    const links = loadSkillLinks(ctx.repoDir);
    const applied: string[] = [];
    const kept: typeof links = [];
    for (const l of links) {
      if (!names.has(l.skill)) { kept.push(l); continue; }
      removeOwnedLink(ctx, l); // removes only if still owned; self-gates on dryRun
      applied.push(`unlink ${l.skill}@${l.target}`);
    }
    if (!ctx.dryRun) saveSkillLinks(ctx.repoDir, kept);
    return { module: "skills", applied, backedUp: [], skipped: [] };
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
} satisfies SyncModule;

// Resolve a conflict by "back up & take over": MOVE the user's real dir at the
// target to ~/.roost-backups, then link/copy the canonical source into place.
// Guarded to act only on a genuine conflict (a real dir Roost doesn't own).
export async function resolveSkillConflict(
  ctx: ModuleContext,
  skill: string,
  targetId: string,
): Promise<{ backedUp: string; linked: string }> {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const target = loadSkillsTargets(ctx.repoDir).find((t) => t.id === targetId);
  if (!target) throw new Error(`unknown target: ${targetId}`);
  const dest = path.join(ctx.home, target.path, skill);

  let st: ReturnType<typeof fs.lstatSync>;
  try {
    st = fs.lstatSync(dest);
  } catch {
    throw new Error(`no conflict at ${dest}: nothing there`);
  }
  if (st.isSymbolicLink()) throw new Error(`no conflict: ${dest} is already a symlink`);
  if (!st.isDirectory()) throw new Error(`no conflict: ${dest} is not a directory`);
  const links = loadSkillLinks(ctx.repoDir);
  if (links.some((l) => l.skill === skill && l.target === targetId && l.path === dest)) {
    throw new Error(`no conflict: ${dest} is Roost-managed`);
  }

  const eff = effectiveSkill(cfg, skill);
  const sourceRoot = expandHome(ctx.home, cfg.sourceDir);
  const src = path.join(sourceRoot, skill);
  const backupPath = path.join(ctx.home, ".roost-backups", "skills", String(Date.now()), targetId, skill);
  if (ctx.dryRun) return { backedUp: backupPath, linked: dest };

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  try {
    fs.renameSync(dest, backupPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EXDEV") {
      fs.cpSync(dest, backupPath, { recursive: true });
      fs.rmSync(dest, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
  fs.mkdirSync(sourceRoot, { recursive: true });
  if (!fs.existsSync(src)) {
    const repoSkill = path.join(repoSkillsDir(ctx), skill);
    if (fs.existsSync(repoSkill)) fs.cpSync(repoSkill, src, { recursive: true });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (eff.method === "copy") fs.cpSync(src, dest, { recursive: true });
  else fs.symlinkSync(src, dest);
  links.push({ skill, target: targetId, path: dest, kind: eff.method });
  saveSkillLinks(ctx.repoDir, links);

  return { backedUp: backupPath, linked: dest };
}
