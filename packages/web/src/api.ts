// Typed fetch wrapper for Roost API endpoints
import type { ChangeSet, ApplyResult, DriftReport, DriftItem } from "@roost/shared";

// Re-export shared types for component use
export type { ChangeSet, ApplyResult, DriftReport, DriftItem };

export interface HealthResponse {
  ok: boolean;
  name: string;
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

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
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
