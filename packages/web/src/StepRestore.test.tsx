import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StepRestore } from "./views/onboarding/StepRestore";
import * as api from "./api";

vi.mock("./api", () => ({ postLoad: vi.fn() }));
const t = (k: string) => k;

describe("StepRestore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews on mount (dry-run) and applies on Apply all → onComplete", async () => {
    vi.mocked(api.postLoad)
      .mockResolvedValueOnce({ results: [{ module: "dotfiles", applied: [], backedUp: [], skipped: ["a", "b"] }] }) // dry-run
      .mockResolvedValueOnce({ results: [{ module: "dotfiles", applied: ["a", "b"], backedUp: ["a"], skipped: [] }] }); // apply
    const onComplete = vi.fn();
    render(<StepRestore t={t} onComplete={onComplete} />);
    const apply = await screen.findByRole("button", { name: "onboard.restore.applyAll" });
    await waitFor(() => expect(api.postLoad).toHaveBeenCalledWith(false));
    apply.click();
    await waitFor(() => expect(api.postLoad).toHaveBeenCalledWith(true));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it("on a blocked apply, shows blockers and routes to Sync Review", async () => {
    vi.mocked(api.postLoad)
      .mockResolvedValueOnce({ results: [{ module: "env", applied: [], backedUp: [], skipped: ["e1"] }] })
      .mockResolvedValueOnce({ results: [], blocked: true, blockers: [{ name: "env: age key", detail: "missing key" }] });
    const onComplete = vi.fn();
    const onOpenSync = vi.fn();
    render(<StepRestore t={t} onComplete={onComplete} onOpenSync={onOpenSync} />);
    (await screen.findByRole("button", { name: "onboard.restore.applyAll" })).click();
    expect(await screen.findByText(/env: age key/)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    screen.getAllByRole("button", { name: "onboard.restore.openSync" })[0]!.click();
    expect(onOpenSync).toHaveBeenCalled();
  });
});
