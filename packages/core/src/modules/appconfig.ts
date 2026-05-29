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

export function classifyDomain(domain: string): "track" | "skip" {
  for (const re of SKIP_PATTERNS) {
    if (re.test(domain)) return "skip";
  }
  return "track";
}

// ── helpers ───────────────────────────────────────────────────────────────────

function plistPath(repoDir: string, domain: string): string {
  return path.join(repoDir, "roost/appconfig", `${domain}.plist`);
}

function stripPrefix(id: string): string {
  return id.startsWith("domain:") ? id.slice("domain:".length) : id;
}

// ── appconfigModule ───────────────────────────────────────────────────────────

export const appconfigModule: SyncModule = {
  name: "appconfig",

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const r = await ctx.exec.run("defaults", ["domains"]);
    const raw = r.stdout.trim();
    if (!raw) return [];

    const domains = raw.split(", ").map((d) => d.trim()).filter(Boolean);
    const tracked = domains.filter((d) => classifyDomain(d) === "track");
    const capped = tracked.slice(0, 80);

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

    for (const id of ids) {
      const domain = stripPrefix(id);
      const r = await ctx.exec.run("defaults", ["export", domain, "-"]);
      if (r.code !== 0) {
        throw new Error(`defaults export ${domain} failed (code ${r.code}): ${r.stderr}`);
      }
      const dest = plistPath(ctx.repoDir, domain);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, r.stdout, "utf8");
      written.push(dest);
    }

    return { module: "appconfig", written, encrypted: [] };
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

    for (const id of ids) {
      const domain = stripPrefix(id);
      const storedFile = plistPath(ctx.repoDir, domain);

      if (!fs.existsSync(storedFile)) {
        items.push({ id, state: "drift", detail: "not captured yet" });
        continue;
      }

      const stored = fs.readFileSync(storedFile, "utf8");
      const r = await ctx.exec.run("defaults", ["export", domain, "-"]);
      const current = r.code === 0 ? r.stdout : "";

      items.push({
        id,
        state: stored === current ? "synced" : "drift",
      });
    }

    return { module: "appconfig", items };
  },

  async diff(_ctx: ModuleContext, _sel: Selection): Promise<string> {
    return "";
  },

  async unmanage(_ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    return {
      module: "appconfig",
      applied: [],
      backedUp: [],
      skipped: sel.modules["appconfig"] ?? [],
    };
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
