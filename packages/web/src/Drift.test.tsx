import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { Drift } from "./views/Drift";

vi.mock("./api", () => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
}));

describe("Drift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty-state when no modules have drift", async () => {
    const { getStatus } = await import("./api");
    vi.mocked(getStatus).mockResolvedValue({
      reports: [
        { module: "dotfiles", items: [{ id: "~/.zshrc", state: "synced" }] },
      ],
    });

    await act(async () => { render(<Drift />); });

    await waitFor(() => {
      expect(screen.getByText(/No drift detected/i)).toBeTruthy();
    });
  });

  it("renders drifted module row when a module has drift items", async () => {
    const { getStatus } = await import("./api");
    vi.mocked(getStatus).mockResolvedValue({
      reports: [
        {
          module: "dotfiles",
          items: [{ id: "~/.zshrc", state: "drift" }],
        },
      ],
    });

    await act(async () => { render(<Drift />); });

    await waitFor(() => {
      expect(screen.getByText("dotfiles")).toBeTruthy();
      expect(screen.getByRole("button", { name: /View diff/i })).toBeTruthy();
    });
  });

  it("shows diff text after clicking View diff", async () => {
    const { getStatus, getDiff } = await import("./api");
    vi.mocked(getStatus).mockResolvedValue({
      reports: [
        {
          module: "dotfiles",
          items: [{ id: "~/.zshrc", state: "drift" }],
        },
      ],
    });
    vi.mocked(getDiff).mockResolvedValue({
      diffs: [
        {
          module: "dotfiles",
          text: "--- a/.zshrc\n+++ b/.zshrc\n@@ -1 +1 @@\n-old line\n+new line",
        },
      ],
    });

    await act(async () => { render(<Drift />); });

    await waitFor(() => screen.getByRole("button", { name: /View diff/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /View diff/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("+new line")).toBeTruthy();
      expect(screen.getByText("-old line")).toBeTruthy();
    });
  });

  it("calls getDiff only once even if View diff is toggled again", async () => {
    const { getStatus, getDiff } = await import("./api");
    vi.mocked(getStatus).mockResolvedValue({
      reports: [{ module: "packages", items: [{ id: "brew", state: "conflict" }] }],
    });
    vi.mocked(getDiff).mockResolvedValue({ diffs: [{ module: "packages", text: "+brew" }] });

    await act(async () => { render(<Drift />); });
    await waitFor(() => screen.getByRole("button", { name: /View diff/i }));

    // First click: open diff
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /View diff/i })); });
    await waitFor(() => screen.getByText("+brew"));

    // Second click: close
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /View diff/i })); });

    // Third click: re-open — getDiff should NOT be called again
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /View diff/i })); });
    await waitFor(() => screen.getByText("+brew"));

    expect(vi.mocked(getDiff)).toHaveBeenCalledTimes(1);
  });
});
