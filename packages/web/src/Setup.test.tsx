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
});
