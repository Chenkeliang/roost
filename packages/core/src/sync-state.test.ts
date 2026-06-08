import { describe, it, expect } from "vitest";
import {
  classifyDirection,
  classifyException,
  computeSyncState,
  classifyPushSafety,
} from "./sync-state.js";
import type { ThreeWay, ItemSignal } from "./sync-state.js";
import type { DriftReport } from "@roost/shared";

const tw = (local: string | null, repo: string | null, baseline: string | null): ThreeWay => ({
  localHash: local,
  repoHash: repo,
  baselineHash: baseline,
});
const sig = (three: ThreeWay, blocked = false): ItemSignal => ({ three, blocked });

describe("classifyDirection", () => {
  it("synced when local equals repo (regardless of baseline)", () => {
    expect(classifyDirection(tw("a", "a", "a"))).toBe("synced");
    expect(classifyDirection(tw("a", "a", null))).toBe("synced");
    expect(classifyDirection(tw(null, null, "a"))).toBe("synced");
  });
  it("ahead when only local changed", () => {
    expect(classifyDirection(tw("b", "a", "a"))).toBe("ahead");
    expect(classifyDirection(tw("a", null, null))).toBe("ahead"); // locally new
  });
  it("behind when only repo changed", () => {
    expect(classifyDirection(tw("a", "b", "a"))).toBe("behind");
    expect(classifyDirection(tw(null, "a", null))).toBe("behind"); // fresh machine
  });
  it("diverged when both changed", () => {
    expect(classifyDirection(tw("b", "c", "a"))).toBe("diverged");
    expect(classifyDirection(tw("b", "c", null))).toBe("diverged");
  });
});

describe("classifyException", () => {
  it("blocked wins over everything", () => {
    expect(classifyException(sig(tw("a", "b", "a"), true))).toBe("blocked");
  });
  it("destructive when repo deleted a managed item still present locally", () => {
    expect(classifyException(sig(tw("a", null, "a")))).toBe("destructive");
  });
  it("diverged when both changed", () => {
    expect(classifyException(sig(tw("b", "c", "a")))).toBe("diverged");
  });
  it("null (auto-resolvable) for behind / ahead / synced", () => {
    expect(classifyException(sig(tw(null, "a", null)))).toBeNull(); // behind
    expect(classifyException(sig(tw("b", "a", "a")))).toBeNull(); // ahead
    expect(classifyException(sig(tw("a", "a", "a")))).toBeNull(); // synced
  });
  it("locally-new absent-in-repo is NOT destructive (it is ahead)", () => {
    expect(classifyException(sig(tw("a", null, null)))).toBeNull();
  });
});

describe("computeSyncState", () => {
  it("classifies items from hashes and tallies counts", () => {
    const reports: DriftReport[] = [
      {
        module: "dotfiles",
        items: [
          { id: "synced.txt", state: "synced", localHash: "a", repoHash: "a", baselineHash: "a" },
          { id: "behind.txt", state: "drift", localHash: null, repoHash: "x", baselineHash: null },
          { id: "div.txt", state: "conflict", localHash: "b", repoHash: "c", baselineHash: "a" },
        ],
      },
      {
        module: "env",
        items: [
          { id: "EDITOR", state: "drift", localHash: "v", repoHash: null, baselineHash: "v", blocked: false },
        ],
      },
    ];
    const out = computeSyncState(reports);
    expect(out.items).toHaveLength(4);
    expect(out.counts).toEqual({ synced: 1, auto: 1, diverged: 1, blocked: 0, destructive: 1 });
    expect(out.overall).toBe("diverged");
    const div = out.items.find((i) => i.id === "div.txt");
    expect(div).toMatchObject({ module: "dotfiles", direction: "diverged", exception: "diverged" });
    const del = out.items.find((i) => i.id === "EDITOR");
    expect(del).toMatchObject({ direction: "behind", exception: "destructive" });
  });

  it("legacy fallback: items without hashes map state safely (differences need a decision)", () => {
    const reports: DriftReport[] = [
      {
        module: "m",
        items: [
          { id: "a", state: "synced" },
          { id: "b", state: "untracked" },
          { id: "c", state: "drift" },
          { id: "d", state: "conflict" },
        ],
      },
    ];
    const out = computeSyncState(reports);
    expect(out.items.find((i) => i.id === "a")!.direction).toBe("synced");
    expect(out.items.find((i) => i.id === "b")!.direction).toBe("behind");
    // drift/conflict with no hashes → surface as a decision, never silent
    expect(out.items.find((i) => i.id === "c")!.exception).toBe("diverged");
    expect(out.items.find((i) => i.id === "d")!.exception).toBe("diverged");
  });
});

describe("classifyPushSafety", () => {
  it("ok when remote head matches what we last synced", () => {
    expect(classifyPushSafety("abc123", "abc123")).toBe("ok");
  });
  it("ok when this machine has no recorded sync yet (first push)", () => {
    expect(classifyPushSafety(undefined, "abc123")).toBe("ok");
  });
  it("pull-first when remote advanced past our last sync", () => {
    expect(classifyPushSafety("abc123", "def456")).toBe("pull-first");
  });
});
