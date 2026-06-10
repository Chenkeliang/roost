import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StepAgeKey } from "./views/onboarding/StepAgeKey";
import * as api from "./api";

vi.mock("./api", () => ({ getKey: vi.fn() }));
const t = (k: string) => k;

describe("StepAgeKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows guidance when repo has encrypted content and no local key", async () => {
    vi.mocked(api.getKey).mockResolvedValue({ exists: false, recipient: null, keyPath: "/k/keys.txt", encryptedFiles: 3 });
    const onDone = vi.fn();
    render(<StepAgeKey t={t} onDone={onDone} />);
    expect(await screen.findByText("/k/keys.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "onboard.restore.key.recheck" })).toBeInTheDocument();
    // skip advances
    screen.getByRole("button", { name: "onboard.restore.key.skip" }).click();
    expect(onDone).toHaveBeenCalled();
  });

  it("shows ready + Next when a key already exists", async () => {
    vi.mocked(api.getKey).mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k/keys.txt", encryptedFiles: 3 });
    const onDone = vi.fn();
    render(<StepAgeKey t={t} onDone={onDone} />);
    const next = await screen.findByRole("button", { name: "onboard.next" });
    next.click();
    expect(onDone).toHaveBeenCalled();
  });

  it("re-check re-queries getKey", async () => {
    vi.mocked(api.getKey)
      .mockResolvedValueOnce({ exists: false, recipient: null, keyPath: "/k/keys.txt", encryptedFiles: 1 })
      .mockResolvedValueOnce({ exists: true, recipient: "age1", keyPath: "/k/keys.txt", encryptedFiles: 1 });
    render(<StepAgeKey t={t} onDone={() => {}} />);
    (await screen.findByRole("button", { name: "onboard.restore.key.recheck" })).click();
    await waitFor(() => expect(api.getKey).toHaveBeenCalledTimes(2));
  });
});
