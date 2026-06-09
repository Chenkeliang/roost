// Import a skill (or a pack of skills) from a local .zip or a remote git URL,
// landing it in the canonical source dir AND the repo's skills/ — gated by the
// same Secret Scanner + size limit as capture (I6). Files only, never executed.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Exec, ModuleContext, BlockedItem } from "@roost/shared";
import { scanPathForSecrets } from "./modules/dotfiles.js";
import { loadSkillsConfig } from "./skills-config.js";

function expandHome(home: string, p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(home, p.slice(1)) : p;
}

export interface SkillImportResult {
  imported: string[];
  blocked: BlockedItem[];
}

// SKILL.md frontmatter `name:`, or null if absent/unreadable.
function frontmatterName(dir: string): string | null {
  try {
    const md = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    const m = /^\s*name:\s*([A-Za-z0-9._-]+)/m.exec(md.split(/^---\s*$/m)[1] ?? md);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

// Derive a skill name: SKILL.md frontmatter `name:` if present, else the dir basename.
export function skillName(dir: string): string {
  return frontmatterName(dir) ?? path.basename(dir);
}

const SKIP_DIRS = new Set([".git", "node_modules", ".github", "dist", "build", "__pycache__"]);

// Locate skill root(s) inside a staged directory:
//  - the dir itself if it holds SKILL.md (single skill)
//  - otherwise a bounded recursive walk collecting every dir that directly holds
//    SKILL.md (handles repos that nest skills under any folder structure).
export function findSkillRoots(stagedDir: string, fallbackName?: string): { name: string; path: string }[] {
  if (fs.existsSync(path.join(stagedDir, "SKILL.md"))) {
    const name = frontmatterName(stagedDir) ?? fallbackName ?? path.basename(stagedDir);
    return [{ name, path: stagedDir }];
  }
  const roots: { name: string; path: string }[] = [];
  const maxDepth = 5;
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const child = path.join(dir, e.name);
      if (fs.existsSync(path.join(child, "SKILL.md"))) {
        roots.push({ name: skillName(child), path: child }); // a skill — don't descend further
      } else {
        walk(child, depth + 1);
      }
    }
  };
  walk(stagedDir, 0);
  return roots;
}

export async function extractZip(exec: Exec, zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  // macOS-native, safe extraction (no zip-slip outside destDir).
  const r = await exec.run("ditto", ["-x", "-k", zipPath, destDir]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `unzip failed (code ${r.code})`);
}

export async function gitShallowClone(exec: Exec, url: string, destDir: string): Promise<void> {
  const r = await exec.run("git", ["clone", "--depth", "1", url, destDir], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, // fail fast instead of hanging on auth
  });
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git clone failed (code ${r.code})`);
}

// Ingest every skill root found under stagedDir into source + repo, gating each
// on the secret/size scan. `.git` is never copied.
export function importStaged(ctx: ModuleContext, stagedDir: string, fallbackName?: string): SkillImportResult {
  const cfg = loadSkillsConfig(ctx.repoDir);
  const sourceRoot = expandHome(ctx.home, cfg.sourceDir);
  const repoSkills = path.join(ctx.repoDir, "skills");
  const roots = findSkillRoots(stagedDir, fallbackName);
  const imported: string[] = [];
  const blocked: BlockedItem[] = [];

  for (const r of roots) {
    const scan = scanPathForSecrets(r.path);
    if (scan.tooLarge) {
      blocked.push({ id: r.name, reason: "too-large", detail: `${(scan.bytes / 1024 / 1024) | 0}MB / ${scan.files} files` });
      continue;
    }
    if (scan.secretFiles.length > 0) {
      blocked.push({ id: r.name, reason: "secret", detail: `${scan.secretFiles.length} file(s)` });
      continue;
    }
    const cpFilter = (src: string): boolean => path.basename(src) !== ".git";
    for (const destRoot of [sourceRoot, repoSkills]) {
      const dest = path.join(destRoot, r.name);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(r.path, dest, { recursive: true, dereference: false, filter: cpFilter });
    }
    imported.push(r.name);
  }
  return { imported, blocked };
}

export async function importFromZip(ctx: ModuleContext, zipPath: string): Promise<SkillImportResult> {
  const tmp = fs.mkdtempSync(path.join(ctx.home, ".roost-skill-import-"));
  try {
    await extractZip(ctx.exec, zipPath, tmp);
    const fallback = path.basename(zipPath).replace(/\.zip$/i, "");
    return importStaged(ctx, tmp, fallback);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function importFromGit(ctx: ModuleContext, url: string): Promise<SkillImportResult> {
  const tmp = fs.mkdtempSync(path.join(ctx.home, ".roost-skill-import-"));
  try {
    await gitShallowClone(ctx.exec, url, tmp);
    const fallback = path.basename(url).replace(/\.git$/i, "");
    return importStaged(ctx, tmp, fallback);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
