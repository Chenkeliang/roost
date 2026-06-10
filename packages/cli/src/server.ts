import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import type { ModuleContext, EnvData, Exec } from "@roost/shared";
import type { ModuleRegistry } from "@roost/core";
import {
  loadSelection,
  saveSelection,
  addItem,
  removeItem,
  listStateHosts,
  readState,
  captureAll,
  loadAll,
  statusAll,
  syncStateAll,
  preflight,
  itemDiff,
  checkEnvironment,
  brewInstall,
  importFromZip,
  importFromGit,
  stageZip,
  stageGit,
  scanStaged,
  importStaged,
  discoverAll,
  defaultRegistry,
  createExec,
  createLogger,
  createT,
  loadEnvData,
  saveEnvData,
  validateEnvData,
  envShPath,
  defaultAgeKeyPath,
  recipientFromKey,
  encryptEnvSecret,
  ensureAgeKey,
  rotateToNewKey,
  indexAll,
  testRemote,
  parseBrewfile,
  brewfileText,
  packageStates,
  createChezmoi,
  loadSkillsConfig,
  saveSkillsConfig,
  loadSkillsTargets,
  saveSkillsTargets,
  effectiveSkill,
  loadSkillLinks,
  resolveSkillConflict,
  skillsModule,
  materializeSource,
  unadoptSkills,
  loadRoostSettings,
  saveRoostSettings,
  cloneRepo,
} from "@roost/core";
import type { SkillTarget, SkillsConfig, SkillLink } from "@roost/core";
import { createTtlCache } from "./cache.js";
import { finalizeCapture } from "./captureFlow.js";
import { runInit } from "./init.js";
import { ensureGitRepo } from "./gitRepo.js";

// Target ids where a skill is enabled but the on-disk dest is a REAL (non-Roost)
// directory — a genuine conflict the user must resolve before linking.
export function computeConflicts(
  home: string,
  name: string,
  targets: SkillTarget[],
  links: SkillLink[],
  cfg: SkillsConfig,
): string[] {
  const eff = effectiveSkill(cfg, name);
  if (!eff.enabled) return [];
  const conflicts: string[] = [];
  for (const t of targets) {
    if (!eff.targets.includes(t.id)) continue;
    const dest = path.join(home, t.path, name);
    let st: fs.Stats | undefined;
    try {
      st = fs.lstatSync(dest);
    } catch {
      continue; // absent → no conflict
    }
    if (st.isSymbolicLink()) continue; // Roost-style link, not a conflict
    const owned = links.some((l) => l.skill === name && l.target === t.id);
    if (!owned) conflicts.push(t.id);
  }
  return conflicts;
}

// Classify git push/pull failure output so the UI can offer the right next step:
//  - "auth": missing/rejected credential → offer a run-it-in-a-terminal fallback.
//  - "pull-first": the remote advanced since this machine last synced (another
//    machine pushed) → the push was rejected non-fast-forward; pull/merge first
//    (push-safety, ADR-0016 §6.4).
//  - undefined: anything else.
export function classifyGitError(output: string): "auth" | "pull-first" | undefined {
  if (
    /authentication failed|could not read (username|password)|permission denied|terminal prompts disabled|fatal: could not read|invalid username or password|support for password authentication was removed/i.test(
      output,
    )
  ) {
    return "auth";
  }
  if (
    /non-fast-forward|fetch first|updates were rejected|tip of your current branch is behind/i.test(
      output,
    )
  ) {
    return "pull-first";
  }
  return undefined;
}

// Add or update the `origin` remote idempotently.
async function setOrigin(exec: Exec, repoDir: string, url: string): Promise<void> {
  const existing = await exec.run("git", ["-C", repoDir, "remote", "get-url", "origin"]);
  const sub = existing.code === 0 ? "set-url" : "add";
  await exec.run("git", ["-C", repoDir, "remote", sub, "origin", url]);
}

export interface ServerDeps {
  repoDir: string;
  registry: ModuleRegistry;
  makeCtx: (dryRun: boolean) => ModuleContext;
  webDir?: string;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { repoDir, registry, makeCtx, webDir } = deps;

  const server = Fastify({ logger: false });

  // CORS: the Tauri desktop webview (origin tauri://localhost) calls this API
  // cross-origin. Allow Tauri + loopback dev origins ONLY — NOT arbitrary
  // websites, since these endpoints are unauthenticated and mutate local state.
  void server.register(cors, {
    // @fastify/cors defaults methods to GET,HEAD,POST — which silently blocks the
    // env-save PUT (and any future PUT/PATCH/DELETE) from the cross-origin webview.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    origin(origin, cb) {
      // Non-CORS requests (curl, same-origin) send no Origin → allow.
      if (!origin) return cb(null, true);
      const ok =
        origin === "tauri://localhost" ||
        /^https?:\/\/tauri\.localhost$/.test(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      cb(null, ok);
    },
  });

  // Short-TTL response cache for the expensive read fan-outs (status/discover).
  // Slow once, then instant for ~25s; wiped on any state-changing mutation below.
  const cache = createTtlCache(25_000);
  // Staged skill-import sources awaiting a select-then-apply (token → temp dir).
  const importStaging = new Map<string, { dir: string; at: number }>();
  const pruneStaging = () => {
    const now = Date.now();
    for (const [tok, s] of importStaging) {
      if (now - s.at > 10 * 60_000) {
        fs.rmSync(s.dir, { recursive: true, force: true });
        importStaging.delete(tok);
      }
    }
  };

  // ── /api/health ─────────────────────────────────────────────────────────────
  server.get("/api/health", async (_req, reply) => {
    const home = makeCtx(true).home;
    const ageKeyPath = path.join(home, ".config", "sops", "age", "keys.txt");
    const ageKey = fs.existsSync(ageKeyPath);
    return reply.send({ ok: true, name: os.hostname(), repoDir, ageKey });
  });

  // ── /api/modules ─────────────────────────────────────────────────────────────
  server.get("/api/modules", async (_req, reply) => {
    const modules = registry.list().map((m) => m.name);
    return reply.send({ modules });
  });

  // ── /api/selection ───────────────────────────────────────────────────────────
  server.get("/api/selection", async (_req, reply) => {
    try {
      const sel = loadSelection(repoDir);
      return reply.send(sel);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── /api/status ──────────────────────────────────────────────────────────────
  server.get("/api/status", async (_req, reply) => {
    try {
      const reports = await cache.getOrCompute("status", () => {
        const sel = loadSelection(repoDir);
        return statusAll(registry, makeCtx(true), sel);
      });
      return reply.send({ reports });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── /api/sync-state ────────────────────────────────────────────────────────
  // The automation-first review model (ADR-0016): direction + typed exceptions
  // + counts, derived from each module's three-way status.
  server.get("/api/sync-state", async (_req, reply) => {
    try {
      const result = await cache.getOrCompute("sync-state", () => {
        const sel = loadSelection(repoDir);
        return syncStateAll(registry, makeCtx(true), sel);
      });
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/preflight ─────────────────────────────────────────────────────
  // Doctor checks + which failing ones would block a load (ADR-0016 §5).
  server.get("/api/preflight", async (_req, reply) => {
    try {
      const result = await preflight(registry, makeCtx(true));
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/environment ───────────────────────────────────────────────────
  // First-run dependency check for the Setup panel (deps + age key + repo).
  server.get("/api/environment", async (_req, reply) => {
    try {
      const ctx = makeCtx(true);
      const checks = await checkEnvironment(ctx.exec, { home: ctx.home, repoDir });
      return reply.send({ checks });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/environment/install ──────────────────────────────────────────
  // One-click `brew install <formulae>`. A system mutation — the UI gates this
  // behind an explicit user click.
  server.post<{ Body: { formulae?: string[] } }>("/api/environment/install", async (req, reply) => {
    const formulae = (req.body?.formulae ?? []).filter((s) => typeof s === "string" && /^[\w@.+-]+$/.test(s));
    if (formulae.length === 0) {
      return reply.status(400).send({ error: "formulae (array of brew formula names) is required" });
    }
    try {
      const result = await brewInstall(makeCtx(false).exec, formulae);
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/item-diff ─────────────────────────────────────────────────────
  // Per-item local-vs-repo content for the two-column review (ADR-0016 §6.6).
  server.get<{ Querystring: { module?: string; id?: string } }>(
    "/api/item-diff",
    async (req, reply) => {
      const mod = req.query.module;
      const id = req.query.id;
      if (!mod || !id) {
        return reply.status(400).send({ error: "module and id are required" });
      }
      try {
        const ctx = makeCtx(true);
        const result = await itemDiff({ repoDir, home: ctx.home, exec: ctx.exec }, mod, id);
        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ── POST /api/resolve ──────────────────────────────────────────────────────
  // Resolve one reviewed item (ADR-0016 §6.2). "take-repo" applies just that
  // item (backing up first, recording baseline — via loadAll on a sub-selection);
  // "keep-local" is a deliberate no-op (the item stays until pushed/changed).
  interface ResolveBody {
    module: string;
    id: string;
    action: "take-repo" | "keep-local";
  }
  server.post<{ Body: ResolveBody }>("/api/resolve", async (req, reply) => {
    const body = req.body ?? ({} as ResolveBody);
    const { module: mod, id, action } = body;
    if (!mod || !id || !action) {
      return reply.status(400).send({ error: "module, id and action are required" });
    }
    cache.invalidateAll();
    if (action === "keep-local") {
      return reply.send({ ok: true, action, applied: [] as string[] });
    }
    if (action === "take-repo") {
      try {
        // Same hard-gate as load: refuse to apply when a required tool is missing,
        // instead of failing mid-apply with a raw error.
        const pf = await preflight(registry, makeCtx(true));
        if (!pf.ok) {
          return reply.send({ ok: false, action, blocked: true, blockers: pf.blockers, applied: [] });
        }
        const ctx = makeCtx(false);
        const backupDir = path.join(ctx.home, ".roost-backups", "resolve");
        const subSel = { modules: { [mod]: [id] } };
        const results = await loadAll(registry, ctx, subSel, { dryRun: false, backupDir });
        const r = results.find((x) => x.module === mod);
        return reply.send({ ok: true, action, applied: r?.applied ?? [], backedUp: r?.backedUp ?? [] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    }
    return reply.status(400).send({ error: `unknown action: ${String(action)}` });
  });

  // ── /api/index ───────────────────────────────────────────────────────────────
  server.get("/api/index", async (_req, reply) => {
    try {
      const index = await cache.getOrCompute("index", () => indexAll(registry, makeCtx(true)));
      return reply.send({ index });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/projects/test ──────────────────────────────────────────────────
  server.post<{ Body: { remote?: string } }>("/api/projects/test", async (req, reply) => {
    const remote = req.body?.remote;
    if (typeof remote !== "string" || remote.length === 0) {
      return reply.status(400).send({ error: "remote is required" });
    }
    const result = await testRemote(makeCtx(true).exec, remote);
    return reply.send(result);
  });

  // ── GET /api/packages/brewfile ───────────────────────────────────────────────
  // Content-first: parse the repo Brewfile (cheap). available = `brew --version`
  // exit 0; never runs brew bundle.
  server.get("/api/packages/brewfile", async (_req, reply) => {
    try {
      const result = await cache.getOrCompute("packages:brewfile", async () => {
        const brew = await makeCtx(true).exec.run("brew", ["--version"]);
        const file = path.join(repoDir, "roost", "Brewfile");
        const exists = fs.existsSync(file);
        const entries = exists
          ? parseBrewfile(fs.readFileSync(file, "utf8"))
          : { taps: [], formulae: [], casks: [], mas: [] };
        return { available: brew.code === 0, exists, entries };
      });
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/packages/install ───────────────────────────────────────────────
  // Selective install (ADR-0009 Phase 2): write a temp Brewfile from the chosen
  // per-package ids and `brew bundle` only those — the follower picks a subset.
  server.post<{ Body: { ids?: string[] } }>("/api/packages/install", async (req, reply) => {
    try {
      const ids = (req.body?.ids ?? []).filter((s) => typeof s === "string" && s.includes(":"));
      if (ids.length === 0) return reply.status(400).send({ error: "no packages selected to install" });
      const ctx = makeCtx(false);
      const tmp = path.join(os.tmpdir(), `roost-install-${Date.now()}.Brewfile`);
      fs.writeFileSync(tmp, `${brewfileText(ids)}\n`, "utf8");
      try {
        const r = await ctx.exec.run("brew", ["bundle", "--file", tmp]);
        return reply.send({ ok: r.code === 0, installed: ids.length, output: r.code === 0 ? r.stdout : r.stderr });
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── GET /api/packages/states ─────────────────────────────────────────────────
  // Per-package state (installed/outdated/missing) for the selected ids, by cross-
  // referencing `brew list` + `brew outdated`. Skips the legacy "Brewfile" sentinel.
  server.get("/api/packages/states", async (_req, reply) => {
    try {
      const states = await cache.getOrCompute("packages:states", () => {
        const sel = loadSelection(repoDir);
        const ids = (sel.modules["packages"] ?? []).filter((id) => id !== "Brewfile" && id.includes(":"));
        return packageStates(makeCtx(true), ids);
      });
      return reply.send({ states });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/dotfiles ────────────────────────────────────────────────────────
  // Content-first: list chezmoi-managed paths (cheap). available = `chezmoi
  // --version` exit 0; graceful [] if chezmoi absent or the source dir is empty.
  server.get("/api/dotfiles", async (_req, reply) => {
    try {
      const result = await cache.getOrCompute("dotfiles:managed", async () => {
        const exec = makeCtx(true).exec;
        const ver = await exec.run("chezmoi", ["--version"]);
        const available = ver.code === 0;
        let managed: string[] = [];
        try {
          managed = await createChezmoi(exec, { sourceDir: repoDir }).managed();
        } catch {
          managed = [];
        }
        return { available, managed };
      });
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/appconfig ─────────────────────────────────────────────────────────
  // Content-first: list managed domains = basenames (sans .plist) of files under
  // roost/appconfig/. `defaults` is a macOS system tool, so available is always
  // true — no probe needed. [] if the dir is absent.
  server.get("/api/appconfig", async (_req, reply) => {
    try {
      const result = await cache.getOrCompute("appconfig:managed", async () => {
        const dir = path.join(repoDir, "roost/appconfig");
        let managed: string[] = [];
        if (fs.existsSync(dir)) {
          managed = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".plist"))
            .map((f) => f.slice(0, -".plist".length));
        }
        return { available: true, managed };
      });
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── /api/machines ────────────────────────────────────────────────────────────
  server.get("/api/machines", async (_req, reply) => {
    try {
      const hosts = listStateHosts(repoDir);
      const states: Record<string, unknown> = {};
      for (const host of hosts) {
        states[host] = readState(repoDir, host);
      }
      return reply.send({ hosts, states });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/capture ────────────────────────────────────────────────────────
  server.post("/api/capture", async (_req, reply) => {
    try {
      cache.invalidateAll();
      const sel = loadSelection(repoDir);
      const ctx = makeCtx(false);
      const changes = await captureAll(registry, ctx, sel);
      await finalizeCapture(ctx.exec, repoDir, ctx.home);
      return reply.send({ changes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/load ───────────────────────────────────────────────────────────
  interface LoadBody { apply?: boolean }

  server.post<{ Body: LoadBody }>("/api/load", async (req, reply) => {
    try {
      cache.invalidateAll();
      const apply = req.body?.apply === true;
      const dryRun = !apply;
      // Preflight hard-gate (ADR-0016 §5): a real apply is refused if a required
      // tool is missing. Dry-run still previews so the user can see the plan.
      if (apply) {
        const pf = await preflight(registry, makeCtx(true));
        if (!pf.ok) {
          return reply.send({ results: [], blocked: true, blockers: pf.blockers });
        }
      }
      const backupDir = path.join(os.homedir(), ".roost-backups", "load");
      const sel = loadSelection(repoDir);
      const results = await loadAll(registry, makeCtx(dryRun), sel, { dryRun, backupDir });
      return reply.send({ results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/selection/add ──────────────────────────────────────────────────
  interface SelectionMutateBody { module: string; id: string }

  server.post<{ Body: SelectionMutateBody }>("/api/selection/add", async (req, reply) => {
    try {
      cache.invalidateAll();
      const { module: mod, id } = req.body;
      let doc = loadSelection(repoDir);
      doc = addItem(doc, mod, id);
      saveSelection(repoDir, doc);
      return reply.send({ schemaVersion: doc.schemaVersion, modules: doc.modules });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/selection/remove ───────────────────────────────────────────────
  server.post<{ Body: SelectionMutateBody }>("/api/selection/remove", async (req, reply) => {
    try {
      cache.invalidateAll();
      const { module: mod, id } = req.body;
      let doc = loadSelection(repoDir);
      doc = removeItem(doc, mod, id);
      saveSelection(repoDir, doc);

      // Also clean the item out of the repo (forget from chezmoi / remove stored file)
      const owningModule = registry.get(mod);
      let unmanaged: { module: string; applied: string[] } | undefined;
      if (owningModule) {
        const singleItemSel = { modules: { [mod]: [id] } };
        const result = await owningModule.unmanage(makeCtx(false), singleItemSel);
        unmanaged = { module: result.module, applied: result.applied };
      }

      return reply.send({ schemaVersion: doc.schemaVersion, modules: doc.modules, unmanaged });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/discover ────────────────────────────────────────────────────────
  server.get("/api/discover", async (req, reply) => {
    try {
      const moduleName = (req.query as { module?: string } | undefined)?.module;
      if (moduleName) {
        const mod = registry.list().find((m) => m.name === moduleName);
        if (!mod) return reply.status(404).send({ error: `unknown module: ${moduleName}` });
        const candidates = await cache.getOrCompute(`discover:${moduleName}`, async () => ({
          [moduleName]: await mod.discover(makeCtx(true)),
        }));
        return reply.send({ candidates });
      }
      const candidates = await cache.getOrCompute("discover", () =>
        discoverAll(registry, makeCtx(true)),
      );
      return reply.send({ candidates });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/git/status ──────────────────────────────────────────────────────
  server.get("/api/git/status", async (_req, reply) => {
    const exec = makeCtx(true).exec;
    const notRepo = { isRepo: false, remote: null, branch: null, ahead: 0, behind: 0, clean: true };

    const isRepoResult = await exec.run("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"]);
    if (isRepoResult.code !== 0) {
      return reply.send(notRepo);
    }

    const remoteResult = await exec.run("git", ["-C", repoDir, "remote", "get-url", "origin"]);
    const remote = remoteResult.code === 0 ? remoteResult.stdout.trim() || null : null;

    const branchResult = await exec.run("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;

    const abResult = await exec.run("git", ["-C", repoDir, "rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    let ahead = 0;
    let behind = 0;
    if (abResult.code === 0) {
      const parts = abResult.stdout.trim().split("\t");
      behind = parseInt(parts[0] ?? "0", 10) || 0;
      ahead = parseInt(parts[1] ?? "0", 10) || 0;
    }

    const cleanResult = await exec.run("git", ["-C", repoDir, "status", "--porcelain"]);
    const clean = cleanResult.code === 0 && cleanResult.stdout.trim() === "";

    return reply.send({ isRepo: true, remote, branch, ahead, behind, clean });
  });

  // ── POST /api/git/push ────────────────────────────────────────────────────────
  server.post("/api/git/push", async (_req, reply) => {
    cache.invalidateAll();
    const exec = makeCtx(false).exec;
    // Fail fast instead of hanging on an interactive credential prompt the web
    // UI can't answer; a missing credential surfaces as a classifiable error.
    const result = await exec.run("git", ["-C", repoDir, "push"], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const ok = result.code === 0;
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const hint = ok ? undefined : classifyGitError(output);
    return reply.send({ ok, output, hint });
  });

  // ── POST /api/git/pull ────────────────────────────────────────────────────────
  server.post("/api/git/pull", async (_req, reply) => {
    cache.invalidateAll();
    const exec = makeCtx(false).exec;
    const result = await exec.run("git", ["-C", repoDir, "pull", "--ff-only"]);
    const ok = result.code === 0;
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return reply.send({ ok, output });
  });

  // ── POST /api/init ────────────────────────────────────────────────────────────
  // Scaffold a fresh config repo (idempotent) + git init + first commit; optionally
  // wire an origin remote. Delegates to existing helpers; no shell-out from the UI.
  server.post<{ Body: { remoteUrl?: string } }>("/api/init", async (req, reply) => {
    try {
      cache.invalidateAll();
      const exec = makeCtx(false).exec;
      const { created } = await runInit({ repoDir });
      await ensureGitRepo(exec, repoDir);
      const remoteUrl = req.body?.remoteUrl?.trim();
      if (remoteUrl) await setOrigin(exec, repoDir, remoteUrl);
      const r = await exec.run("git", ["-C", repoDir, "remote", "get-url", "origin"]);
      const remote = r.code === 0 ? r.stdout.trim() || null : null;
      return reply.send({ created, isRepo: true, remote });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── POST /api/clone ───────────────────────────────────────────────────────────
  // Clone an existing config repo into the (boot-resolved) repoDir — the second-machine path.
  server.post<{ Body: { url?: string } }>("/api/clone", async (req, reply) => {
    cache.invalidateAll();
    const url = req.body?.url?.trim();
    if (!url) return reply.status(400).send({ error: "url is required" });
    const exec = makeCtx(false).exec;
    const result = await cloneRepo(exec, url, repoDir);
    return reply.send(result);
  });

  // ── POST /api/git/remote ──────────────────────────────────────────────────────
  server.post<{ Body: { url?: string } }>("/api/git/remote", async (req, reply) => {
    cache.invalidateAll();
    const url = req.body?.url?.trim();
    if (!url) return reply.status(400).send({ error: "url is required" });
    const exec = makeCtx(false).exec;
    await setOrigin(exec, repoDir, url);
    return reply.send({ ok: true, remote: url });
  });

  // ── GET /api/timeline ────────────────────────────────────────────────────────
  server.get("/api/timeline", async (_req, reply) => {
    try {
      const exec = makeCtx(true).exec;
      const result = await exec.run("git", [
        "-C", repoDir,
        "log",
        "--pretty=format:%H\x1f%s\x1f%cI",
        "-n", "50",
      ]);
      if (result.code !== 0) {
        return reply.send({ entries: [] });
      }
      const entries = result.stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [sha, subject, date] = line.split("\x1f");
          return { sha: sha ?? "", subject: subject ?? "", date: date ?? "" };
        });
      return reply.send({ entries });
    } catch {
      return reply.send({ entries: [] });
    }
  });

  // ── GET /api/diff ─────────────────────────────────────────────────────────────
  server.get("/api/diff", async (_req, reply) => {
    try {
      const sel = loadSelection(repoDir);
      const diffs: { module: string; text: string }[] = [];
      for (const mod of registry.list()) {
        const text = await mod.diff(makeCtx(true), sel);
        diffs.push({ module: mod.name, text });
      }
      return reply.send({ diffs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/env ──────────────────────────────────────────────────────────────
  // Returns EnvData with secret env values redacted to '' (never echo plaintext).
  server.get("/api/env", async (_req, reply) => {
    try {
      const data = loadEnvData(repoDir);
      const redacted: EnvData = {
        ...data,
        env: data.env.map((e) => (e.secret ? { ...e, value: "" } : e)),
      };
      return reply.send(redacted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── PUT /api/env ──────────────────────────────────────────────────────────────
  // Accepts a full EnvData. For each secret env item carrying a non-empty value,
  // treats it as NEW plaintext to encrypt (never echoed back); persists env.yaml
  // with secret values blanked.
  server.put<{ Body: unknown }>("/api/env", async (req, reply) => {
    try {
      cache.invalidateAll();
      let incoming: EnvData;
      try {
        incoming = validateEnvData(req.body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }

      const ctx = makeCtx(false);
      const recipient = await recipientFromKey(ctx.exec, defaultAgeKeyPath(ctx.home));

      const persisted: EnvData = {
        schemaVersion: incoming.schemaVersion,
        aliases: incoming.aliases,
        path: incoming.path,
        functions: incoming.functions,
        env: [],
      };

      for (const e of incoming.env) {
        if (e.secret && e.value.length > 0) {
          if (recipient === null) {
            return reply
              .status(400)
              .send({ error: `cannot encrypt secret "${e.name}": no age key available` });
          }
          await encryptEnvSecret(ctx.exec, {
            repoDir,
            name: e.name,
            plaintext: e.value,
            recipient,
          });
        }
        persisted.env.push(e.secret ? { ...e, value: "" } : e);
      }

      saveEnvData(repoDir, persisted);

      // Echo back with secrets redacted (never return plaintext).
      return reply.send(persisted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Age key lifecycle ────────────────────────────────────────────────────────
  // The age private key is the recovery material for ALL encrypted data — it is
  // never returned by the API; only its public recipient is.
  server.get("/api/key", async (_req, reply) => {
    try {
      const ctx = makeCtx(true);
      const keyPath = defaultAgeKeyPath(ctx.home);
      const recipient = await recipientFromKey(ctx.exec, keyPath);
      let encryptedFiles = 0;
      try {
        encryptedFiles = fs.globSync("**/*.age", { cwd: repoDir }).length;
      } catch {
        /* glob unsupported / repo missing — report 0 */
      }
      return reply.send({ exists: recipient !== null, recipient, keyPath, encryptedFiles });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.post("/api/key/generate", async (_req, reply) => {
    try {
      cache.invalidateAll();
      const ctx = makeCtx(false);
      const keyPath = defaultAgeKeyPath(ctx.home);
      const res = await ensureAgeKey(ctx.exec, { keyPath });
      const recipient = await recipientFromKey(ctx.exec, keyPath);
      return reply.send({ created: res.created, source: res.source, recipient, keyPath });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Replace the key with a fresh one and re-encrypt every existing .age to it.
  // Aborts the swap (keeps the old key) if any file fails — never orphans data.
  server.post("/api/key/rotate", async (_req, reply) => {
    try {
      cache.invalidateAll();
      const ctx = makeCtx(false);
      const keyPath = defaultAgeKeyPath(ctx.home);
      if (!fs.existsSync(keyPath)) {
        return reply.status(400).send({ error: "no existing key to rotate — generate one first" });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const result = await rotateToNewKey(ctx.exec, {
        repoDir,
        keyPath,
        newKeyTmpPath: path.join(os.tmpdir(), `roost-newkey-${stamp}`),
        backupPath: `${keyPath}.bak-${stamp}`,
      });
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── POST /api/env/apply ──────────────────────────────────────────────────────
  // Regenerate the live ~/.config/roost/env.sh from the saved env.yaml (secrets
  // resolved) so dashboard edits actually take effect on THIS machine. A web app
  // cannot reach into an already-open shell, so we also return a one-paste
  // command that resets the CURRENT shell (unalias all managed alias names, then
  // re-source) — new shells pick it up automatically.
  server.post("/api/env/apply", async (_req, reply) => {
    try {
      cache.invalidateAll();
      const env = registry.get("env");
      if (!env) return reply.status(500).send({ error: "env module not registered" });
      const ctx = makeCtx(false);
      const result = await env.apply(ctx, { module: "env", actions: [] });
      const data = loadEnvData(repoDir);
      const livePath = envShPath(ctx.home);
      const aliasNames = data.aliases.map((a) => a.name);
      const reload =
        aliasNames.length > 0
          ? `unalias ${aliasNames.join(" ")} 2>/dev/null; source ${livePath}`
          : `source ${livePath}`;
      return reply.send({ applied: result.applied, reload });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── /api/skills ──────────────────────────────────────────────────────────────
  server.get("/api/skills", async (_req, reply) => {
    try {
      const cfg = loadSkillsConfig(repoDir);
      const targets = loadSkillsTargets(repoDir);
      const dir = path.join(repoDir, "skills");
      let managed: string[] = [];
      try {
        managed = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        managed = [];
      }
      const links = loadSkillLinks(repoDir);
      const home = makeCtx(true).home;
      const skills = managed.map((name) => ({
        name,
        effective: effectiveSkill(cfg, name),
        links: links.filter((l) => l.skill === name),
        conflicts: computeConflicts(home, name, targets, links, cfg),
      }));
      return reply.send({ config: cfg, targets, skills });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/skills/discover ─────────────────────────────────────────────────
  server.get("/api/skills/discover", async (_req, reply) => {
    const mod = registry.get("skills");
    if (!mod) return reply.status(404).send({ error: "skills module missing" });
    return reply.send({ candidates: await mod.discover(makeCtx(true)) });
  });

  // ── POST /api/skills/capture (adopt: capture + optional decouple) ─────────────
  server.post<{ Body: { names?: string[]; decouple?: boolean; from?: Record<string, string> } }>(
    "/api/skills/capture",
    async (req, reply) => {
      const names = req.body?.names ?? [];
      const decouple = req.body?.decouple !== false; // default true
      const from = req.body?.from;
      const cs = await skillsModule.capture(makeCtx(false), { modules: { skills: names } }, { from });
      const materialized = decouple ? materializeSource(makeCtx(false), cs.written) : [];
      cache.invalidateAll();
      return reply.send({ ...cs, materialized });
    },
  );

  // ── POST /api/skills/unadopt (forget, keep local files) ──────────────────────
  server.post<{ Body: { names?: string[] } }>("/api/skills/unadopt", async (req, reply) => {
    const removed = unadoptSkills(makeCtx(false), req.body?.names ?? []);
    cache.invalidateAll();
    return reply.send({ ok: true, removed });
  });

  // ── POST /api/skills/import-git ──────────────────────────────────────────────
  // Clone a remote repo (single skill or a skills/ pack) and ingest it — gated by
  // the same secret/size scan as capture. Files only; never executed.
  server.post<{ Body: { url?: string } }>("/api/skills/import-git", async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url || !/^(https?:\/\/|git@)/.test(url)) {
      return reply.status(400).send({ error: "a git/https URL is required" });
    }
    try {
      const result = await importFromGit(makeCtx(false), url);
      cache.invalidateAll();
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── POST /api/skills/import-zip ──────────────────────────────────────────────
  // Ingest a .zip uploaded as base64 (drag-drop or file picker in the web UI).
  server.post<{ Body: { filename?: string; dataBase64?: string } }>(
    "/api/skills/import-zip",
    { bodyLimit: 64 * 1024 * 1024 },
    async (req, reply) => {
      const { filename, dataBase64 } = req.body ?? {};
      if (!dataBase64) return reply.status(400).send({ error: "dataBase64 (zip bytes) is required" });
      const safe = (filename && /\.zip$/i.test(filename) ? filename : "import.zip").replace(/[^\w.-]/g, "_");
      const tmpZip = path.join(os.tmpdir(), `roost-skill-${process.pid}-${safe}`);
      try {
        fs.writeFileSync(tmpZip, Buffer.from(dataBase64, "base64"));
        const result = await importFromZip(makeCtx(false), tmpZip);
        cache.invalidateAll();
        return reply.send(result);
      } catch (err) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        fs.rmSync(tmpZip, { force: true });
      }
    },
  );

  // ── POST /api/skills/import-scan ─────────────────────────────────────────────
  // Step 1 of select-import: stage a zip/git source, list the skills found (with
  // a pre-flag for ones the secret/size gate would block). Returns a token the
  // apply step references; the staged dir is kept until apply or TTL cleanup.
  server.post<{ Body: { url?: string; filename?: string; dataBase64?: string } }>(
    "/api/skills/import-scan",
    { bodyLimit: 64 * 1024 * 1024 },
    async (req, reply) => {
      pruneStaging();
      const { url, filename, dataBase64 } = req.body ?? {};
      try {
        let dir: string;
        let fallback: string;
        if (url && url.trim()) {
          if (!/^(https?:\/\/|git@)/.test(url.trim())) return reply.status(400).send({ error: "a git/https URL is required" });
          dir = await stageGit(makeCtx(false), url.trim());
          fallback = url.trim().replace(/\.git$/i, "").split("/").pop() || "skill";
        } else if (dataBase64) {
          const safe = (filename && /\.zip$/i.test(filename) ? filename : "import.zip").replace(/[^\w.-]/g, "_");
          const tmpZip = path.join(os.tmpdir(), `roost-skill-${process.pid}-${Date.now()}-${safe}`);
          fs.writeFileSync(tmpZip, Buffer.from(dataBase64, "base64"));
          try {
            dir = await stageZip(makeCtx(false), tmpZip);
          } finally {
            fs.rmSync(tmpZip, { force: true });
          }
          fallback = safe.replace(/\.zip$/i, "");
        } else {
          return reply.status(400).send({ error: "url or dataBase64 is required" });
        }
        const skills = scanStaged(dir, fallback);
        const token = crypto.randomUUID();
        importStaging.set(token, { dir, at: Date.now() });
        return reply.send({ token, skills });
      } catch (err) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ── POST /api/skills/import-apply ────────────────────────────────────────────
  // Step 2: ingest the selected skills from a previously-scanned staging dir.
  server.post<{ Body: { token?: string; names?: string[] } }>("/api/skills/import-apply", async (req, reply) => {
    const { token, names } = req.body ?? {};
    const staged = token ? importStaging.get(token) : undefined;
    if (!token || !staged) return reply.status(400).send({ error: "unknown or expired import token — scan again" });
    try {
      const result = importStaged(makeCtx(false), staged.dir, { names: Array.isArray(names) ? names : undefined });
      cache.invalidateAll();
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      fs.rmSync(staged.dir, { recursive: true, force: true });
      importStaging.delete(token);
    }
  });

  // ── POST /api/skills/toggle ──────────────────────────────────────────────────
  server.post<{ Body: { skill?: string; target?: string; enabled?: boolean } }>(
    "/api/skills/toggle",
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.skill || typeof b.enabled !== "boolean") {
        return reply.status(400).send({ error: "skill + enabled required" });
      }
      const cfg = loadSkillsConfig(repoDir);
      const e = cfg.skills[b.skill] ?? {};
      if (b.target) {
        const set = new Set(e.targets ?? cfg.targets);
        if (b.enabled) set.add(b.target);
        else set.delete(b.target);
        e.targets = [...set];
      } else {
        e.enabled = b.enabled;
      }
      cfg.skills[b.skill] = e;
      saveSkillsConfig(repoDir, cfg);
      cache.invalidateAll();
      return reply.send({ ok: true, config: cfg });
    },
  );

  // ── POST /api/skills/link ────────────────────────────────────────────────────
  // Reconcile links/copies on this machine; optionally update method/targets first.
  server.post<{ Body: { copy?: boolean; targets?: string[] } }>(
    "/api/skills/link",
    async (req, reply) => {
      const b = req.body ?? {};
      if (b.copy || b.targets) {
        const cfg = loadSkillsConfig(repoDir);
        if (b.copy) cfg.method = "copy";
        if (b.targets) cfg.targets = b.targets;
        saveSkillsConfig(repoDir, cfg);
      }
      const mod = registry.get("skills");
      if (!mod) return reply.status(404).send({ error: "skills module missing" });
      const res = await mod.apply(makeCtx(false), { module: "skills", actions: [] });
      cache.invalidateAll();
      return reply.send(res);
    },
  );

  // ── POST /api/skills/resolve ─────────────────────────────────────────────────
  // Back up a real (non-Roost) dir occupying a target, then link/copy ours in.
  server.post<{ Body: { skill?: string; target?: string } }>(
    "/api/skills/resolve",
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.skill || !b.target) return reply.status(400).send({ error: "skill + target required" });
      try {
        const { backedUp, linked } = await resolveSkillConflict(makeCtx(false), b.skill, b.target);
        cache.invalidateAll();
        return reply.send({ ok: true, backedUp, linked });
      } catch (e) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    },
  );

  // ── POST /api/skills/config ──────────────────────────────────────────────────
  server.post<{ Body: ReturnType<typeof loadSkillsConfig> }>(
    "/api/skills/config",
    async (req, reply) => {
      saveSkillsConfig(repoDir, req.body);
      cache.invalidateAll();
      return reply.send({ ok: true });
    },
  );

  // ── POST /api/skills/catalog (custom targets) ────────────────────────────────
  server.post<{ Body: { targets?: SkillTarget[] } }>("/api/skills/catalog", async (req, reply) => {
    const targets = req.body?.targets ?? [];
    saveSkillsTargets(repoDir, targets);
    cache.invalidateAll();
    return reply.send({ ok: true });
  });

  // ── /api/settings ─────────────────────────────────────────────────────────────
  server.get("/api/settings", async (_req, reply) => reply.send(loadRoostSettings(repoDir)));
  server.post("/api/settings", async (req, reply) => {
    const b = (req.body ?? {}) as { maxCaptureMB?: unknown };
    const n = typeof b.maxCaptureMB === "number" && b.maxCaptureMB > 0 ? b.maxCaptureMB : 100;
    saveRoostSettings(repoDir, { maxCaptureMB: n });
    cache.invalidateAll();
    return reply.send({ ok: true, maxCaptureMB: n });
  });

  // ── static / SPA ─────────────────────────────────────────────────────────────
  if (webDir && fs.existsSync(webDir)) {
    // @fastify/static requires an absolute root; resolve a relative --web path
    // (the docs show `--web packages/web/dist`) against the current directory.
    const webRoot = path.resolve(webDir);
    // Dynamic import to avoid touching this code path in tests that skip webDir
    void server.register(import("@fastify/static"), {
      root: webRoot,
      prefix: "/",
    });
  } else {
    server.get("/", async (_req, reply) => {
      return reply.send({
        name: "roost",
        hint: "build packages/web and pass webDir, or use the CLI",
      });
    });
  }

  return server;
}

// ── runServe ──────────────────────────────────────────────────────────────────

export async function runServe(opts: {
  repoDir: string;
  port?: number;
  webDir?: string;
}): Promise<void> {
  const { repoDir, port = 4317, webDir } = opts;
  const home = os.homedir();

  const makeCtx = (dryRun: boolean): ModuleContext => ({
    repoDir,
    home,
    profile: "base",
    dryRun,
    exec: createExec(),
    log: createLogger(),
    t: createT(process.env["ROOST_LOCALE"] ?? "en"),
  });

  const registry = defaultRegistry();
  const server = buildServer({ repoDir, registry, makeCtx, webDir });

  await server.listen({ host: "127.0.0.1", port });
  const url = `http://127.0.0.1:${port}`;
  console.log(`roost serve listening on ${url}`);
}
