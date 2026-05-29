import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Manage } from "./views/Manage";

// Mock with realistic server shapes: selection has .modules, status has reports[].items[].state
vi.mock("./api", () => ({
  getSelection: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    modules: {
      dotfiles: ["~/.zshrc", "~/.vimrc"],
      packages: ["homebrew"],
    },
  }),
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
          { id: "homebrew", state: "conflict" },
        ],
      },
    ],
  }),
}));

describe("Manage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders module names from selection.modules (not Object.keys(selection))", async () => {
    render(<Manage />);
    await waitFor(() => {
      expect(screen.getByText("dotfiles")).toBeTruthy();
      expect(screen.getByText("packages")).toBeTruthy();
    });
  });

  it("shows correct module count from selection.modules", async () => {
    render(<Manage />);
    await waitFor(() => {
      expect(screen.getByText(/Managed 2 modules/i)).toBeTruthy();
    });
  });

  it("renders drift status for dotfiles (has a drift item)", async () => {
    render(<Manage />);
    await waitFor(() => {
      // dotfiles has a drift item so its derived status is "drift"
      // StatusDot renders with aria-label=status; look for drift or conflict dots
      const statusDots = screen.getAllByRole("status");
      const labels = statusDots.map((el) => el.getAttribute("aria-label"));
      expect(labels).toContain("drift");
    });
  });

  it("renders conflict status for packages (has a conflict item)", async () => {
    render(<Manage />);
    await waitFor(() => {
      const statusDots = screen.getAllByRole("status");
      const labels = statusDots.map((el) => el.getAttribute("aria-label"));
      expect(labels).toContain("conflict");
    });
  });

  it("does not read selection as flat keys (schemaVersion must not appear as module)", async () => {
    render(<Manage />);
    await waitFor(() => {
      // "schemaVersion" should NOT appear as a module name in the list
      expect(screen.queryByText("schemaVersion")).toBeNull();
    });
  });
});
