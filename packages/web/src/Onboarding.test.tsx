import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Onboarding } from "./views/onboarding/Onboarding";
import * as api from "./api";
import type { EnvCheck } from "./api";

vi.mock("./api", () => ({
  getGitStatus: vi.fn().mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true }),
  postInit: vi.fn().mockResolvedValue({ created: [], isRepo: true, remote: "git@x:y.git" }),
  postClone: vi.fn().mockResolvedValue({ ok: true }),
  getEnvironment: vi.fn(),
  postBrewInstall: vi.fn(),
  getDiscover: vi.fn().mockResolvedValue({ candidates: { dotfiles: [{ id: "a", path: "~/.zshrc" }] } }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["a"] } }),
  getKey: vi.fn().mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k", encryptedFiles: 0 }),
  generateKey: vi.fn(),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
  postLoad: vi.fn(),
  gitPush: vi.fn().mockResolvedValue({ ok: true, output: "" }),
}));
const t = (k: string) => k;

describe("Onboarding flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const checks: EnvCheck[] = [{ id: "git", ok: true, required: true }];
    vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
  });

  it("walks repo → check → select → capture → push → onComplete", async () => {
    vi.mocked(api.getSelection).mockResolvedValueOnce({ schemaVersion: 1, modules: {} }); // afterRepo: empty → build mode
    const onComplete = vi.fn();
    render(<Onboarding t={t} onComplete={onComplete} />);

    // Step 1 repo
    screen.getByRole("button", { name: "onboard.repo.createBtn" }).click();
    await waitFor(() => expect(api.postInit).toHaveBeenCalled());

    // Step 2 check → Next enabled once env ready
    const next = await screen.findByRole("button", { name: "onboard.next" });
    await waitFor(() => expect(next).not.toBeDisabled());
    next.click();

    // Step 3 select
    (await screen.findByRole("button", { name: "onboard.select.confirm" })).click();
    await waitFor(() => expect(api.addSelection).toHaveBeenCalledWith("dotfiles", "a"));

    // Step 4 capture — wait until the selection summary loads (button enabled)
    const captureBtn = await screen.findByRole("button", { name: "onboard.capture.btn" });
    await waitFor(() => expect(captureBtn).not.toBeDisabled());
    captureBtn.click();
    await waitFor(() => expect(api.postCapture).toHaveBeenCalled());

    // Step 5 push
    (await screen.findByRole("button", { name: "onboard.push.btn" })).click();
    await waitFor(() => expect(api.gitPush).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it("branches to the restore track when the cloned repo already has a selection", async () => {
    // existing repo with content → restore
    vi.mocked(api.getSelection).mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["a"] } });
    vi.mocked(api.getKey).mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k", encryptedFiles: 0 });
    vi.mocked(api.postLoad).mockResolvedValue({ results: [{ module: "dotfiles", applied: [], backedUp: [], skipped: ["a"] }] });
    const onComplete = vi.fn();
    render(<Onboarding t={t} onComplete={onComplete} />);

    // Step 1: clone path
    screen.getByRole("button", { name: "onboard.repo.cloneTab" }).click();
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByPlaceholderText("onboard.repo.cloneUrl"), { target: { value: "git@x:y.git" } });
    screen.getByRole("button", { name: "onboard.repo.cloneBtn" }).click();
    await waitFor(() => expect(api.postClone).toHaveBeenCalled());

    // Step 2: check → Next
    const next = await screen.findByRole("button", { name: "onboard.next" });
    await waitFor(() => expect(next).not.toBeDisabled());
    next.click();

    await waitFor(() => expect(api.getSelection).toHaveBeenCalled()); // wait for mode to be set

    // Step 3 (restore): age key auto-ready (encryptedFiles:0) → Next
    (await screen.findByRole("button", { name: "onboard.next" })).click();

    // Step 4 (restore): the Apply-all button proves we're on the restore track, NOT capture
    expect(await screen.findByRole("button", { name: "onboard.restore.applyAll" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "onboard.capture.btn" })).toBeNull();
  });
});
