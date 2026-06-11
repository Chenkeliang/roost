import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Settings } from "./views/Settings";
import * as api from "./api";
import * as updateCheck from "./updateCheck";

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
vi.mock("./openExternal", () => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));

describe("Settings auto-backup section", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changing frequency saves the setting", async () => {
    render(<Settings />);
    const select = await screen.findByLabelText(/Frequency|频率/);
    fireEvent.change(select, { target: { value: "weekly" } });
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoBackup: "weekly" })));
  });

  it("manual update check calls checkForUpdate and shows up-to-date message", async () => {
    vi.mocked(updateCheck.checkForUpdate).mockResolvedValue(null);
    render(<Settings />);
    (await screen.findByRole("button", { name: /Check for updates|检查更新/ })).click();
    expect(await screen.findByText(/latest version|已是最新/)).toBeInTheDocument();
    expect(updateCheck.checkForUpdate).toHaveBeenCalled();
  });

  it("manual update check shows failed message on error", async () => {
    vi.mocked(updateCheck.checkForUpdate).mockRejectedValue(new Error("network"));
    render(<Settings />);
    (await screen.findByRole("button", { name: /Check for updates|检查更新/ })).click();
    expect(await screen.findByText(/failed|失败/i)).toBeInTheDocument();
  });

  it("manual update check shows available version and download button when update exists", async () => {
    vi.mocked(updateCheck.checkForUpdate).mockResolvedValue({ version: "9.9.9", url: "https://example.com/dl" });
    const { openExternal } = await import("./openExternal");
    render(<Settings />);
    (await screen.findByRole("button", { name: /Check for updates|检查更新/ })).click();
    // version number should appear
    expect(await screen.findByText(/9\.9\.9/)).toBeInTheDocument();
    // clicking download triggers openExternal
    const downloadBtn = await screen.findByRole("button", { name: /download|下载/i });
    downloadBtn.click();
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith("https://example.com/dl"));
  });

  it("autoPush checkbox saves via saveSettings", async () => {
    render(<Settings />);
    // wait for settings to load (autoPush starts false)
    const checkbox = await screen.findByRole("checkbox", { name: /push|推送/i });
    fireEvent.click(checkbox);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoPush: true })));
  });

  it("checkUpdates checkbox saves via saveSettings", async () => {
    render(<Settings />);
    // checkUpdates starts true; find the checkbox by vicinity of its label text
    // The checkUpdates checkbox label contains the toggle text
    const toggleLabel = await screen.findByText(/Check on launch|开机检查/i).catch(() => null)
      ?? await screen.findByText(/updates/i);
    expect(toggleLabel).toBeTruthy();
    // Find checkbox associated — it's near the updates section button
    const updatesSection = await screen.findByRole("button", { name: /Check for updates|检查更新/ });
    // The checkbox in the same row as the updates button
    const row = updatesSection.closest("div")?.parentElement;
    const cb = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(cb).not.toBeNull();
    fireEvent.click(cb!);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ checkUpdates: false })));
  });
});
