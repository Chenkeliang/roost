import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { Timeline } from "./views/Timeline";
import * as api from "./api";

vi.mock("./api", () => ({
  getTimeline: vi.fn(),
  getFileHistory: vi.fn(),
  restoreFileVersion: vi.fn(),
}));

describe("Timeline — file history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTimeline).mockResolvedValue({
      entries: [
        { sha: "abc1234567", subject: "capture: dotfiles(1)", date: "2026-05-29T10:00:00Z" },
        { sha: "def9876543", subject: "capture: dotfiles(2)", date: "2026-05-28T08:00:00Z" },
      ],
    });
  });

  it("shows a file's history and restores a version", async () => {
    vi.mocked(api.getFileHistory).mockResolvedValue({
      entries: [
        { sha: "abc1234", subject: "capture: dotfiles(1)", date: "2026-05-29T10:00:00Z" },
        { sha: "def5678", subject: "capture: dotfiles(0)", date: "2026-05-28T08:00:00Z" },
      ],
    });
    vi.mocked(api.restoreFileVersion).mockResolvedValue({ ok: true, syncHint: true });

    await act(async () => { render(<Timeline />); });

    const input = await screen.findByPlaceholderText(/File path|要查看/);
    fireEvent.change(input, { target: { value: "~/.zshrc" } });
    screen.getByRole("button", { name: /Show history|查看历史/ }).click();

    // First entry (most recent) should show "current" label, no restore button
    await waitFor(() => {
      expect(screen.getByText("capture: dotfiles(1)")).toBeInTheDocument();
    });
    expect(screen.getByText(/current|当前版本/)).toBeInTheDocument();

    // Second entry has restore button
    const restoreButtons = screen.getAllByRole("button", { name: /Restore this version|恢复此版本/ });
    expect(restoreButtons.length).toBe(1);
    (restoreButtons[0] as HTMLButtonElement).click();

    await waitFor(() =>
      expect(api.restoreFileVersion).toHaveBeenCalledWith("~/.zshrc", "def5678"),
    );
    expect(await screen.findByText(/Sync Review|同步复核/)).toBeInTheDocument();
  });

  it("shows empty state when file has no history", async () => {
    vi.mocked(api.getFileHistory).mockResolvedValue({ entries: [] });

    await act(async () => { render(<Timeline />); });

    const input = await screen.findByPlaceholderText(/File path|要查看/);
    fireEvent.change(input, { target: { value: "~/.zshrc" } });
    screen.getByRole("button", { name: /Show history|查看历史/ }).click();

    await waitFor(() => {
      expect(screen.getByText(/not in your backups|不在备份/)).toBeInTheDocument();
    });
  });

  it("back button returns to snapshot list", async () => {
    vi.mocked(api.getFileHistory).mockResolvedValue({
      entries: [{ sha: "abc1234", subject: "capture: dotfiles(1)", date: "2026-05-29T10:00:00Z" }],
    });

    await act(async () => { render(<Timeline />); });

    const input = await screen.findByPlaceholderText(/File path|要查看/);
    fireEvent.change(input, { target: { value: "~/.zshrc" } });
    screen.getByRole("button", { name: /Show history|查看历史/ }).click();

    await waitFor(() => expect(screen.getByText("capture: dotfiles(1)")).toBeInTheDocument());

    screen.getByRole("button", { name: /All snapshots|全部快照/ }).click();

    await waitFor(() => {
      // Back to timeline view, should show original entries
      expect(screen.getByText("capture: dotfiles(1)")).toBeInTheDocument();
    });
  });

  it("calls onOpenSync when goSync button is clicked after restore", async () => {
    vi.mocked(api.getFileHistory).mockResolvedValue({
      entries: [
        { sha: "abc1234", subject: "capture: dotfiles(1)", date: "2026-05-29T10:00:00Z" },
        { sha: "def5678", subject: "capture: dotfiles(0)", date: "2026-05-28T08:00:00Z" },
      ],
    });
    vi.mocked(api.restoreFileVersion).mockResolvedValue({ ok: true, syncHint: true });
    const onOpenSync = vi.fn();

    await act(async () => { render(<Timeline onOpenSync={onOpenSync} />); });

    const input = await screen.findByPlaceholderText(/File path|要查看/);
    fireEvent.change(input, { target: { value: "~/.zshrc" } });
    screen.getByRole("button", { name: /Show history|查看历史/ }).click();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Restore this version|恢复此版本/ })).toBeTruthy());
    (screen.getAllByRole("button", { name: /Restore this version|恢复此版本/ })[0] as HTMLButtonElement).click();

    await waitFor(() => expect(screen.getByText(/Open Sync Review|去同步复核/)).toBeInTheDocument());
    screen.getByRole("button", { name: /Open Sync Review|去同步复核/ }).click();
    expect(onOpenSync).toHaveBeenCalled();
  });

  it("shows body when timeline entry has one (expandable)", async () => {
    vi.mocked(api.getTimeline).mockResolvedValue({
      entries: [
        {
          sha: "abc1234567",
          subject: "capture: dotfiles(2) packages(1)",
          date: "2026-05-29T10:00:00Z",
          body: "dotfiles: .zshrc\npackages: jq",
        },
      ],
    });

    await act(async () => { render(<Timeline />); });

    await waitFor(() => {
      expect(screen.getByText("capture: dotfiles(2) packages(1)")).toBeInTheDocument();
    });

    // Expand body
    const expandBtn = screen.getByRole("button", { name: /▾|▴/ });
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByText(/dotfiles: .zshrc/)).toBeInTheDocument();
    });
  });
});
