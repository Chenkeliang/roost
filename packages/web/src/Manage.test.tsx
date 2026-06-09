import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { Manage } from "./views/Manage";

// Mock with realistic server shapes
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
        items: [{ id: "homebrew", state: "conflict" }],
      },
    ],
  }),
  getDiscover: vi.fn().mockResolvedValue({
    candidates: {
      dotfiles: [
        { id: "~/.bashrc", path: "/home/user/.bashrc", category: "shell", recommendation: "track" },
        { id: "~/.zshrc", path: "/home/user/.zshrc", category: "shell", recommendation: "track" },
      ],
      packages: [],
    },
  }),
  removeSelection: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    modules: { dotfiles: ["~/.vimrc"], packages: ["homebrew"] },
  }),
  addSelection: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    modules: { dotfiles: ["~/.zshrc", "~/.vimrc", "~/.bashrc"], packages: ["homebrew"] },
  }),
}));

describe("Manage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders module names from selection.modules (not Object.keys(selection))", async () => {
    await act(async () => { render(<Manage />); });
    await waitFor(() => {
      expect(screen.getByText("dotfiles")).toBeTruthy();
      expect(screen.getByText("packages")).toBeTruthy();
    });
  });

  it("shows correct module count from selection.modules", async () => {
    await act(async () => { render(<Manage />); });
    await waitFor(() => {
      expect(screen.getByText(/Managed 2 modules/i)).toBeTruthy();
    });
  });

  it("renders drift status for dotfiles (has a drift item)", async () => {
    await act(async () => { render(<Manage />); });
    await waitFor(() => {
      const statusDots = screen.getAllByRole("status");
      const labels = statusDots.map((el) => el.getAttribute("aria-label"));
      expect(labels).toContain("drift");
    });
  });

  it("renders conflict status for packages (has a conflict item)", async () => {
    await act(async () => { render(<Manage />); });
    await waitFor(() => {
      const statusDots = screen.getAllByRole("status");
      const labels = statusDots.map((el) => el.getAttribute("aria-label"));
      expect(labels).toContain("conflict");
    });
  });

  it("does not read selection as flat keys (schemaVersion must not appear as module)", async () => {
    await act(async () => { render(<Manage />); });
    await waitFor(() => {
      expect(screen.queryByText("schemaVersion")).toBeNull();
    });
  });

  it("Remove button calls removeSelection with correct args", async () => {
    const { removeSelection } = await import("./api");
    const removeMock = vi.mocked(removeSelection);

    await act(async () => { render(<Manage />); });

    // Wait for content to load
    await waitFor(() => screen.getByText("~/.zshrc"));

    // Hover over the item row to reveal Remove button
    const zshrcRow = screen.getByText("~/.zshrc").closest("[role='row']")!;
    fireEvent.mouseEnter(zshrcRow);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Remove/i }).length).toBeGreaterThan(0);
    });

    const removeBtn = screen.getAllByRole("button", { name: /Remove ~\/.zshrc/i })[0]!;
    await act(async () => { fireEvent.click(removeBtn); });

    expect(removeMock).toHaveBeenCalledWith("dotfiles", "~/.zshrc");
  });

  it("Add button calls addSelection with correct args", async () => {
    const { addSelection } = await import("./api");
    const addMock = vi.mocked(addSelection);

    await act(async () => { render(<Manage />); });

    await waitFor(() => screen.getByText("dotfiles"));

    // Open the Add items panel for dotfiles
    const addItemsButtons = screen.getAllByRole("button", { name: /Add items/i });
    await act(async () => { fireEvent.click(addItemsButtons[0]!); });

    // .bashrc is untracked (not in selectedIds), .zshrc is already tracked
    await waitFor(() => {
      expect(screen.getByText("~/.bashrc")).toBeTruthy();
    });

    const addBtn = screen.getByRole("button", { name: /^Add$/ });
    await act(async () => { fireEvent.click(addBtn); });

    expect(addMock).toHaveBeenCalledWith("dotfiles", "~/.bashrc");
  });
});
