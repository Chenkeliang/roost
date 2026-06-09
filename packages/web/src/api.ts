// Typed fetch wrapper for Roost API endpoints
import type { ChangeSet, BlockedItem, BlockReason, ApplyResult, DriftReport, DriftItem, Candidate, EnvData, ModuleIndex } from "@roost/shared";

// When running inside Tauri there is no Vite dev-proxy, so we must target the
// engine's absolute URL.  In normal browser / Vite dev / jsdom test contexts
// `window.__TAURI_INTERNALS__` is undefined and we fall back to "" so that
// relative `/api/*` paths continue to work unchanged (existing tests stay green).
//
// Override via VITE_API_BASE env var for other deployment scenarios.
const API_BASE: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE ??
  (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    ? "http://127.0.0.1:4317"
    : "");

// Re-export shared types for component use
export type { ChangeSet, BlockedItem, BlockReason, ApplyResult, DriftReport, DriftItem, Candidate, EnvData, ModuleIndex };

export interface HealthResponse {
  ok: boolean;
  name: string;
  repoDir?: string;
  ageKey?: boolean;
}

export interface ModulesResponse {
  modules: string[];
}

// Server GET /api/selection returns SelectionDoc: { schemaVersion: number; modules: Record<string, string[]> }
export interface SelectionResponse {
  schemaVersion: number;
  modules: Record<string, string[]>;
}

// Server GET /api/status returns { reports: DriftReport[] }
export interface StatusResponse {
  reports: DriftReport[];
}

export interface MachinesResponse {
  hosts: string[];
  states: Record<string, unknown>;
}

// Server POST /api/capture returns { changes: ChangeSet[] }
export interface CaptureResponse {
  changes: ChangeSet[];
}

// Server POST /api/load returns { results: ApplyResult[] }
export interface LoadResponse {
  results: ApplyResult[];
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}

export function getModules(): Promise<ModulesResponse> {
  return apiFetch<ModulesResponse>("/api/modules");
}

export function getSelection(): Promise<SelectionResponse> {
  return apiFetch<SelectionResponse>("/api/selection");
}

export function getStatus(): Promise<StatusResponse> {
  return apiFetch<StatusResponse>("/api/status");
}

// ── sync-state (ADR-0016) ──────────────────────────────────────────────────────
export type SyncDirection = "synced" | "ahead" | "behind" | "diverged";
export type SyncExceptionKind = "diverged" | "blocked" | "destructive";
export interface SyncItem {
  module: string;
  id: string;
  direction: SyncDirection;
  exception: SyncExceptionKind | null;
  detail?: string;
}
export interface SyncCounts {
  synced: number;
  auto: number;
  diverged: number;
  blocked: number;
  destructive: number;
}
export interface SyncStateResponse {
  items: SyncItem[];
  counts: SyncCounts;
  overall: SyncDirection;
}

export function getSyncState(): Promise<SyncStateResponse> {
  return apiFetch<SyncStateResponse>("/api/sync-state");
}

// ── environment / setup ────────────────────────────────────────────────────────
export interface EnvCheck {
  id: string;
  ok: boolean;
  required: boolean;
  brewFormula?: string;
}
export interface EnvironmentResponse {
  checks: EnvCheck[];
}
export function getEnvironment(): Promise<EnvironmentResponse> {
  return apiFetch<EnvironmentResponse>("/api/environment");
}
export interface BrewInstallResponse {
  ok: boolean;
  output: string;
}
export function postBrewInstall(formulae: string[]): Promise<BrewInstallResponse> {
  return apiFetch<BrewInstallResponse>("/api/environment/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formulae }),
  });
}

export interface KeyDiff {
  key: string;
  local: string | null;
  repo: string | null;
}
export interface ItemDiffResponse {
  kind: "text" | "summary";
  local: string | null;
  repo: string | null;
  summary?: string;
  keys?: KeyDiff[];
}
export function getItemDiff(module: string, id: string): Promise<ItemDiffResponse> {
  const q = `?module=${encodeURIComponent(module)}&id=${encodeURIComponent(id)}`;
  return apiFetch<ItemDiffResponse>(`/api/item-diff${q}`);
}

export type ResolveAction = "take-repo" | "keep-local";
export interface ResolveResponse {
  ok: boolean;
  action: ResolveAction;
  applied: string[];
  backedUp?: string[];
}
export function postResolve(
  module: string,
  id: string,
  action: ResolveAction,
): Promise<ResolveResponse> {
  return apiFetch<ResolveResponse>("/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ module, id, action }),
  });
}

export function getMachines(): Promise<MachinesResponse> {
  return apiFetch<MachinesResponse>("/api/machines");
}

export function postCapture(): Promise<CaptureResponse> {
  return apiFetch<CaptureResponse>("/api/capture", { method: "POST" });
}

export function postLoad(apply = false): Promise<LoadResponse> {
  return apiFetch<LoadResponse>("/api/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apply }),
  });
}

// Server GET /api/discover returns { candidates: Record<string, Candidate[]> }
export interface DiscoverResponse {
  candidates: Record<string, Candidate[]>;
}

export function getDiscover(): Promise<DiscoverResponse> {
  return apiFetch<DiscoverResponse>("/api/discover");
}

// Server POST /api/selection/add|remove returns updated SelectionResponse
export function addSelection(module: string, id: string): Promise<SelectionResponse> {
  return apiFetch<SelectionResponse>("/api/selection/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ module, id }),
  });
}

export function removeSelection(module: string, id: string): Promise<SelectionResponse> {
  return apiFetch<SelectionResponse>("/api/selection/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ module, id }),
  });
}

// Server GET /api/timeline returns { entries: TimelineEntry[] }
export interface TimelineEntry {
  sha: string;
  subject: string;
  date: string;
}

export interface TimelineResponse {
  entries: TimelineEntry[];
}

export function getTimeline(): Promise<TimelineResponse> {
  return apiFetch<TimelineResponse>("/api/timeline");
}

// Server GET /api/diff returns { diffs: DiffEntry[] }
export interface DiffEntry {
  module: string;
  text: string;
}

export interface DiffResponse {
  diffs: DiffEntry[];
}

export function getDiff(): Promise<DiffResponse> {
  return apiFetch<DiffResponse>("/api/diff");
}

// Server GET /api/env returns the full EnvData with secret env values redacted to ''.
export function getEnv(): Promise<EnvData> {
  return apiFetch<EnvData>("/api/env");
}

// ── Age key lifecycle (the private key never crosses the wire; only recipient) ──
export interface KeyStatus { exists: boolean; recipient: string | null; keyPath: string; encryptedFiles: number; }
export interface KeyGenerateResult { created: boolean; source: string; recipient: string | null; keyPath: string; }
export interface KeyRotateResult { recipient: string; rotated: string[]; failed: { path: string; reason: string }[]; swapped: boolean; backupPath?: string; }

export function getKey(): Promise<KeyStatus> {
  return apiFetch<KeyStatus>("/api/key");
}
export function generateKey(): Promise<KeyGenerateResult> {
  return apiFetch<KeyGenerateResult>("/api/key/generate", { method: "POST" });
}
export function rotateKey(): Promise<KeyRotateResult> {
  return apiFetch<KeyRotateResult>("/api/key/rotate", { method: "POST" });
}

// Server PUT /api/env accepts a full EnvData; a secret env item carrying a non-empty
// `value` is treated as NEW plaintext to encrypt server-side (never echoed back).
export function putEnv(data: EnvData): Promise<EnvData> {
  return apiFetch<EnvData>("/api/env", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// Server POST /api/env/apply regenerates the live env.sh from env.yaml and
// returns a one-paste command to sync the CURRENT shell (a web app cannot reach
// into an already-open shell, so new shells pick it up automatically).
export interface EnvApplyResponse { applied: string[]; reload: string; }

export function applyEnv(): Promise<EnvApplyResponse> {
  return apiFetch<EnvApplyResponse>("/api/env/apply", { method: "POST" });
}

// Server GET /api/index returns { index: Record<string, ModuleIndex> }
export interface IndexResponse { index: Record<string, ModuleIndex>; }

export function getIndex(): Promise<IndexResponse> {
  return apiFetch<IndexResponse>("/api/index");
}

export function getDiscoverModule(module: string): Promise<DiscoverResponse> {
  return apiFetch<DiscoverResponse>(`/api/discover?module=${encodeURIComponent(module)}`);
}

// Server GET /api/packages/brewfile
export interface BrewfileResponse {
  available: boolean;
  exists: boolean;
  entries: { taps: string[]; formulae: string[]; casks: string[]; mas: string[] };
}

export function getBrewfile(): Promise<BrewfileResponse> {
  return apiFetch<BrewfileResponse>("/api/packages/brewfile");
}

// Server POST /api/packages/install installs a chosen subset of per-package ids.
export interface InstallResult { ok: boolean; installed: number; output: string }
export function installPackages(ids: string[]): Promise<InstallResult> {
  return apiFetch<InstallResult>("/api/packages/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

// Server GET /api/packages/states returns per-package install state keyed by id.
export type PackageState = "installed" | "outdated" | "missing";
export function getPackageStates(): Promise<{ states: Record<string, PackageState> }> {
  return apiFetch<{ states: Record<string, PackageState> }>("/api/packages/states");
}

// Server GET /api/dotfiles returns chezmoi availability + managed relative paths.
export interface DotfilesResponse {
  available: boolean;
  managed: string[];
}

export function getDotfiles(): Promise<DotfilesResponse> {
  return apiFetch<DotfilesResponse>("/api/dotfiles");
}

// Server GET /api/appconfig returns defaults availability + managed domain names.
export interface AppConfigResponse {
  available: boolean;
  managed: string[];
}

export function getAppConfig(): Promise<AppConfigResponse> {
  return apiFetch<AppConfigResponse>("/api/appconfig");
}

export function testProjectRemote(remote: string): Promise<{ reachable: boolean; message: string }> {
  return apiFetch("/api/projects/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remote }),
  });
}

// ── Git remote & sync ─────────────────────────────────────────────────────────

export interface GitStatus {
  isRepo: boolean;
  remote: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
}

export interface GitOpResult {
  ok: boolean;
  output: string;
  hint?: "auth";
}

export function getGitStatus(): Promise<GitStatus> {
  return apiFetch<GitStatus>("/api/git/status");
}

export function gitPush(): Promise<GitOpResult> {
  return apiFetch<GitOpResult>("/api/git/push", { method: "POST" });
}

export function gitPull(): Promise<GitOpResult> {
  return apiFetch<GitOpResult>("/api/git/pull", { method: "POST" });
}

// ── Skills ─────────────────────────────────────────────────────────────────────
export type SkillMethod = "symlink" | "copy";
export interface SkillTarget { id: string; path: string; label: string; }
export interface EffectiveSkill { enabled: boolean; targets: string[]; method: SkillMethod; }
export interface SkillLink { skill: string; target: string; path: string; kind: SkillMethod; }
export interface SkillsConfig {
  sourceDir: string;
  method: SkillMethod;
  targets: string[];
  skills: Record<string, { enabled?: boolean; targets?: string[]; method?: SkillMethod }>;
}
export interface SkillRow { name: string; effective: EffectiveSkill; links: SkillLink[]; conflicts: string[]; }
export interface SkillsView { config: SkillsConfig; targets: SkillTarget[]; skills: SkillRow[]; }

export function getSkills(): Promise<SkillsView> {
  return apiFetch<SkillsView>("/api/skills");
}

export function discoverSkills(): Promise<{ candidates: { id: string; note?: string }[] }> {
  return apiFetch<{ candidates: { id: string; note?: string }[] }>("/api/skills/discover");
}

export function captureSkills(names: string[]): Promise<{ written: string[]; blocked?: string[] }> {
  return apiFetch<{ written: string[]; blocked?: string[] }>("/api/skills/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
}

export function toggleSkill(
  skill: string,
  enabled: boolean,
  target?: string,
): Promise<{ ok: boolean; config: SkillsConfig }> {
  return apiFetch<{ ok: boolean; config: SkillsConfig }>("/api/skills/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skill, enabled, target }),
  });
}

export function linkSkills(opts?: { copy?: boolean; targets?: string[] }): Promise<{ applied: string[]; skipped: string[] }> {
  return apiFetch<{ applied: string[]; skipped: string[] }>("/api/skills/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
}

export function resolveSkillConflict(skill: string, target: string): Promise<{ ok: boolean; backedUp: string; linked: string }> {
  return apiFetch("/api/skills/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill, target }) });
}

export function saveSkillsConfig(config: SkillsConfig): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/skills/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

// ── Roost settings ───────────────────────────────────────────────────────────
export function getSettings(): Promise<{ maxCaptureMB: number }> { return apiFetch("/api/settings"); }
export function saveSettings(maxCaptureMB: number): Promise<{ ok: boolean; maxCaptureMB: number }> {
  return apiFetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxCaptureMB }) });
}
