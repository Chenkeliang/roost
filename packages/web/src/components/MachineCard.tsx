import { Laptop, Monitor } from "lucide-react";
import { Tile } from "./Tile";
import { StatusDot } from "./StatusDot";
import { Skeleton } from "./Skeleton";

interface MachineCardProps {
  type: "primary" | "follower";
  name?: string;
  hostname?: string;
  tracked?: number;
  drift?: number;
  lastAction?: string;
  lastActionLabel?: string;
  status?: "synced" | "drift" | "conflict" | "unmanaged";
  loading?: boolean;
}

export function MachineCard({
  type,
  name,
  hostname,
  tracked,
  drift,
  lastAction,
  lastActionLabel,
  status = "synced",
  loading = false,
}: MachineCardProps) {
  const isPrimary = type === "primary";

  return (
    <article
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--rc)",
        padding: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.035)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Tile color={isPrimary ? "blue" : "slate"} size={30}>
          {isPrimary ? <Laptop size={16} /> : <Monitor size={16} />}
        </Tile>
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <>
              <Skeleton width={120} height={14} />
              <Skeleton width={90} height={11} style={{ marginTop: 4 }} />
            </>
          ) : (
            <>
              <div style={{ fontWeight: 560, fontSize: 14 }}>
                {isPrimary ? "Primary" : "Follower"} · {name ?? "—"}
              </div>
              <div
                className="mono"
                style={{ color: "var(--muted)", fontSize: 13 }}
              >
                {hostname ?? "—"}
              </div>
            </>
          )}
        </div>
        {!loading && <StatusDot status={status} />}
      </div>

      <div
        style={{
          display: "flex",
          gap: 22,
          margin: "14px 0 6px",
        }}
      >
        {loading ? (
          <>
            <Skeleton width={60} height={22} />
            <Skeleton width={60} height={22} />
          </>
        ) : (
          <>
            <div>
              <span
                className="mono"
                style={{
                  fontSize: 22,
                  marginRight: 6,
                }}
              >
                {tracked ?? "—"}
              </span>
              <span style={{ color: "var(--muted)", fontSize: 14 }}>tracked</span>
            </div>
            <div>
              <span
                className="mono"
                style={{
                  fontSize: 22,
                  marginRight: 6,
                  color: drift ? "var(--amber)" : "var(--green)",
                }}
              >
                {drift ?? 0}
              </span>
              <span style={{ color: "var(--muted)", fontSize: 14 }}>drift</span>
            </div>
          </>
        )}
      </div>

      {!loading && lastAction && (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          {lastActionLabel ?? "last action"}{" "}
          <span className="mono">{lastAction}</span>
        </div>
      )}
    </article>
  );
}
