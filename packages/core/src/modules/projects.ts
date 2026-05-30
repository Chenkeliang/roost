import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SyncModule,
  ModuleContext,
  Candidate,
  Selection,
  DriftReport,
  ChangeSet,
  ApplyPlan,
  ApplyResult,
  Health,
  Exec,
} from "@roost/shared";
import { loadProjects, saveProjects } from "../projects.js";

// ── remote parsing ──────────────────────────────────────────────────────────

export function parseRemoteHost(url: string | null): string | null {
  if (!url) return null;
  let m = url.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/:]+)/i); // scheme://[user@]host
  if (m) return m[1]!;
  m = url.match(/^[^@\s]+@([^:]+):/); // git@host:path
  if (m) return m[1]!;
  return "other";
}

export function parseRemoteProtocol(url: string | null): "ssh" | "https" | "other" {
  if (!url) return "other";
  if (/^https?:\/\//i.test(url)) return "https";
  if (/^ssh:\/\//i.test(url) || /^[^@\s]+@[^:]+:/.test(url)) return "ssh";
  return "other";
}

export function toHomeRelative(absPath: string, home: string): string {
  const prefix = home.endsWith("/") ? home : home + "/";
  return absPath === home ? "~" : absPath.startsWith(prefix) ? "~/" + absPath.slice(prefix.length) : absPath;
}

export function fromHomeRelative(stored: string, home: string): string {
  if (stored === "~") return home;
  return stored.startsWith("~/") ? path.join(home, stored.slice(2)) : stored;
}

// ── findGitRepos ──────────────────────────────────────────────────────────────

// Directory names that never hold user projects but are enormous to walk. Without
// this, scanning $HOME (which is a root) wanders into ~/Library and node_modules
// trees and takes tens of seconds — see the discover size guard (M4).
const IGNORE_DIRS = new Set([
  "node_modules",
  "Library",
  ".Trash",
  "Applications",
  "Pictures",
  "Movies",
  "Music",
  "vendor",
  "target",
  "dist",
  "build",
  "__pycache__",
  "venv",
  ".venv",
  "go", // ~/go/pkg is huge; ~/go/src is added as an explicit root in candidateRoots
]);

// Hard ceiling on directories visited so discovery is bounded on ANY machine
// (M4 size guard): a deep/large $HOME must never make discover hang.
const MAX_VISITS = 6000;

export function findGitRepos(roots: string[], maxDepth = 4): string[] {
  const found = new Set<string>();
  let visits = 0;

  function walk(dir: string, depth: number): void {
    if (depth < 0 || visits >= MAX_VISITS) return;
    visits++;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable — tolerate silently
    }

    for (const entry of entries) {
      if (entry.name === ".git") {
        found.add(dir);
        return; // don't recurse inside a git repo root
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue; // skip hidden dirs (incl .git)
      if (IGNORE_DIRS.has(entry.name)) continue; // skip huge/irrelevant trees
      if (visits >= MAX_VISITS) break;
      walk(path.join(dir, entry.name), depth - 1);
    }
  }

  for (const root of roots) {
    walk(root, maxDepth);
  }

  return [...found];
}

// ── repoInfo ──────────────────────────────────────────────────────────────────

export async function repoInfo(
  exec: Exec,
  dir: string,
): Promise<{ remote: string | null; branch: string | null; dirty: boolean; hasMise: boolean }> {
  const remoteResult = await exec.run("git", ["-C", dir, "remote", "get-url", "origin"]);
  const remote = remoteResult.code === 0 ? remoteResult.stdout.trim() : null;

  const branchResult = await exec.run("git", ["-C", dir, "branch", "--show-current"]);
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;

  const statusResult = await exec.run("git", ["-C", dir, "status", "--porcelain"]);
  const dirty = statusResult.stdout.trim().length > 0;

  const hasMise = fs.existsSync(path.join(dir, ".mise.toml"));

  return { remote, branch, dirty, hasMise };
}

// Run `fn` over items with bounded concurrency, preserving order. Keeps discover
// fast (parallel git probes) without spawning hundreds of processes at once.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]!, idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ── candidate roots ───────────────────────────────────────────────────────────

const EXTRA_SUBDIRS = [
  "Projects",
  "Developer",
  "Code",
  "work",
  "repos",
  "src",
  "go/src",
];

function candidateRoots(home: string): string[] {
  const roots = [home];
  for (const sub of EXTRA_SUBDIRS) {
    const full = path.join(home, sub);
    if (fs.existsSync(full)) roots.push(full);
  }
  return roots;
}

// ── projectsModule ────────────────────────────────────────────────────────────

export const projectsModule: SyncModule = {
  name: "projects",

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const roots = candidateRoots(ctx.home);
    const capped = findGitRepos(roots).slice(0, 100);

    // Discovery only needs to know whether a repo has an origin remote (to decide
    // track vs exclude). That's ONE cheap git call per repo, run in parallel — NOT
    // the full repoInfo (branch + `git status --porcelain` are slow and only needed
    // at capture/status time for the small set of selected repos).
    const hasRemote = await mapLimit(capped, 16, async (repoPath) => {
      const r = await ctx.exec.run("git", ["-C", repoPath, "remote", "get-url", "origin"]);
      return r.code === 0 && r.stdout.trim().length > 0;
    });

    return capped.map((repoPath, i) => ({
      id: repoPath,
      path: repoPath,
      category: "projects",
      recommendation: (hasRemote[i] ? "track" : "exclude") as "track" | "exclude",
      note: hasRemote[i] ? undefined : "no remote — cannot restore from manifest",
    }));
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const ids = sel.modules["projects"] ?? [];
    const doc = loadProjects(ctx.repoDir);

    for (const repoPath of ids) {
      const info = await repoInfo(ctx.exec, repoPath);
      const entry = {
        path: repoPath,
        repo: info.remote,
        envTool: (info.hasMise ? "mise" : "none") as "mise" | "none",
      };

      const existing = doc.projects.findIndex((e) => e.path === repoPath);
      if (existing >= 0) {
        doc.projects[existing] = entry;
      } else {
        doc.projects.push(entry);
      }
    }

    saveProjects(ctx.repoDir, doc);
    return { module: "projects", written: ["roost/projects.yaml"], encrypted: [] };
  },

  async apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult> {
    const applied: string[] = [];
    const skipped: string[] = [];

    const doc = loadProjects(ctx.repoDir);
    const entryMap = new Map(doc.projects.map((e) => [e.path, e]));

    for (const action of plan.actions) {
      const targetPath = action.id;

      if (ctx.dryRun) {
        skipped.push(targetPath);
        continue;
      }

      const entry = entryMap.get(targetPath);
      const exists = fs.existsSync(targetPath);

      if (!exists) {
        if (!entry?.repo) {
          ctx.log.warn(`no remote: ${targetPath}`);
          skipped.push(targetPath);
          continue;
        }
        const cloneResult = await ctx.exec.run("git", ["clone", entry.repo, targetPath]);
        if (cloneResult.code !== 0) {
          ctx.log.warn(`git clone failed (code ${cloneResult.code}): ${targetPath}`);
          skipped.push(targetPath);
          continue;
        }
        applied.push(targetPath);
      } else {
        const info = await repoInfo(ctx.exec, targetPath);
        if (info.remote === null) {
          ctx.log.warn(`skipping repo with no remote: ${targetPath}`);
          skipped.push(targetPath);
          continue;
        }
        if (info.dirty) {
          ctx.log.warn(`skipping dirty repo: ${targetPath}`);
          skipped.push(targetPath);
          continue;
        }
        const pullResult = await ctx.exec.run("git", ["-C", targetPath, "pull", "--ff-only"]);
        if (pullResult.code !== 0) {
          ctx.log.warn(`git pull failed (code ${pullResult.code}): ${targetPath}`);
          skipped.push(targetPath);
          continue;
        }
        applied.push(targetPath);
      }

      // mise install if applicable — failure is non-fatal (warn but don't crash)
      const entryEnvTool = entry?.envTool ?? "none";
      if (entryEnvTool === "mise" && fs.existsSync(path.join(targetPath, ".mise.toml"))) {
        const miseResult = await ctx.exec.run("mise", ["install"], { cwd: targetPath });
        if (miseResult.code !== 0) {
          ctx.log.warn(`mise install failed (code ${miseResult.code}): ${targetPath}`);
        }
      }
    }

    return { module: "projects", applied, backedUp: [], skipped };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const ids = sel.modules["projects"] ?? [];
    const items = ids.map((id) => ({
      id,
      state: (fs.existsSync(id) ? "synced" : "drift") as "synced" | "drift",
      detail: fs.existsSync(id) ? undefined : "untracked",
    }));
    return { module: "projects", items };
  },

  async diff(_ctx: ModuleContext, _sel: Selection): Promise<string> {
    return "";
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const ids = sel.modules["projects"] ?? [];
    if (ids.length === 0) {
      return { module: "projects", applied: [], backedUp: [], skipped: [] };
    }

    const doc = loadProjects(ctx.repoDir);
    const idSet = new Set(ids);
    const removed: string[] = [];

    const remaining = doc.projects.filter((e) => {
      if (idSet.has(e.path)) {
        removed.push(e.path);
        return false;
      }
      return true;
    });

    doc.projects = remaining;
    saveProjects(ctx.repoDir, doc);

    if (removed.length > 0) {
      ctx.log.warn(
        "unmanage: items removed from the working tree but git history is NOT purged. " +
        "If any removed file ever contained secrets, rotate them now and purge git history " +
        "with `git filter-repo` or BFG Repo Cleaner.",
      );
    }

    return { module: "projects", applied: removed, backedUp: [], skipped: [] };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const gitResult = await ctx.exec.run("git", ["--version"]);
    const miseResult = await ctx.exec.run("mise", ["--version"]);
    return [
      {
        name: "git",
        ok: gitResult.code === 0,
        detail: gitResult.code === 0 ? undefined : "git not found",
      },
      {
        name: "mise",
        ok: miseResult.code === 0,
        detail:
          miseResult.code === 0
            ? undefined
            : "mise not found (per-project env will be skipped)",
      },
    ];
  },
};
