// Typed fetch wrapper for Roost API endpoints
import type { ChangeSet, ApplyResult, DriftReport, DriftItem, Candidate, EnvData } from "@roost/shared";

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
export type { ChangeSet, ApplyResult, DriftReport, DriftItem, Candidate, EnvData };

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

// Server PUT /api/env accepts a full EnvData; a secret env item carrying a non-empty
// `value` is treated as NEW plaintext to encrypt server-side (never echoed back).
export function putEnv(data: EnvData): Promise<EnvData> {
  return apiFetch<EnvData>("/api/env", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
