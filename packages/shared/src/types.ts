// 与 architecture.md §4 的 SyncModule 契约保持一致。
export const RECOMMENDATIONS = ["track", "encrypt", "exclude"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export function isRecommendation(v: string): v is Recommendation {
  return (RECOMMENDATIONS as readonly string[]).includes(v);
}

export interface Logger { info(msg: string): void; warn(msg: string): void; error(msg: string): void; }
export interface ExecResult { code: number; stdout: string; stderr: string; }
export interface Exec { run(cmd: string, args: string[], opts?: { cwd?: string }): Promise<ExecResult>; }
export type Translate = (key: string, vars?: Record<string, string>) => string;

export interface ModuleContext {
  repoDir: string; home: string; profile: string; dryRun: boolean;
  log: Logger; exec: Exec; t: Translate;
}
export interface Selection { modules: Record<string, string[]>; }

export interface Candidate {
  id: string; path: string; category: string; sizeBytes?: number;
  recommendation: Recommendation; note?: string;
}
export type DriftState = "synced" | "drift" | "conflict" | "untracked";
export interface DriftItem { id: string; state: DriftState; detail?: string; }
export interface DriftReport { module: string; items: DriftItem[]; }
export interface ChangeSet { module: string; written: string[]; encrypted: string[]; blocked?: string[]; }
export type ApplyKind = "create" | "update" | "delete" | "skip";
export interface ApplyAction { id: string; kind: ApplyKind; target: string; backup?: string; }
export interface ApplyPlan { module: string; actions: ApplyAction[]; }
export interface ApplyResult { module: string; applied: string[]; backedUp: string[]; skipped: string[]; }
export interface Health { name: string; ok: boolean; detail?: string; }

// ── env module ("Aliases & Env") ───────────────────────────────────────────────
// Portable aliases / env vars / PATH entries / shell functions that Roost manages
// structurally and injects into the shell via a single generated file. This is an
// additive layer distinct from `dotfiles` (which backs up existing config FILES).
export type ShellItemKind = "alias" | "env" | "path" | "function";
export interface AliasItem { kind: "alias"; name: string; value: string; comment?: string; enabled: boolean }
// when secret:true, `value` is '' in committed yaml + API responses
export interface EnvVarItem { kind: "env"; name: string; value: string; secret: boolean; comment?: string; enabled: boolean }
export interface PathEntry { kind: "path"; value: string; position: "prepend" | "append"; comment?: string; enabled: boolean }
export interface FunctionItem { kind: "function"; name: string; body: string; comment?: string; enabled: boolean }
export interface EnvData { schemaVersion: number; aliases: AliasItem[]; env: EnvVarItem[]; path: PathEntry[]; functions: FunctionItem[] }

export interface SyncModule {
  name: string;
  discover(ctx: ModuleContext): Promise<Candidate[]>;
  status(ctx: ModuleContext, sel: Selection): Promise<DriftReport>;
  capture(ctx: ModuleContext, sel: Selection): Promise<ChangeSet>;
  apply(ctx: ModuleContext, plan: ApplyPlan): Promise<ApplyResult>;
  diff(ctx: ModuleContext, sel: Selection): Promise<string>;
  unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult>;
  doctor(ctx: ModuleContext): Promise<Health[]>;
}
