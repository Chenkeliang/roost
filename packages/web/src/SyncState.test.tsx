import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { SyncState } from "./views/SyncState";

vi.mock("./api", () => ({
  getSyncState: vi.fn().mockResolvedValue({
    items: [],
    counts: { synced: 0, auto: 0, diverged: 0, blocked: 0, destructive: 0 },
    overall: "synced",
  }),
  postResolve: vi.fn().mockResolvedValue({ ok: true }),
  getItemDiff: vi.fn().mockResolvedValue({ text: "" }),
  getDiff: vi.fn(),
}));

describe("SyncState raw view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows all-synced message when getDiff returns empty diffs", async () => {
    const { getDiff } = await import("./api");
    vi.mocked(getDiff).mockResolvedValue({ diffs: [] });

    await act(async () => {
      render(<SyncState />);
    });

    // Switch to raw view
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Raw diff/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Everything is in sync/i)).toBeTruthy();
    });
  });

  it("renders module name and diff text when getDiff returns diffs", async () => {
    const { getDiff } = await import("./api");
    vi.mocked(getDiff).mockResolvedValue({
      diffs: [
        {
          module: "dotfiles",
          text: "--- a/.zshrc\n+++ b/.zshrc\n@@ -1 +1 @@\n-old\n+new",
        },
      ],
    });

    await act(async () => {
      render(<SyncState />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Raw diff/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("dotfiles")).toBeTruthy();
    });

    expect(vi.mocked(getDiff)).toHaveBeenCalledTimes(1);
  });

  it("calls getDiff only once even when switching views multiple times", async () => {
    const { getDiff } = await import("./api");
    vi.mocked(getDiff).mockResolvedValue({
      diffs: [{ module: "packages", text: "+brew" }],
    });

    await act(async () => {
      render(<SyncState />);
    });

    // Switch to raw
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Raw diff/i }));
    });
    await waitFor(() => screen.getByText("packages"));

    // Switch back to items
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Items$/i }));
    });

    // Switch to raw again — getDiff must NOT be called a second time
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Raw diff/i }));
    });

    await waitFor(() => screen.getByText("packages"));
    expect(vi.mocked(getDiff)).toHaveBeenCalledTimes(1);
  });
});

