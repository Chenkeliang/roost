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
} from "@roost/shared";
import { scanForSecrets } from "../secrets/scanner.js";
import { hashContent, loadModuleBaseline } from "../sync-baseline.js";

// ── classifyDomain ────────────────────────────────────────────────────────────

const SKIP_PATTERNS: RegExp[] = [
  /loginwindow/,
  /MobileMeAccounts/,
  /knownnetworks/,
  /com\.apple\.security/,
  /pasteboard/,
  /universalaccessAuthWarning/,
  /account/i,
];

/**
 * Domains known to hold OAuth tokens, API keys, or other credentials.
 * These are skipped by default in discover() so they are never offered for tracking.
 */
export const SENSITIVE_DOMAIN_HINTS: RegExp[] = [
  /openai/i,
  /anthropic/i,
  /github/i,
  /gitlab/i,
  /slack/i,
  /aws/i,
  /gcloud/i,
  /auth/i,
  /token/i,
  /credential/i,
  /1password/i,
  /bitwarden/i,
];

// Generous runaway guard for discover(); far above any real machine's domain
// count (~700), so it never truncates real results — it only bounds pathological
// output. Not a feature limit.
const MAX_DISCOVERED_DOMAINS = 2000;

export function classifyDomain(domain: string): "track" | "skip" {
  for (const re of SKIP_PATTERNS) {
    if (re.test(domain)) return "skip";
  }
  for (const re of SENSITIVE_DOMAIN_HINTS) {
    if (re.test(domain)) return "skip";
  }
  return "track";
}

// ── helpers ───────────────────────────────────────────────────────────────────

function appconfigDir(repoDir: string): string {
  return path.join(repoDir, "roost/appconfig");
}

function plistPath(repoDir: string, domain: string): string {
  return path.join(appconfigDir(repoDir), `${domain}.plist`);
}

function stripPrefix(id: string): string {
  return id.startsWith("domain:") ? id.slice("domain:".length) : id;
}

// ── appconfigModule ───────────────────────────────────────────────────────────

export const appconfigModule: SyncModule = {
  name: "appconfig",

  async index(ctx: ModuleContext): Promise<import("@roost/shared").ModuleIndex> {
    // `defaults` is a macOS system tool — always present, no probe needed.
    let managed = 0;
    const dir = appconfigDir(ctx.repoDir);
    if (fs.existsSync(dir)) {
      managed = fs.readdirSync(dir).filter((f) => f.endsWith(".plist")).length;
    }
    return { available: true, managed };
  },

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const r = await ctx.exec.run("defaults", ["domains"]);
    const raw = r.stdout.trim();
    if (!raw) return [];

    const domains = raw.split(", ").map((d) => d.trim()).filter(Boolean);
    const tracked = domains.filter((d) => classifyDomain(d) === "track");
    // Listing domain NAMES is cheap — the expensive `defaults export` runs per
    // domain only at capture. A real Mac has hundreds of domains (700+), so we
    // don't truncate to a small number; only a generous runaway guard remains.
    const capped = tracked.slice(0, MAX_DISCOVERED_DOMAINS);

    return capped.map((domain) => ({
      id: `domain:${domain}`,
      path: `roost/appconfig/${domain}.plist`,
      category: "appconfig",
      recommendation: "track",
    }));
  },

  async capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet> {
    const ids = sel.modules["appconfig"] ?? [];
    const written: string[] = [];
    const blocked: string[] = [];

    for (const id of ids) {
      const domain = stripPrefix(id);
      const r = await ctx.exec.run("defaults", ["export", domain, "-"]);
      if (r.code !== 0) {
        throw new Error(`defaults export ${domain} failed (code ${r.code}): ${r.stderr}`);
      }
      const findings = scanForSecrets(r.stdout);
      if (findings.length > 0) {
        const ruleNames = findings.map((f) => f.rule).join(", ");
        ctx.log.warn(
          `appconfig capture: domain "${domain}" contains potential secrets (${ruleNames}) — skipped. Rotate any exposed credentials.`,
        );
        blocked.push(domain);
        continue;
      }
      const dest = plistPath(ctx.repoDir, domain);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, r.stdout, "utf8");
      written.push(dest);
    }

    return { module: "appconfig", written, encrypted: [], blocked };
  },

  async apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult> {
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const action of plan.actions) {
      const domain = stripPrefix(action.id);
      const file = plistPath(ctx.repoDir, domain);

      if (ctx.dryRun) {
        skipped.push(action.id);
        continue;
      }

      // Attempt to quit the owning app so cfprefsd flushes its cache before we
      // import. Failure is tolerated — the app may not be running or the domain
      // may not map to an app bundle id. Sandboxed apps (prefs under
      // ~/Library/Containers/<id>/…) may also ignore this quit and still require
      // Full Disk Access; that is a known macOS limitation.
      await ctx.exec.run("osascript", ["-e", `quit app id "${domain}"`]);

      const r = await ctx.exec.run("defaults", ["import", domain, file]);
      if (r.code !== 0) {
        throw new Error(`defaults import ${domain} failed (code ${r.code}): ${r.stderr}`);
      }
      applied.push(action.id);
    }

    return { module: "appconfig", applied, backedUp: [], skipped };
  },

  async status(ctx: ModuleContext, sel: Selection): Promise<DriftReport> {
    const ids = sel.modules["appconfig"] ?? [];
    const items: DriftReport["items"] = [];
    const baseline = loadModuleBaseline(ctx.repoDir, "appconfig");

    for (const id of ids) {
      const domain = stripPrefix(id);
      const storedFile = plistPath(ctx.repoDir, domain);
      const stored = fs.existsSync(storedFile) ? fs.readFileSync(storedFile, "utf8") : null;
      const r = await ctx.exec.run("defaults", ["export", domain, "-"]);
      const current = r.code === 0 ? r.stdout : null;
      const synced = stored !== null && stored === current;
      items.push({
        id,
        state: stored === null ? "drift" : synced ? "synced" : "drift",
        detail: stored === null ? "not captured yet" : undefined,
        localHash: hashContent(current),
        repoHash: hashContent(stored),
        baselineHash: baseline[id] ?? null,
      });
    }

    return { module: "appconfig", items };
  },

  async diff(_ctx: ModuleContext, _sel: Selection): Promise<string> {
    return "";
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const ids = sel.modules["appconfig"] ?? [];
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const id of ids) {
      const domain = stripPrefix(id);
      const file = plistPath(ctx.repoDir, domain);
      if (fs.existsSync(file)) {
        fs.rmSync(file);
        applied.push(id);
      } else {
        skipped.push(id);
      }
    }

    if (applied.length > 0) {
      ctx.log.warn(
        "unmanage: items removed from the working tree but git history is NOT purged. " +
        "If any removed file ever contained secrets, rotate them now and purge git history " +
        "with `git filter-repo` or BFG Repo Cleaner.",
      );
    }

    return { module: "appconfig", applied, backedUp: [], skipped };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const r = await ctx.exec.run("defaults", ["help"]);
    return [
      {
        name: "defaults",
        ok: r.code === 0,
        detail: r.code === 0 ? undefined : "defaults command not found",
      },
    ];
  },
};
