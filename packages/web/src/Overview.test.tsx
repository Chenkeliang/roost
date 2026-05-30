import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { Overview } from "./views/Overview";

// Mock with realistic server shapes matching server.ts actual responses
vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "roost" }),
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

  it("renders capture and load buttons", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Capture/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Load/i })).toBeTruthy();
    });
  });

  it("does not render with old shape: result.changes (must use result.results)", async () => {
    // The mock returns { results: [...] } not { changes: [...] } — if Overview
    // accidentally reads .changes it would get undefined and show "0 results"
    // or crash. This test confirms the HUD fires with the results count.
    const showHud = vi.fn();
    await act(async () => { render(<Overview showHud={showHud} />); });
    const loadBtn = await screen.findByRole("button", { name: /Load \(dry-run\)/i });
    fireEvent.click(loadBtn);
    await waitFor(() => {
      expect(showHud).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("1") })
      );
    });
  });
});
