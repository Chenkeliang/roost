import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LargeFilesAdvisory } from "./components/LargeFilesAdvisory";
import * as api from "./api";

vi.mock("./api", () => ({ excludeDotfile: vi.fn().mockResolvedValue({ ok: true }), addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }) }));
const t = (k: string) => k;

describe("LargeFilesAdvisory", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders nothing when there are no large items", () => {
    const { container } = render(<LargeFilesAdvisory t={t} items={[]} onChanged={() => {}} />);
    expect(container.textContent).toBe("");
  });
  it("expands to list items and excludes one (repo-side only)", async () => {
    const onChanged = vi.fn();
    render(<LargeFilesAdvisory t={t} items={[{ path: "/u/.config/big.bin", mb: 25 }]} onChanged={onChanged} />);
    screen.getByRole("button", { name: "large.expand" }).click();
    expect(await screen.findByText(/big\.bin/)).toBeInTheDocument();
    screen.getByRole("button", { name: "large.remove" }).click();
    await waitFor(() => expect(api.excludeDotfile).toHaveBeenCalledWith("/u/.config/big.bin"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("keep button approves the file via dotfiles-large-ok and refreshes", async () => {
    const onChanged = vi.fn();
    render(<LargeFilesAdvisory t={t} items={[{ path: "/u/.config/big.bin", mb: 25 }]} onChanged={onChanged} />);
    screen.getByRole("button", { name: "large.expand" }).click();
    (await screen.findByRole("button", { name: "large.keep" })).click();
    await waitFor(() => expect(api.addSelection).toHaveBeenCalledWith("dotfiles-large-ok", "/u/.config/big.bin"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

});
