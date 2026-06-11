import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Settings } from "./views/Settings";
import * as api from "./api";

vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "mac", repoDir: "/r", ageKey: false }),
  getModules: vi.fn().mockResolvedValue({ modules: [] }),
  getGitStatus: vi.fn().mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true }),
  gitPush: vi.fn(), gitPull: vi.fn(),
  getKey: vi.fn().mockResolvedValue({ exists: true, recipient: "age1", keyPath: "/k", encryptedFiles: 0 }),
  generateKey: vi.fn(), rotateKey: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ maxCaptureMB: 100, autoBackup: "daily", autoPush: false, checkUpdates: true }),
  saveSettings: vi.fn().mockResolvedValue({ ok: true, maxCaptureMB: 100, autoBackup: "weekly", autoPush: false, checkUpdates: true }),
}));
vi.mock("./updateCheck", () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  isNewerVersion: vi.fn(),
}));

describe("Settings auto-backup section", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changing frequency saves the setting", async () => {
    render(<Settings />);
    const select = await screen.findByLabelText(/Frequency|频率/);
    fireEvent.change(select, { target: { value: "weekly" } });
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoBackup: "weekly" })));
  });

  it("manual update check shows the up-to-date message", async () => {
    render(<Settings />);
    (await screen.findByRole("button", { name: /Check for updates|检查更新/ })).click();
    expect(await screen.findByText(/latest version|已是最新/)).toBeInTheDocument();
  });
});
