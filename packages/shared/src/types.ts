// 与 architecture.md §4 的 SyncModule 契约保持一致。
export const RECOMMENDATIONS = ["track", "encrypt", "exclude"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export function isRecommendation(v: string): v is Recommendation {
  return (RECOMMENDATIONS as readonly string[]).includes(v);
}

export interface Logger { info(msg: string): void; warn(msg: string): void; error(msg: string): void; }
export interface ExecResult { code: number; stdout: string; stderr: string; }
export interface Exec { run(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string | undefined> }): Promise<ExecResult>; }
export type Translate = (key: string, vars?: Record<string, string>) => string;

export interface ModuleContext {
  repoDir: string; home: string; profile: string; dryRun: boolean;
  log: Logger; exec: Exec; t: Translate;
}
export interface Selection { modules: Record<string, string[]>; }

export interface Candidate {
  id: string; path: string; category: string; sizeBytes?: number;
  recommendation: Recommendation; note?: string;
  remote?: string; host?: string; protocol?: "ssh" | "https" | "other";
}

export interface ModuleIndex {
  available: boolean;
  reason?: string;
  managed: number;
  summary?: Record<string, number | string>;
}
export type DriftState = "synced" | "drift" | "conflict" | "untracked";

// Sync-state model (ADR-0016 / ADR-0017). All fields optional + additive:
// modules that have not been upgraded keep returning { id, state } and the
// classifier falls back to a safe legacy mapping.
export type Direction = "synced" | "ahead" | "behind" | "diverged";
export type SyncException = "diverged" | "blocked" | "destructive";
export interface DriftItem {
  id: string;
  state: DriftState;
  detail?: string;
  // null = absent on that side; undefined = module did not report a hash.
  localHash?: string | null;
  repoHash?: string | null;
  baselineHash?: string | null;
  direction?: Direction;
  exception?: SyncException;
  blocked?: boolean; // a prerequisite is missing (age key / tool / decrypt)
}
export interface DriftReport { module: string; items: DriftItem[]; }
export type BlockReason = "secret" | "too-large" | "managed" | "error";
export interface BlockedItem { id: string; reason: BlockReason; detail?: string }
export interface ChangeSet { module: string; written: string[]; encrypted: string[]; blocked?: string[]; blockedDetail?: BlockedItem[]; }
export type ApplyKind = "create" | "update" | "delete" | "skip";
export interface ApplyAction { id: string; kind: ApplyKind; target: string; backup?: string; }
export interface ApplyPlan { module: string; actions: ApplyAction[]; }
export interface ApplyResult { module: string; applied: string[]; backedUp: string[]; skipped: string[]; }
// `blocking: true` marks a check that must pass before a load can proceed
// (a required external tool / reachable repo / present age key). Optional +
// additive: unmarked checks are advisory (warnings), never gate the load.
export interface Health { name: string; ok: boolean; detail?: string; blocking?: boolean; }

// ── env module ("Aliases & Env") ───────────────────────────────────────────────
// Portable aliases / env vars / PATH entries / shell functions that Roost manages
// structurally and injects into the shell via a single generated file. This is an
// additive layer distinct from `dotfiles` (which backs up existing config FILES).
export type ShellItemKind = "alias" | "env" | "path" | "function";
export interface AliasItem { kind: "alias"; name: string; value: string; comment?: string; enabled: boolean }
// Source of a secret env value (ADR-0004). Absent ⇒ treated as { kind: "age" }
// for back-compat. Only meaningful when `secret: true`.
export type EnvSecretSource =
  | { kind: "age" }
  | { kind: "ref"; backend: "op" | "rbw"; ref: string };
// when secret:true, `value` is '' in committed yaml + API responses
export interface EnvVarItem { kind: "env"; name: string; value: string; secret: boolean; source?: EnvSecretSource; comment?: string; enabled: boolean }
export interface PathEntry { kind: "path"; value: string; position: "prepend" | "append"; comment?: string; enabled: boolean }
export interface FunctionItem { kind: "function"; name: string; body: string; comment?: string; enabled: boolean }
export interface EnvData { schemaVersion: number; aliases: AliasItem[]; env: EnvVarItem[]; path: PathEntry[]; functions: FunctionItem[] }

export interface SyncModule {
  name: string;
  discover(ctx: ModuleContext): Promise<Candidate[]>;
  index?(ctx: ModuleContext): Promise<ModuleIndex>;
  status(ctx: ModuleContext, sel: Selection): Promise<DriftReport>;
  capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet>;
  apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult>;
  diff(ctx: ModuleContext, sel: Selection): Promise<string>;
  unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult>;
  doctor(ctx: ModuleContext): Promise<Health[]>;
}
