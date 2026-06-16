// AI tools config module (ADR-0023 + ADR-0024): policy-driven capture of AI
// tool configs, with field-extraction support for mixed config+secret files.
// Mechanics mirror dotfiles (chezmoi-backed); ownership of skills dirs stays
// with the skills module; skip-policy credentials are never backed up (I6).
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SyncModule,
  ModuleContext,
  Selection,
  Candidate,
  ChangeSet,
  DriftReport,
  ApplyPlan,
  ApplyResult,
  Health,
  BlockedItem,
} from "@roost/shared";
import { createChezmoi } from "../adapters/chezmoi.js";
import { loadAiToolsCatalog, aiPathPolicies, aiExtractEntries, type AiExtract } from "../ai-tools-catalog.js";
import { loadSelection } from "../selection.js";
import { ensureChezmoiAgeConfig } from "../chezmoi-config.js";
import { scanPathForSecrets } from "./dotfiles.js";
import { pickFields, mergeFields, writeExtractArtifact, readExtractArtifact } from "../aitools-extract.js";
import { backupFiles } from "../apply.js";

// Shallow glob helper (no external dep). Resolves a single `*` wildcard by
// reading one `fs.readdirSync` level. Returns existing JSON file matches only.
// Bounded to ≤2 levels; errors yield [].
function globShallow(home: string, patterns: string[]): string[] {
  const out: string[] = [];
  for (const pat of patterns) {
    const parts = pat.split("/");
    try {
      if (parts.length === 1) {
        // e.g. ".*rc.json" — file directly in home, may contain *
        const [seg] = parts;
        if (!seg) continue;
        if (!seg.includes("*")) {
          const abs = path.join(home, seg);
          if (abs.endsWith(".json") && fs.existsSync(abs)) out.push(abs);
        } else {
          const suffix = seg.replace(/^\*/, "");
          let entries: fs.Dirent[];
          try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch { continue; }
          for (const e of entries) {
            if (!e.isFile()) continue;
            const abs = path.join(home, e.name);
            if (e.name.endsWith(suffix) && abs.endsWith(".json")) out.push(abs);
          }
        }
      } else if (parts.length === 2) {
        // e.g. ".*/*.json" — dotdir under home / any json file
        const [dirSeg, fileSeg] = parts;
        if (!dirSeg || !fileSeg) continue;
        const dirPrefix = dirSeg.replace(/^\.\*/, "."); // ".*" → starts-with-dot
        const hasDirWild = dirSeg.includes("*");
        const hasFileWild = fileSeg.includes("*");
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (hasDirWild && !e.name.startsWith(dirPrefix)) continue;
          if (!hasDirWild && e.name !== dirSeg) continue;
          if (hasFileWild) {
            const fileSuffix = fileSeg.replace(/^\*/, "");
            let children: fs.Dirent[];
            try { children = fs.readdirSync(path.join(home, e.name), { withFileTypes: true }); } catch { continue; }
            for (const c of children) {
              if (!c.isFile()) continue;
              const abs = path.join(home, e.name, c.name);
              if (c.name.endsWith(fileSuffix) && abs.endsWith(".json")) out.push(abs);
            }
          } else {
            const abs = path.join(home, e.name, fileSeg);
            if (abs.endsWith(".json") && fs.existsSync(abs)) out.push(abs);
          }
        }
      } else if (parts.length === 3) {
        // e.g. ".config/*/config.json" or ".config/*/*.json"
        const [base, , leaf] = parts;
        if (!base || !leaf) continue;
        const hasLeafWild = leaf.includes("*");
        const baseDir = path.join(home, base);
        let dirs: fs.Dirent[];
        try { dirs = fs.readdirSync(baseDir, { withFileTypes: true }); } catch { continue; }
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          if (hasLeafWild) {
            const leafSuffix = leaf.replace(/^\*/, "");
            let children: fs.Dirent[];
            try { children = fs.readdirSync(path.join(baseDir, d.name), { withFileTypes: true }); } catch { continue; }
            for (const c of children) {
              if (!c.isFile()) continue;
              const abs = path.join(baseDir, d.name, c.name);
              if (c.name.endsWith(leafSuffix) && abs.endsWith(".json")) out.push(abs);
            }
          } else {
            const abs = path.join(baseDir, d.name, leaf);
            if (abs.endsWith(".json") && fs.existsSync(abs)) out.push(abs);
          }
        }
      }
    } catch { /* ignore */ }
  }
  return out;
}

// Build a map from absolute path to { extract spec, toolId } from the catalog.
// Used by capture/status/apply to route extract entries away from chezmoi.
function buildExtractMap(repoDir: string, home: string): Map<string, { extract: AiExtract; toolId: string }> {
  const m = new Map<string, { extract: AiExtract; toolId: string }>();
  for (const tool of loadAiToolsCatalog(repoDir))
    for (const p of tool.paths)
      if (p.extract) m.set(path.join(home, p.path), { extract: p.extract, toolId: tool.id });
  return m;
}

export const aitoolsModule: SyncModule = {
  name: "aitools",

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const cat = loadAiToolsCatalog(ctx.repoDir);
    const policies = aiPathPolicies(ctx.repoDir, ctx.home);
    const extracts = aiExtractEntries(ctx.repoDir, ctx.home);
    const dotfilesSel = new Set(loadSelection(ctx.repoDir).modules["dotfiles"] ?? []);
    const out: Candidate[] = [];
    for (const tool of cat) {
      for (const p of tool.paths) {
        const abs = path.join(ctx.home, p.path);
        if (policies.get(abs) === "skip") continue;
        if (!fs.existsSync(abs)) continue;
        if (dotfilesSel.has(abs)) continue; // single owner: already under dotfiles
        // ADR-0024: extract entries must have at least one listed field present in the file.
        if (p.extract) {
          let parsed: unknown;
          try { parsed = JSON.parse(fs.readFileSync(abs, "utf8")); } catch { continue; }
          if (!parsed || typeof parsed !== "object") continue;
          const hasField = p.extract.fields.some((f) => f in (parsed as object));
          if (!hasField) continue;
        }
        const enc = policies.get(abs) === "encrypt";
        const extractTag = p.extract ? " · 提取" : "";
        out.push({ id: abs, path: abs, category: p.kind, recommendation: enc ? "encrypt" : "track", note: `${tool.label} · ${p.kind}${enc ? " · encrypted" : ""}${extractTag}` });
      }
    }

    // MCP auto-detect (ADR-0024): JSON files with a top-level mcpServers block that
    // also carry a secret → suggest extraction. Suggest-only; bounded candidate set.
    const seen = new Set(out.map((c) => c.path));
    const candidates = [
      ...cat.flatMap((tl) => tl.paths.map((p) => path.join(ctx.home, p.path))),  // catalog paths
      ...globShallow(ctx.home, [".config/*/config.json", ".config/*/*.json", ".*rc.json", ".*/*.json"]),
    ];
    for (const abs of new Set(candidates)) {
      if (seen.has(abs) || extracts.has(abs)) continue;              // already handled or already an extract rule
      if (policies.get(abs) === "skip") continue;                    // I6: credential/session files — never backup
      if (dotfilesSel.has(abs)) continue;                            // single owner: already under dotfiles
      if (!abs.endsWith(".json") || !fs.existsSync(abs)) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(fs.readFileSync(abs, "utf8")); } catch { continue; }
      if (!parsed || typeof parsed !== "object" || !("mcpServers" in (parsed as object))) continue;
      if (scanPathForSecrets(abs, { maxBytes: 2 * 1024 * 1024 }).secretFiles.length === 0) continue; // not mixed
      out.push({ id: abs, path: abs, category: "mcp", recommendation: "encrypt", note: `${path.basename(path.dirname(abs))} · MCP (建议提取)`, suggestExtract: ["mcpServers"] });
    }

    return out;
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const ids = sel.modules["aitools"] ?? [];
    const policies = aiPathPolicies(ctx.repoDir, ctx.home);
    const extracts = buildExtractMap(ctx.repoDir, ctx.home);
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const written: string[] = [];
    const encrypted: string[] = [];
    const blocked: string[] = [];
    const blockedDetail: BlockedItem[] = [];
    let ageReady: boolean | null = null;
    for (const id of ids) {
      // ADR-0024: extract entries bypass chezmoi entirely — allowlist-pick fields only.
      const exEntry = extracts.get(id);
      if (exEntry) {
        if (!fs.existsSync(id)) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(fs.readFileSync(id, "utf8")); }
        catch { blocked.push(id); blockedDetail.push({ id, reason: "error", detail: "无法解析 JSON" }); continue; }
        const picked = pickFields(parsed, exEntry.extract.fields);
        if (Object.keys(picked).length === 0) continue; // 无可提取字段
        try { await writeExtractArtifact(ctx.exec, { repoDir: ctx.repoDir, toolId: exEntry.toolId, absPath: id, home: ctx.home, json: picked }); }
        catch (e) { blocked.push(id); blockedDetail.push({ id, reason: "error", detail: e instanceof Error ? e.message : "encrypt failed" }); continue; }
        encrypted.push(id);
        continue;
      }
      const policy = policies.get(id) ?? "plain";
      if (policy === "skip") {
        blocked.push(id);
        blockedDetail.push({ id, reason: "managed", detail: "凭据 / 会话文件 — 永不备份" });
        continue;
      }
      if (!fs.existsSync(id)) continue;
      if (policy === "encrypt") {
        if (ageReady === null) ageReady = (await ensureChezmoiAgeConfig(ctx.exec, { home: ctx.home, repoDir: ctx.repoDir })).ready;
        if (!ageReady) { blocked.push(id); blockedDetail.push({ id, reason: "error", detail: "no age key" }); continue; }
        await chezmoi.add(id, { encrypt: true }); encrypted.push(id); continue;
      }
      // plain — scanner backstop (I6) unchanged
      const scan = scanPathForSecrets(id, { maxBytes: 100 * 1024 * 1024 });
      if (scan.secretFiles.length > 0) { blocked.push(id); blockedDetail.push({ id, reason: "secret", detail: `${scan.secretFiles.length} file(s)` }); continue; }
      await chezmoi.add(id, { encrypt: false }); written.push(id);
    }
    return { module: "aitools", written, encrypted, blocked, blockedDetail };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const ids = sel.modules["aitools"] ?? [];
    if (ids.length === 0) {
      return { module: "aitools", items: [] };
    }
    const extracts = buildExtractMap(ctx.repoDir, ctx.home);

    // ADR-0024: split extract entries from chezmoi-managed entries.
    const extractIds = ids.filter((id) => extracts.has(id));
    const chezmoiIds = ids.filter((id) => !extracts.has(id));

    const extractItems = await Promise.all(extractIds.map(async (id) => {
      const exEntry = extracts.get(id)!;
      let liveFields: Record<string, unknown> = {};
      try { liveFields = pickFields(JSON.parse(fs.readFileSync(id, "utf8")), exEntry.extract.fields); }
      catch { /* unparsable → treat as drift */ }
      const artifact = await readExtractArtifact(ctx.exec, { repoDir: ctx.repoDir, toolId: exEntry.toolId, absPath: id, home: ctx.home });
      const same = artifact !== null && JSON.stringify(liveFields) === JSON.stringify(pickFields(artifact, exEntry.extract.fields));
      return { id, state: same ? "synced" as const : "drift" as const };
    }));

    if (chezmoiIds.length === 0) {
      return { module: "aitools", items: extractItems };
    }

    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    let changedAbs: string[] | null = null;
    try {
      const rels = await chezmoi.changedPaths();
      changedAbs = rels.map((rel) => path.join(ctx.home, rel));
    } catch {
      changedAbs = null;
    }
    let chezmoiItems: { id: string; state: "synced" | "drift" }[];
    if (changedAbs === null) {
      const ok = await chezmoi.verify();
      chezmoiItems = chezmoiIds.map((id) => ({ id, state: ok ? "synced" as const : "drift" as const }));
    } else {
      const changed = changedAbs;
      chezmoiItems = chezmoiIds.map((id) => {
        const isChanged = changed.some((abs) => abs === id || abs.startsWith(id + path.sep));
        return { id, state: isChanged ? "drift" as const : "synced" as const };
      });
    }

    return {
      module: "aitools",
      items: [...extractItems, ...chezmoiItems],
    };
  },

  async apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult> {
    const extracts = buildExtractMap(ctx.repoDir, ctx.home);
    const extractActions = plan.actions.filter((a) => extracts.has(a.target));
    const fileActions = plan.actions.filter((a) => !extracts.has(a.target));

    const applied: string[] = [];
    const backedUp: string[] = [];

    // ADR-0024: field-merge restore for extract entries (token-preserving, backup first).
    for (const a of extractActions) {
      const exEntry = extracts.get(a.target)!;
      const artifact = await readExtractArtifact(ctx.exec, { repoDir: ctx.repoDir, toolId: exEntry.toolId, absPath: a.target, home: ctx.home });
      if (artifact === null) continue; // no key / no artifact → skip
      if (ctx.dryRun) continue;
      let live: Record<string, unknown> = {};
      try { live = JSON.parse(fs.readFileSync(a.target, "utf8")); } catch { live = {}; }
      const backupDir = path.join(ctx.home, ".roost-backups", "aitools", String(Date.now()));
      if (fs.existsSync(a.target)) backedUp.push(...backupFiles([a.target], backupDir));
      const merged = mergeFields(live, pickFields(artifact, exEntry.extract.fields), exEntry.extract.fields);
      fs.writeFileSync(a.target, JSON.stringify(merged, null, 2) + "\n", "utf8");
      applied.push(a.id);
    }

    // Chezmoi apply for non-extract entries.
    if (fileActions.length > 0) {
      const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
      await chezmoi.apply({ dryRun: ctx.dryRun, paths: fileActions.map((a) => a.target) });
      if (!ctx.dryRun) applied.push(...fileActions.map((a) => a.id));
    }

    return {
      module: "aitools",
      applied: ctx.dryRun ? [] : applied,
      backedUp,
      skipped: ctx.dryRun ? plan.actions.map((a) => a.id) : [],
    };
  },

  async diff(ctx: ModuleContext, _sel: Selection): Promise<string> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    return chezmoi.diff();
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const chezmoi = createChezmoi(ctx.exec, { sourceDir: ctx.repoDir });
    const ids = sel.modules["aitools"] ?? [];
    const applied: string[] = [];
    for (const id of ids) {
      await chezmoi.forget(id);
      applied.push(id);
    }
    if (applied.length > 0) {
      ctx.log.warn(
        "unmanage: items removed from the working tree but git history is NOT purged. " +
        "If any removed file ever contained secrets, rotate them now and purge git history " +
        "with `git filter-repo` or BFG Repo Cleaner.",
      );
    }
    return { module: "aitools", applied, backedUp: [], skipped: [] };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const r = await ctx.exec.run("chezmoi", ["--version"]);
    return [
      {
        name: "chezmoi",
        ok: r.code === 0,
        detail: r.code === 0 ? undefined : "chezmoi not found",
        blocking: true,
      },
    ];
  },
};
