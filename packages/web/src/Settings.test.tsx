import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { Settings } from "./views/Settings";

vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({
    ok: true,
    name: "roost",
    repoDir: "/Users/testuser/.local/share/roost/repo",
    ageKey: true,
  }),
  getModules: vi.fn().mockResolvedValue({ modules: ["dotfiles", "packages"] }),
}));

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the real repoDir from /api/health", async () => {
    await act(async () => { render(<Settings />); });
    await waitFor(() => {
      expect(screen.getByText("/Users/testuser/.local/share/roost/repo")).toBeTruthy();
    });
  });

  it("shows age key status as 'present' when ageKey=true", async () => {
    await act(async () => { render(<Settings />); });
    await waitFor(() => {
      expect(screen.getByText("present")).toBeTruthy();
    });
  });

  it("shows age key status as 'not found' when ageKey=false", async () => {
    const { getHealth } = await import("./api");
    vi.mocked(getHealth).mockResolvedValueOnce({
      ok: true,
      name: "roost",
      repoDir: "/some/repo",
      ageKey: false,
    });
    await act(async () => { render(<Settings />); });
    await waitFor(() => {
      expect(screen.getByText("not found")).toBeTruthy();
    });
  });

  it("shows registered module names", async () => {
    await act(async () => { render(<Settings />); });
    await waitFor(() => {
      expect(screen.getByText("dotfiles")).toBeTruthy();
      expect(screen.getByText("packages")).toBeTruthy();
    });
  });

  it("links to the real repo and exposes a Documentation entry", async () => {
    await act(async () => {
      render(<Settings />);
    });
    const docsLinks = await screen.findAllByText(/Documentation/i);
    const docsLink = docsLinks.find((el) => el.closest("a") !== null);
    expect(docsLink).toBeDefined();
    expect(docsLink!.closest("a")?.getAttribute("href")).toContain("github.com/Chenkeliang/roost");
    // No placeholder org remains.
    document.querySelectorAll("a").forEach((a) => {
      expect(a.getAttribute("href") ?? "").not.toContain("your-org");
    });
  });
});
