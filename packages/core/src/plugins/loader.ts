/**
 * Plugin loader for roost-module-* packages.
 *
 * Security note: plugins are loaded via dynamic import but only get a
 * SyncModule slot in the registry. They receive no special access to core
 * internals — they are handed a ModuleContext at runtime (the same ctx every
 * built-in module receives) and cannot bypass core validation or other
 * modules.
 */

import type { SyncModule } from "@roost/shared";
import type { ModuleRegistry } from "../registry.js";

export const ROOST_API_VERSION = 1;

export interface PluginManifest {
  name: string;
  version: string;
  roostApi: number;
}

export interface RoostPlugin {
  manifest: PluginManifest;
  createModule: () => SyncModule;
}

export interface LoadResult {
  loaded: string[];
  rejected: { spec: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Validate an unknown value as a RoostPlugin. Throws with a descriptive
 * reason if the shape is invalid or the api version does not match.
 */
export function validatePlugin(x: unknown): RoostPlugin {
  if (!isRecord(x)) {
    throw new Error("plugin must be a non-null object");
  }

  // Validate manifest
  if (!("manifest" in x) || !isRecord(x["manifest"])) {
    throw new Error("plugin is missing a valid manifest object");
  }
  const manifest = x["manifest"];

  if (typeof manifest["name"] !== "string" || manifest["name"].length === 0) {
    throw new Error("plugin manifest.name must be a non-empty string");
  }
  if (typeof manifest["version"] !== "string" || manifest["version"].length === 0) {
    throw new Error("plugin manifest.version must be a non-empty string");
  }
  if (typeof manifest["roostApi"] !== "number") {
    throw new Error("plugin manifest.roostApi must be a number");
  }
  if (manifest["roostApi"] !== ROOST_API_VERSION) {
    throw new Error(
      `plugin api version mismatch: expected ${ROOST_API_VERSION}, got ${manifest["roostApi"]}`,
    );
  }

  // Validate createModule
  if (!("createModule" in x) || typeof x["createModule"] !== "function") {
    throw new Error("plugin is missing createModule (must be a function)");
  }

  return {
    manifest: {
      name: manifest["name"],
      version: manifest["version"],
      roostApi: manifest["roostApi"],
    },
    createModule: x["createModule"] as () => SyncModule,
  };
}

// ---------------------------------------------------------------------------
// Trust gate options
// ---------------------------------------------------------------------------

export interface LoadPluginOpts {
  /**
   * Allowlist of spec names that are permitted to be imported and registered.
   * Any spec not in this list is rejected without being imported.
   * Takes precedence over `confirm` when both are provided.
   */
  trusted?: string[];
  /**
   * Callback invoked synchronously per spec to decide if it is trusted.
   * Only used when `trusted` is not provided. The spec is rejected without
   * import if the callback returns false. If both `trusted` and `confirm` are
   * absent, all specs are rejected (safe default).
   */
  confirm?: (spec: string) => boolean | Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const defaultImport = (spec: string): Promise<unknown> => import(spec);

/**
 * Load each spec as a plugin, validate it, and register its module.
 *
 * Security: A spec is only imported and registered if it passes the trust gate:
 *   - It is listed in `opts.trusted`, OR
 *   - `opts.confirm(spec)` returns true.
 * If neither option is provided, ALL specs are rejected (safe default).
 *
 * Any error (import failure, invalid shape, api mismatch, duplicate, trust
 * failure) is caught and pushed to `rejected`; processing continues for the
 * remaining specs.
 */
export async function loadPlugins(
  registry: ModuleRegistry,
  specs: string[],
  importer: (spec: string) => Promise<unknown> = defaultImport,
  opts?: LoadPluginOpts,
): Promise<LoadResult> {
  const loaded: string[] = [];
  const rejected: { spec: string; reason: string }[] = [];

  for (const spec of specs) {
    // ── Trust gate ──────────────────────────────────────────────────────────
    let trusted = false;
    if (opts?.trusted !== undefined) {
      trusted = opts.trusted.includes(spec);
    } else if (opts?.confirm !== undefined) {
      trusted = await opts.confirm(spec);
    }
    // If no trust mechanism provided, or spec is not in allowlist, reject.
    if (!opts || (!opts.trusted && !opts.confirm)) {
      rejected.push({
        spec,
        reason: "not trusted: no allowlist or confirm callback provided — all plugins require explicit trust",
      });
      continue;
    }
    if (!trusted) {
      rejected.push({ spec, reason: "not trusted: spec is not in the allowlist" });
      continue;
    }

    try {
      const mod = await importer(spec);
      // Unwrap a default export: if the namespace lacks a top-level `manifest`
      // but has a `default` that looks like a plugin, use it instead.
      const ns = mod as Record<string, unknown>;
      const candidate =
        ns && typeof ns === "object" && !("manifest" in ns) && "default" in ns
          ? (ns as { default: unknown }).default
          : ns;
      const plugin = validatePlugin(candidate);
      registry.register(plugin.createModule());
      loaded.push(plugin.manifest.name);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      rejected.push({ spec, reason });
    }
  }

  return { loaded, rejected };
}
