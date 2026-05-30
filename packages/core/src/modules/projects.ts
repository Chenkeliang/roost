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

// ── findGitRepos ──────────────────────────────────────────────────────────────

export function findGitRepos(roots: string[], maxDepth = 4): string[] {
  const found = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth < 0) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable — tolerate silently
    }

    let hasGit = false;
    for (const entry of entries) {
      if (entry.name === ".git") {
        hasGit = true;
        break;
      }
    }

    if (hasGit) {
      found.add(dir);
      return; // don't recurse inside a git repo root
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ".git") continue; // never descend into .git dirs
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
    const repoPaths = findGitRepos(roots);
    const capped = repoPaths.slice(0, 100);

    const candidates: Candidate[] = [];
    for (const repoPath of capped) {
      const info = await repoInfo(ctx.exec, repoPath);
      const hasRemote = info.remote !== null;
      const note: string | undefined = !hasRemote
        ? "no remote — cannot restore from manifest"
        : info.dirty
          ? "uncommitted changes"
          : undefined;

      candidates.push({
        id: repoPath,
        path: repoPath,
        category: "projects",
        recommendation: hasRemote ? "track" : "exclude",
        note,
      });
    }

    return candidates;
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
