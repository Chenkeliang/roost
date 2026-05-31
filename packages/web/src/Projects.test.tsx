import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { Projects } from "./views/Projects";

vi.mock("./api", () => ({
  getIndex: vi.fn().mockResolvedValue({ index: { projects: { available: true, managed: 0 } } }),
  getDiscoverModule: vi.fn().mockResolvedValue({
    candidates: {
      projects: [
        { id: "/Users/k/work/a", path: "/Users/k/work/a", category: "projects", recommendation: "track", remote: "git@github.com:u/a.git", host: "github.com", protocol: "ssh" },
        { id: "/Users/k/work/b", path: "/Users/k/work/b", category: "projects", recommendation: "track", remote: "git@gitlab.luojilab.com:t/b.git", host: "gitlab.luojilab.com", protocol: "ssh" },
      ],
    },
  }),
  testProjectRemote: vi.fn().mockResolvedValue({ reachable: true, message: "reachable" }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { projects: ["/Users/k/work/a"] } }),
  removeSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { projects: [] } }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { projects: [] } }),
}));

describe("Projects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scans on demand and groups discovered repos by host", async () => {
    await act(async () => { render(<Projects showHud={vi.fn()} />); });
    // Scan is on-demand: nothing scanned until clicked.
    const scan = await screen.findByRole("button", { name: /scan/i });
    await act(async () => { fireEvent.click(scan); });
    await waitFor(() => expect(screen.getByText("github.com")).toBeInTheDocument());
    expect(screen.getByText("gitlab.luojilab.com")).toBeInTheDocument();
    // host filter chip narrows
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^github\.com/ })); });
    expect(screen.queryByText(/work\/b/)).not.toBeInTheDocument();
  });

  it("tests a remote and saves a project", async () => {
    const api = await import("./api");
    await act(async () => { render(<Projects showHud={vi.fn()} />); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /scan/i })); });
    await waitFor(() => screen.getByText(/work\/a/));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /test/i })[0]!); });
    await waitFor(() => expect(api.testProjectRemote).toHaveBeenCalledWith("git@github.com:u/a.git"));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /save/i })[0]!); });
    await waitFor(() => expect(api.addSelection).toHaveBeenCalledWith("projects", "/Users/k/work/a"));
  });
});
