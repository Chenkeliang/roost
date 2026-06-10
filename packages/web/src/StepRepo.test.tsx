import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StepRepo } from "./views/onboarding/StepRepo";
import * as api from "./api";

vi.mock("./api", () => ({
  postInit: vi.fn().mockResolvedValue({ created: ["/r/roost"], isRepo: true, remote: null }),
  postClone: vi.fn().mockResolvedValue({ ok: true }),
}));
const t = (k: string) => k;

describe("StepRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create: calls postInit with the remote URL and advances", async () => {
    const onDone = vi.fn();
    render(<StepRepo t={t} onDone={onDone} />);
    fireEvent.change(screen.getByPlaceholderText("onboard.repo.remoteOptional"), { target: { value: "git@x:y.git" } });
    screen.getByRole("button", { name: "onboard.repo.createBtn" }).click();
    await waitFor(() => expect(api.postInit).toHaveBeenCalledWith("git@x:y.git"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("clone: shows the error and does NOT advance when postClone fails", async () => {
    vi.mocked(api.postClone).mockResolvedValueOnce({ ok: false, error: "destination exists" });
    const onDone = vi.fn();
    render(<StepRepo t={t} onDone={onDone} />);
    screen.getByRole("button", { name: "onboard.repo.cloneTab" }).click();
    fireEvent.change(screen.getByPlaceholderText("onboard.repo.cloneUrl"), { target: { value: "git@x:y.git" } });
    screen.getByRole("button", { name: "onboard.repo.cloneBtn" }).click();
    await waitFor(() => expect(screen.getByText("destination exists")).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});
