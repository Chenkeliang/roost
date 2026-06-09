import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { Timeline } from "./views/Timeline";

vi.mock("./api", () => ({
  getTimeline: vi.fn(),
}));

describe("Timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders two snapshot entries when API returns two", async () => {
    const { getTimeline } = await import("./api");
    vi.mocked(getTimeline).mockResolvedValue({
      entries: [
        { sha: "abc123def456", subject: "feat: add dotfiles", date: "2026-05-29T10:00:00Z" },
        { sha: "deadbeef1234", subject: "chore: initial commit", date: "2026-05-28T08:30:00Z" },
      ],
    });

    await act(async () => { render(<Timeline />); });

    await waitFor(() => {
      // Short sha slices appear
      expect(screen.getByText("abc123de")).toBeTruthy();
      expect(screen.getByText("deadbeef")).toBeTruthy();
      // Subjects appear
      expect(screen.getByText("feat: add dotfiles")).toBeTruthy();
      expect(screen.getByText("chore: initial commit")).toBeTruthy();
    });
  });

  it("shows empty-state when entries array is empty", async () => {
    const { getTimeline } = await import("./api");
    vi.mocked(getTimeline).mockResolvedValue({ entries: [] });

    await act(async () => { render(<Timeline />); });

    await waitFor(() => {
      expect(screen.getByText(/No snapshots yet/i)).toBeTruthy();
    });
  });

  it("shows error state when API rejects", async () => {
    const { getTimeline } = await import("./api");
    vi.mocked(getTimeline).mockRejectedValue(new Error("network error"));

    await act(async () => { render(<Timeline />); });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/network error/i)).toBeTruthy();
    });
  });
});
