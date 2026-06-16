import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Setup } from "./views/Setup";
import * as api from "./api";
import type { EnvCheck } from "./api";

vi.mock("./api", () => ({ getEnvironment: vi.fn(), postBrewInstall: vi.fn() }));

describe("Setup onReady", () => {
  beforeEach(() => vi.clearAllMocks());
  it("calls onReady(true) when all required checks pass", async () => {
    const checks: EnvCheck[] = [{ id: "git", ok: true, required: true }, { id: "age-key", ok: false, required: false }];
    vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
    const onReady = vi.fn();
    render(<Setup embedded onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(true));
  });
  it("calls onReady(false) when a required check fails", async () => {
    const checks: EnvCheck[] = [{ id: "git", ok: false, required: true }];
    vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
    const onReady = vi.fn();
    render(<Setup embedded onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(false));
  });

  it("labels op/rbw and shows a ref-backend hint, not a Homebrew prompt", async () => {
    const checks: EnvCheck[] = [
      { id: "brew", ok: true, required: true },
      { id: "op", ok: false, required: false },
      { id: "rbw", ok: true, required: false },
    ];
    vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
    const { queryByText, getByText } = render(<Setup embedded />);
    await waitFor(() => expect(getByText("1Password CLI (op)")).toBeInTheDocument());
    expect(getByText("rbw (Bitwarden)")).toBeInTheDocument();
    // no raw i18n keys leak through
    expect(queryByText("setup.check.op")).toBeNull();
    expect(queryByText("setup.check.rbw")).toBeNull();
    // op (optional, no brew formula) must NOT show the misleading Homebrew hint
    expect(queryByText("Install Homebrew first, then re-check.")).toBeNull();
    expect(getByText(/optional, for op/i)).toBeInTheDocument();
  });
});
