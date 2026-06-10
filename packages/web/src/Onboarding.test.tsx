import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Onboarding } from "./views/onboarding/Onboarding";
import * as api from "./api";
import type { EnvCheck } from "./api";

vi.mock("./api", () => ({
  getGitStatus: vi.fn().mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true }),
  postInit: vi.fn().mockResolvedValue({ created: [], isRepo: true, remote: "git@x:y.git" }),
  postClone: vi.fn(),
  getEnvironment: vi.fn(),
  postBrewInstall: vi.fn(),
  getDiscover: vi.fn().mockResolvedValue({ candidates: { dotfiles: [{ id: "a", path: "~/.zshrc" }] } }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { dotfiles: ["a"] } }),
  getKey: vi.fn().mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k", encryptedFiles: 0 }),
  generateKey: vi.fn(),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
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

    // Step 4 capture
    (await screen.findByRole("button", { name: "onboard.capture.btn" })).click();
    await waitFor(() => expect(api.postCapture).toHaveBeenCalled());

    // Step 5 push
    (await screen.findByRole("button", { name: "onboard.push.btn" })).click();
    await waitFor(() => expect(api.gitPush).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });
});
