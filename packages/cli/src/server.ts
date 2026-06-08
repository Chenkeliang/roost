import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ModuleContext, EnvData } from "@roost/shared";
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
  createChezmoi,
  loadSkillsConfig,
  saveSkillsConfig,
  loadSkillsTargets,
  effectiveSkill,
  loadSkillLinks,
} from "@roost/core";
import type { SkillTarget, SkillsConfig, SkillLink } from "@roost/core";
import { createTtlCache } from "./cache.js";
import { finalizeCapture } from "./captureFlow.js";

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

export interface ServerDeps {
  repoDir: string;
  registry: ModuleRegistry;
  makeCtx: (dryRun: boolean) => ModuleContext;
  webDir?: string;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { repoDir, registry, makeCtx, webDir } = deps;

  const server = Fastify({ logger: false });

  // Short-TTL response cache for the expensive read fan-outs (status/discover).
  // Slow once, then instant for ~25s; wiped on any state-changing mutation below.
  const cache = createTtlCache(25_000);

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
    const result = await exec.run("git", ["-C", repoDir, "push"]);
    const ok = result.code === 0;
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return reply.send({ ok, output });
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

  // ── POST /api/skills/capture ─────────────────────────────────────────────────
  server.post<{ Body: { names?: string[] } }>("/api/skills/capture", async (req, reply) => {
    const names = req.body?.names ?? [];
    const mod = registry.get("skills");
    if (!mod) return reply.status(404).send({ error: "skills module missing" });
    const cs = await mod.capture(makeCtx(false), { modules: { skills: names } });
    cache.invalidateAll();
    return reply.send(cs);
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

  // ── POST /api/skills/config ──────────────────────────────────────────────────
  server.post<{ Body: ReturnType<typeof loadSkillsConfig> }>(
    "/api/skills/config",
    async (req, reply) => {
      saveSkillsConfig(repoDir, req.body);
      cache.invalidateAll();
      return reply.send({ ok: true });
    },
  );

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
