import { useState, useEffect, useCallback } from "react";
import {
  FileCode,
  Package,
  SlidersHorizontal,
  GitBranch,
  Scan,
} from "@phosphor-icons/react";
import type { DriftItem } from "@roost/shared";
import { ModuleSection } from "../components/ModuleSection";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { getSelection, getStatus, type SelectionResponse, type StatusResponse } from "../api";

function getModuleIcon(module: string) {
  switch (module) {
    case "dotfiles": return <FileCode size={16} />;
    case "packages": return <Package size={16} />;
    case "appconfig": return <SlidersHorizontal size={16} />;
    case "projects": return <GitBranch size={16} />;
    case "secrets": return <Scan size={16} />;
    default: return <FileCode size={16} />;
  }
}

export function Manage() {
  const [selection, setSelection] = useState<SelectionResponse | null>(null);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sel, st] = await Promise.allSettled([getSelection(), getStatus()]);
      if (sel.status === "fulfilled") setSelection(sel.value);
      if (st.status === "fulfilled") setStatusData(st.value);
      if (sel.status === "rejected" && st.status === "rejected") {
        setError("Could not load module data. Is the server running?");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Server returns { schemaVersion, modules: Record<string, string[]> }
  const modules = Object.keys(selection?.modules ?? {});

  function getItemsForModule(moduleName: string): DriftItem[] {
    const statusReport = statusData?.reports.find((r) => r.module === moduleName);
    const selectionIds = selection?.modules[moduleName] ?? [];

    if (statusReport?.items?.length) {
      return statusReport.items;
    }

    // Fallback: build from selection IDs with untracked state
    return selectionIds.map((id) => ({
      id,
      state: "untracked" as const,
    }));
  }

  function getModuleStatus(moduleName: string): string {
    const report = statusData?.reports.find((r) => r.module === moduleName);
    if (!report) return "untracked";
    const items = report.items ?? [];
    if (items.some((i) => i.state === "conflict")) return "conflict";
    if (items.some((i) => i.state === "drift")) return "drift";
    return "synced";
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--rc)",
            overflow: "hidden",
          }}
        >
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-soft)" }}>
              <Skeleton width={180} height={16} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: "rgba(242,85,90,.1)",
            border: "1px solid var(--red)",
            borderRadius: "var(--rr)",
            color: "var(--red)",
            fontSize: 13,
          }}
        >
          {error} —{" "}
          <button
            onClick={() => void fetchData()}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              fontFamily: "var(--font)",
              fontSize: 13,
              padding: 0,
            }}
          >
            retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--muted)",
            fontWeight: 600,
          }}
        >
          Managed {modules.length} modules
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          Add/remove: coming in P4
        </div>
      </div>

      {modules.length === 0 ? (
        <EmptyState
          icon={<FileCode size={24} />}
          title="No modules tracked"
          subtitle="Run roost init to set up module tracking"
        />
      ) : (
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--rc)",
            overflow: "hidden",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.035)",
          }}
        >
          {modules.map((moduleName) => (
            <ModuleSection
              key={moduleName}
              name={moduleName}
              status={getModuleStatus(moduleName)}
              items={getItemsForModule(moduleName)}
              icon={getModuleIcon(moduleName)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
