import { useState, useEffect, useCallback } from "react";
import {
  FileCode,
  Package,
  SlidersHorizontal,
  GitBranch,
  Scan,
  Plus,
  Trash,
  CaretDown,
  CaretRight,
} from "@phosphor-icons/react";
import type { DriftItem, Candidate } from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { useT } from "../i18n";
import { StatusDot } from "../components/StatusDot";
import { Skeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import {
  getSelection,
  getStatus,
  getDiscover,
  addSelection,
  removeSelection,
  type SelectionResponse,
  type StatusResponse,
  type DiscoverResponse,
} from "../api";

interface ManageProps {
  showHud?: (msg: HudMessage) => void;
}

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

function getModuleStatus(
  moduleName: string,
  statusData: StatusResponse | null,
): string {
  const report = statusData?.reports.find((r) => r.module === moduleName);
  if (!report) return "untracked";
  const items = report.items ?? [];
  if (items.some((i) => i.state === "conflict")) return "conflict";
  if (items.some((i) => i.state === "drift")) return "drift";
  return "synced";
}

function getItemsForModule(
  moduleName: string,
  selection: SelectionResponse | null,
  statusData: StatusResponse | null,
): DriftItem[] {
  const statusReport = statusData?.reports.find((r) => r.module === moduleName);
  const selectionIds = selection?.modules[moduleName] ?? [];
  if (statusReport?.items?.length) return statusReport.items;
  return selectionIds.map((id) => ({ id, state: "untracked" as const }));
}

// ── AddPanel: per-module discover + add ──────────────────────────────────────

interface AddPanelProps {
  moduleName: string;
  selectedIds: string[];
  discover: DiscoverResponse | null;
  onAdd: (module: string, id: string) => Promise<void>;
}

function AddPanel({ moduleName, selectedIds, discover, onAdd }: AddPanelProps) {
  const [open, setOpen] = useState(false);
  const candidates: Candidate[] = discover?.candidates[moduleName] ?? [];
  const untracked = candidates.filter((c) => !selectedIds.includes(c.id));

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          appearance: "none",
          border: "1px dashed var(--border)",
          background: "transparent",
          color: "var(--muted)",
          fontFamily: "var(--font)",
          fontSize: 12,
          padding: "5px 10px",
          borderRadius: "var(--rr)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        {open ? <CaretDown size={11} /> : <CaretRight size={11} />}
        <Plus size={11} />
        Add items
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            background: "var(--surface-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--rr)",
            overflow: "hidden",
          }}
        >
          {untracked.length === 0 ? (
            <div
              style={{
                padding: "10px 14px",
                color: "var(--muted)",
                fontSize: 12,
              }}
            >
              {candidates.length === 0
                ? "No candidates discovered for this module."
                : "All discovered items are already tracked."}
            </div>
          ) : (
            untracked.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--border-soft)",
                  fontSize: 12,
                }}
              >
                <span
                  className="mono"
                  style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {c.id}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 11, minWidth: 54 }}>
                  {c.category}
                </span>
                <button
                  onClick={() => void onAdd(moduleName, c.id)}
                  style={{
                    appearance: "none",
                    border: "1px solid var(--border)",
                    background: "var(--raise)",
                    color: "var(--accent)",
                    fontFamily: "var(--font)",
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Plus size={10} />
                  Add
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── ItemRowWithRemove ─────────────────────────────────────────────────────────

interface ItemRowWithRemoveProps {
  item: DriftItem;
  moduleName: string;
  onRemove: (module: string, id: string) => Promise<void>;
}

function ItemRowWithRemove({ item, moduleName, onRemove }: ItemRowWithRemoveProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      role="row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: "var(--row)",
        padding: "0 8px 0 28px",
        borderRadius: "var(--rr)",
        background: hovered ? "var(--surface-2)" : "transparent",
        transition: "background .12s",
        cursor: "default",
        fontSize: 13,
      }}
    >
      <span
        className="mono"
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {item.id}
      </span>
      <StatusDot status={item.state} />
      <span style={{ color: "var(--muted)", fontSize: 12, fontFamily: "var(--mono)", minWidth: 54 }}>
        {item.state}
      </span>
      {hovered && (
        <button
          onClick={() => void onRemove(moduleName, item.id)}
          aria-label={`Remove ${item.id}`}
          style={{
            appearance: "none",
            border: "1px solid var(--border)",
            background: "var(--raise)",
            color: "var(--red)",
            fontFamily: "var(--font)",
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Trash size={11} />
          Remove
        </button>
      )}
    </div>
  );
}

// ── ModuleSectionWithActions ──────────────────────────────────────────────────

interface ModuleSectionWithActionsProps {
  name: string;
  items: DriftItem[];
  discover: DiscoverResponse | null;
  selectedIds: string[];
  onRemove: (module: string, id: string) => Promise<void>;
  onAdd: (module: string, id: string) => Promise<void>;
}

function ModuleSectionWithActions({
  name,
  items,
  discover,
  selectedIds,
  onRemove,
  onAdd,
}: ModuleSectionWithActionsProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          appearance: "none",
          background: "none",
          border: "none",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 14px",
          fontWeight: 540,
          cursor: "pointer",
          color: "var(--text)",
          fontFamily: "var(--font)",
          fontSize: 14,
          textAlign: "left",
        }}
      >
        {expanded ? <CaretDown size={12} style={{ color: "var(--muted)", flexShrink: 0 }} /> : <CaretRight size={12} style={{ color: "var(--muted)", flexShrink: 0 }} />}
        {getModuleIcon(name)}
        <span>{name}</span>
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>
          {items.length}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <StatusDot status={getModuleStatus(name, null)} />
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "2px 8px 10px" }}>
          {items.map((item) => (
            <ItemRowWithRemove
              key={item.id}
              item={item}
              moduleName={name}
              onRemove={onRemove}
            />
          ))}
          <div style={{ marginTop: 6, paddingLeft: 4 }}>
            <AddPanel
              moduleName={name}
              selectedIds={selectedIds}
              discover={discover}
              onAdd={onAdd}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Manage ────────────────────────────────────────────────────────────────────

export function Manage({ showHud }: ManageProps) {
  const { t } = useT();
  const [selection, setSelection] = useState<SelectionResponse | null>(null);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [discover, setDiscover] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sel, st, disc] = await Promise.allSettled([
        getSelection(),
        getStatus(),
        getDiscover(),
      ]);
      if (sel.status === "fulfilled") setSelection(sel.value);
      if (st.status === "fulfilled") setStatusData(st.value);
      if (disc.status === "fulfilled") setDiscover(disc.value);
      if (
        sel.status === "rejected" &&
        st.status === "rejected"
      ) {
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

  const handleRemove = useCallback(
    async (module: string, id: string) => {
      try {
        const updated = await removeSelection(module, id);
        setSelection(updated);
        showHud?.({ text: `Removed ${id} from ${module}`, type: "success" });
      } catch (e) {
        showHud?.({
          text: e instanceof Error ? e.message : "Remove failed",
          type: "error",
        });
      }
    },
    [showHud],
  );

  const handleAdd = useCallback(
    async (module: string, id: string) => {
      try {
        const updated = await addSelection(module, id);
        setSelection(updated);
        showHud?.({ text: `Added ${id} to ${module}`, type: "success" });
      } catch (e) {
        showHud?.({
          text: e instanceof Error ? e.message : "Add failed",
          type: "error",
        });
      }
    },
    [showHud],
  );

  const modules = Object.keys(selection?.modules ?? {});

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
            <div
              key={i}
              style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-soft)" }}
            >
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
      </div>

      {modules.length === 0 ? (
        <EmptyState
          icon={<FileCode size={24} />}
          title={t("manage.noModulesTitle")}
          subtitle={t("manage.noModulesSubtitle")}
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
            <ModuleSectionWithActions
              key={moduleName}
              name={moduleName}
              items={getItemsForModule(moduleName, selection, statusData)}
              discover={discover}
              selectedIds={selection?.modules[moduleName] ?? []}
              onRemove={handleRemove}
              onAdd={handleAdd}
            />
          ))}
        </section>
      )}
    </div>
  );
}
