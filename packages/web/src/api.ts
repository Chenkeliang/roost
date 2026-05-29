// Typed fetch wrapper for Roost API endpoints

export interface HealthResponse {
  ok: boolean;
  name: string;
}

export interface ModulesResponse {
  modules: string[];
}

export interface SelectionItem {
  module: string;
  ids: string[];
}

export type SelectionResponse = Record<string, string[]>;

export interface StatusReport {
  module: string;
  status: "synced" | "drift" | "conflict" | "unmanaged" | string;
  items?: StatusItem[];
  error?: string;
}

export interface StatusItem {
  id: string;
  status: "synced" | "drift" | "conflict" | "unmanaged" | string;
  encrypted?: boolean;
}

export interface StatusResponse {
  reports: StatusReport[];
}

export interface MachinesResponse {
  hosts: string[];
  states: Record<string, unknown>;
}

export interface CaptureChange {
  module: string;
  id: string;
  action: string;
}

export interface CaptureResponse {
  changes: CaptureChange[];
}

export interface LoadChange {
  module: string;
  id: string;
  action: string;
}

export interface LoadResponse {
  changes: LoadChange[];
  dryRun?: boolean;
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
