import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Overview } from "./views/Overview";

// Mock the api module
vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "roost" }),
  getMachines: vi.fn().mockResolvedValue({ hosts: ["macbook.local"], states: {} }),
  getStatus: vi.fn().mockResolvedValue({
    reports: [
      { module: "dotfiles", status: "synced", items: [{ id: "~/.zshrc", status: "synced" }] },
      { module: "packages", status: "drift", items: [] },
    ],
  }),
  postCapture: vi.fn().mockResolvedValue({ changes: [{ module: "dotfiles", id: "~/.zshrc", action: "update" }] }),
  postLoad: vi.fn().mockResolvedValue({ changes: [], dryRun: true }),
}));

describe("Overview", () => {
  const noop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders module health section header", async () => {
    render(<Overview showHud={noop} />);
    await waitFor(() => {
      expect(screen.getByText("Module Health")).toBeTruthy();
    });
  });

  it("renders module status chips after loading", async () => {
    render(<Overview showHud={noop} />);
    await waitFor(() => {
      // Both module names should appear in the health chips
      expect(screen.getByText("dotfiles")).toBeTruthy();
      expect(screen.getByText("packages")).toBeTruthy();
    });
  });

  it("renders capture and load buttons", async () => {
    render(<Overview showHud={noop} />);
    // Capture button is always in the DOM; wait for loading to settle
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Capture/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Load/i })).toBeTruthy();
    });
  });
});
