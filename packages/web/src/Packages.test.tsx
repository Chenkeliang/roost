import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { Packages } from "./views/Packages";

vi.mock("./api", () => ({
  getIndex: vi.fn().mockResolvedValue({ index: { packages: { available: true, managed: 2 } } }),
  getBrewfile: vi.fn().mockResolvedValue({
    available: true,
    exists: true,
    entries: { taps: ["homebrew/services"], formulae: ["git"], casks: ["firefox"], mas: [] },
  }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { packages: ["brew:git", "brew:age", "cask:firefox"] } }),
  getPackageStates: vi.fn().mockResolvedValue({ states: { "brew:git": "outdated", "brew:age": "installed", "cask:firefox": "missing" } }),
  getDiscoverModule: vi.fn().mockResolvedValue({
    candidates: { packages: [{ id: "brew:fd", path: "roost/Brewfile", category: "packages", recommendation: "track", note: "formula" }] },
  }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  removeSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  installPackages: vi.fn().mockResolvedValue({ ok: true, installed: 2, output: "" }),
}));

describe("Packages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("brew absent → honest 'not installed' empty state", async () => {
    const api = await import("./api");
    (api.getBrewfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      available: false, exists: false, entries: { taps: [], formulae: [], casks: [], mas: [] },
    });
    await act(async () => { render(<Packages showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText(/not installed/i)).toBeInTheDocument());
  });

  it("Selected tab lists per-package selection with a Remove action", async () => {
    await act(async () => { render(<Packages showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("git")).toBeInTheDocument());
    expect(screen.getByText("firefox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove brew:git/i })).toBeInTheDocument();
  });

  it("shows per-package status badges from getPackageStates", async () => {
    await act(async () => { render(<Packages showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("git")).toBeInTheDocument());
    // git is outdated → "Update available"; age installed; firefox missing.
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.getByText("Not installed")).toBeInTheDocument();
  });

  it("Install all calls installPackages with the selected ids", async () => {
    const api = await import("./api");
    await act(async () => { render(<Packages showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("git")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /install all/i })); });
    expect(api.installPackages).toHaveBeenCalledWith(["brew:age", "brew:git", "cask:firefox"]);
  });

  it("Scan calls getDiscoverModule('packages')", async () => {
    const api = await import("./api");
    await act(async () => { render(<Packages showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("git")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /scan installed packages/i })); });
    expect(api.getDiscoverModule).toHaveBeenCalledWith("packages");
  });
});
