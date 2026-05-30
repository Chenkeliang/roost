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
  defaultAgeKeyPath,
  recipientFromKey,
  encryptEnvSecret,
  indexAll,
} from "@roost/core";
import { createTtlCache } from "./cache.js";

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
      const changes = await captureAll(registry, makeCtx(false), sel);
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

  // ── static / SPA ─────────────────────────────────────────────────────────────
  if (webDir && fs.existsSync(webDir)) {
    // Dynamic import to avoid touching this code path in tests that skip webDir
    void server.register(import("@fastify/static"), {
      root: webDir,
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
