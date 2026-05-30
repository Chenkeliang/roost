import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { Packages } from "./views/Packages";

vi.mock("./api", () => ({
  getIndex: vi.fn().mockResolvedValue({ index: { packages: { available: true, managed: 2 } } }),
  getBrewfile: vi.fn().mockResolvedValue({
    available: true,
    exists: true,
    entries: { taps: ["homebrew/services"], formulae: ["git"], casks: ["firefox"], mas: [] },
  }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { packages: ["Brewfile"] } }),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
}));

describe("Packages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("brew absent → honest 'not installed' empty state, no brewfile list", async () => {
    const api = await import("./api");
    (api.getBrewfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      available: false,
      exists: false,
      entries: { taps: [], formulae: [], casks: [], mas: [] },
    });
    await act(async () => { render(<Packages showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText(/not installed/i)).toBeInTheDocument());
    expect(screen.queryByText(/Formulae/)).not.toBeInTheDocument();
  });

  it("brew present + entries → renders a formula and a cask in their sections", async () => {
    await act(async () => { render(<Packages showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("git")).toBeInTheDocument());
    expect(screen.getByText("firefox")).toBeInTheDocument();
    expect(screen.getByText(/Formulae/)).toBeInTheDocument();
    expect(screen.getByText(/Casks/)).toBeInTheDocument();
  });
});
