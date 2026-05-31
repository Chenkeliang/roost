import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { Dotfiles } from "./views/Dotfiles";

vi.mock("./api", () => ({
  getIndex: vi.fn().mockResolvedValue({ index: { dotfiles: { available: true, managed: 2 } } }),
  getDotfiles: vi.fn().mockResolvedValue({ available: true, managed: ["~/.zshrc", "~/.gitconfig"] }),
  getDiscoverModule: vi.fn().mockResolvedValue({
    candidates: { dotfiles: [{ id: "~/.vimrc", path: "~/.vimrc", category: "editor", recommendation: "include" }] },
  }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["~/.vimrc"] } }),
  removeSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: [] } }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["~/.zshrc", "~/.gitconfig"] } }),
}));

describe("Dotfiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("chezmoi absent → honest 'not installed' empty state, no list", async () => {
    const api = await import("./api");
    (api.getDotfiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ available: false, managed: [] });
    await act(async () => { render(<Dotfiles showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText(/not installed/i)).toBeInTheDocument());
    expect(screen.queryByText("~/.zshrc")).not.toBeInTheDocument();
  });

  it("available + managed → renders paths; filter narrows to one", async () => {
    await act(async () => { render(<Dotfiles showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("~/.zshrc")).toBeInTheDocument());
    expect(screen.getByText("~/.gitconfig")).toBeInTheDocument();

    const filter = screen.getByPlaceholderText(/filter/i);
    await act(async () => { fireEvent.change(filter, { target: { value: "zsh" } }); });
    expect(screen.getByText("~/.zshrc")).toBeInTheDocument();
    expect(screen.queryByText("~/.gitconfig")).not.toBeInTheDocument();
  });

  it("Scan calls getDiscoverModule('dotfiles') and Add calls addSelection", async () => {
    const api = await import("./api");
    await act(async () => { render(<Dotfiles showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("~/.zshrc")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /scan for dotfiles/i })); });
    expect(api.getDiscoverModule).toHaveBeenCalledWith("dotfiles");
    await waitFor(() => expect(screen.getByText("~/.vimrc")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /add ~\/\.vimrc/i })); });
    expect(api.addSelection).toHaveBeenCalledWith("dotfiles", "~/.vimrc");
  });
});
