import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StepCapture } from "./views/onboarding/StepCapture";
import * as api from "./api";

vi.mock("./api", () => ({
  getSelection: vi.fn(),
  getKey: vi.fn(),
  generateKey: vi.fn(),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
}));
const t = (k: string) => k;

describe("StepCapture", () => {
  beforeEach(() => vi.clearAllMocks());

  it("captures directly when no secret module is selected", async () => {
    vi.mocked(api.getSelection).mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["a"] } });
    const onDone = vi.fn();
    render(<StepCapture t={t} onDone={onDone} />);
    (await screen.findByRole("button", { name: "onboard.capture.btn" })).click();
    await waitFor(() => expect(api.postCapture).toHaveBeenCalled());
    expect(api.generateKey).not.toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("generates a key and forces the backup modal before capturing when env is selected and no key exists", async () => {
    vi.mocked(api.getSelection).mockResolvedValue({ schemaVersion: 1, modules: { env: ["e1"] } });
    vi.mocked(api.getKey).mockResolvedValue({ exists: false, recipient: null, keyPath: "/k/keys.txt", encryptedFiles: 0 });
    vi.mocked(api.generateKey).mockResolvedValue({ created: true, source: "generated", recipient: "age1abc", keyPath: "/k/keys.txt" });
    const onDone = vi.fn();
    render(<StepCapture t={t} onDone={onDone} />);
    (await screen.findByRole("button", { name: "onboard.capture.btn" })).click();
    // backup modal appears; capture is NOT called until acked
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(api.generateKey).toHaveBeenCalled());
    expect(api.postCapture).not.toHaveBeenCalled();
    dialog.querySelector("input[type=checkbox]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    screen.getByRole("button", { name: "onboard.key.continue" }).click();
    await waitFor(() => expect(api.postCapture).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
