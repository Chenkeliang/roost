import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { Overview } from "./views/Overview";
import * as api from "./api";

// Mock with realistic server shapes matching server.ts actual responses
vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "roost" }),
  getEnvironment: vi.fn().mockResolvedValue({ checks: [] }),
  getMachines: vi.fn().mockResolvedValue({ hosts: ["macbook.local"], states: {} }),
  getStatus: vi.fn().mockResolvedValue({
    reports: [
      {
        module: "dotfiles",
        items: [
          { id: "~/.zshrc", state: "synced" },
          { id: "~/.vimrc", state: "drift" },
        ],
      },
      {
        module: "packages",
        items: [
          { id: "homebrew", state: "synced" },
        ],
      },
    ],
  }),
  postCapture: vi.fn().mockResolvedValue({
    changes: [{ module: "dotfiles", written: ["~/.zshrc"], encrypted: [] }],
  }),
  postLoad: vi.fn().mockResolvedValue({
    results: [{ module: "dotfiles", applied: ["~/.zshrc"], backedUp: [], skipped: [] }],
  }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  removeSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
}));

describe("Overview", () => {
  const noop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders module health section header", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      expect(screen.getByText("Module Health")).toBeTruthy();
    });
  });

  it("renders module status chips after loading — using server item.state", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      // Both module names appear in health chips
      expect(screen.getByText("dotfiles")).toBeTruthy();
      expect(screen.getByText("packages")).toBeTruthy();
    });
  });

  it("derives drift status from items (dotfiles has a drift item)", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      // dotfiles module has a drift item — StatusDot aria-label should include "drift"
      const driftDots = screen.getAllByRole("status", { name: "drift" });
      expect(driftDots.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders capture and review buttons", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Capture/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Review & restore/i })).toBeTruthy();
    });
  });

  it("shows one real machine card and an honest empty state when there is no second machine", async () => {
    await act(async () => {
      render(<Overview showHud={noop} />);
    });
    // Real hostname from /api/health, not a hardcoded follower.
    await waitFor(() => expect(screen.getAllByText(/macbook\.local|roost/).length).toBeGreaterThanOrEqual(1));
    // No fake follower.
    expect(screen.queryByText("Mac mini")).not.toBeInTheDocument();
    // Honest empty state for the absent second machine.
    expect(screen.getByText(/No other machine yet/i)).toBeInTheDocument();
  });

  it("renders a too-large blocked item with a Remove action (not encrypt-retry) that calls removeSelection", async () => {
    vi.mocked(api.postCapture).mockResolvedValueOnce({
      changes: [
        {
          module: "dotfiles",
          written: [],
          encrypted: [],
          blocked: ["/x"],
          blockedDetail: [{ id: "/x", reason: "too-large", detail: "160MB" }],
        },
      ],
    });
    await act(async () => { render(<Overview showHud={noop} />); });
    const captureBtn = await screen.findByRole("button", { name: /Capture/i });
    await act(async () => { fireEvent.click(captureBtn); });

    const removeBtn = await screen.findByRole("button", { name: /Remove|移除/i });
    expect(removeBtn).toBeTruthy();
    // A too-large item must NOT offer encrypt-retry.
    expect(screen.queryByRole("button", { name: /Encrypt & retry|加密并重试/i })).toBeNull();

    await act(async () => { fireEvent.click(removeBtn); });
    await waitFor(() => {
      expect(api.removeSelection).toHaveBeenCalledWith("dotfiles", "/x");
    });
  });

  it("the review button navigates to Sync Review (calls onOpenSync)", async () => {
    const onOpenSync = vi.fn();
    await act(async () => { render(<Overview showHud={noop} onOpenSync={onOpenSync} />); });
    const reviewBtn = await screen.findByRole("button", { name: /Review & restore/i });
    fireEvent.click(reviewBtn);
    await waitFor(() => {
      expect(onOpenSync).toHaveBeenCalled();
    });
  });
});
