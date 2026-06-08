// Sync-state model (ADR-0016): a machine's position relative to the repo is
// DERIVED from a three-way compare. Pure, module-agnostic logic — no I/O here.
import type { Direction, SyncException, DriftReport, DriftItem } from "@roost/shared";

export interface ThreeWay {
  localHash: string | null; // null = absent locally
  repoHash: string | null; // null = absent in repo
  baselineHash: string | null; // null = never synced this item
}

export function classifyDirection(t: ThreeWay): Direction {
  // Already aligned — nothing to do, even without a baseline.
  if (t.localHash === t.repoHash) return "synced";
  const localChanged = t.localHash !== t.baselineHash;
  const repoChanged = t.repoHash !== t.baselineHash;
  if (localChanged && repoChanged) return "diverged";
  if (localChanged) return "ahead";
  if (repoChanged) return "behind";
  return "synced"; // unreachable given local !== repo
}

export interface ItemSignal {
  three: ThreeWay;
  blocked?: boolean; // prerequisite missing (age key / tool / decrypt failure)
}

// Returns the exception class that REQUIRES a human, or null if the item can be
// auto-resolved (synced/behind/ahead). Order matters: blocked > destructive > diverged.
export function classifyException(sig: ItemSignal): SyncException | null {
  if (sig.blocked) return "blocked";
  const { localHash, repoHash, baselineHash } = sig.three;
  // Repo removed an item we have AND used to track → deleting local content.
  if (repoHash === null && localHash !== null && baselineHash !== null) {
    return "destructive";
  }
  if (classifyDirection(sig.three) === "diverged") return "diverged";
  return null;
}

export interface SyncItem {
  module: string;
  id: string;
  direction: Direction;
  exception: SyncException | null;
  detail?: string;
}
export interface SyncCounts {
  synced: number;
  auto: number; // behind/ahead, no exception → handled automatically
  diverged: number;
  blocked: number;
  destructive: number;
}
export interface SyncStateReport {
  items: SyncItem[];
  counts: SyncCounts;
  overall: Direction;
}

function hasHashes(item: DriftItem): boolean {
  return (
    item.localHash !== undefined ||
    item.repoHash !== undefined ||
    item.baselineHash !== undefined
  );
}

function legacy(item: DriftItem): { direction: Direction; exception: SyncException | null } {
  switch (item.state) {
    case "synced":
      return { direction: "synced", exception: null };
    case "untracked":
      return { direction: "behind", exception: null };
    case "drift":
    case "conflict":
    default:
      // No three-way info: cannot prove which side changed → require a decision.
      return { direction: "diverged", exception: "diverged" };
  }
}

export function computeSyncState(reports: DriftReport[]): SyncStateReport {
  const items: SyncItem[] = [];
  const counts: SyncCounts = { synced: 0, auto: 0, diverged: 0, blocked: 0, destructive: 0 };

  for (const report of reports) {
    for (const item of report.items) {
      let direction: Direction;
      let exception: SyncException | null;
      if (hasHashes(item)) {
        const three: ThreeWay = {
          localHash: item.localHash ?? null,
          repoHash: item.repoHash ?? null,
          baselineHash: item.baselineHash ?? null,
        };
        direction = classifyDirection(three);
        exception = classifyException({ three, blocked: item.blocked });
      } else {
        const l = legacy(item);
        direction = l.direction;
        exception = l.exception;
      }
      items.push({ module: report.module, id: item.id, direction, exception, detail: item.detail });
      if (exception === "blocked") counts.blocked++;
      else if (exception === "destructive") counts.destructive++;
      else if (exception === "diverged") counts.diverged++;
      else if (direction === "synced") counts.synced++;
      else counts.auto++;
    }
  }

  const overall: Direction =
    counts.diverged > 0 || counts.blocked > 0 || counts.destructive > 0
      ? "diverged"
      : counts.auto > 0
        ? "behind"
        : "synced";

  return { items, counts, overall };
}

export type PushSafety = "ok" | "pull-first";

// Pure decision: given the remote HEAD this machine recorded at its last sync
// and the remote HEAD now, decide whether a capture push is safe. A different
// current head means another machine pushed since — pull/merge first.
export function classifyPushSafety(
  recordedRemoteHead: string | undefined,
  currentRemoteHead: string,
): PushSafety {
  if (!recordedRemoteHead) return "ok"; // never synced from here yet
  return recordedRemoteHead === currentRemoteHead ? "ok" : "pull-first";
}
