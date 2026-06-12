import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import { Settings } from "./views/Settings";

vi.mock("./i18n", () => ({
  useT: () => ({ t: (k: string) => k, locale: "en", setLocale: () => {} }),
}));

vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "mac", repoDir: "/r", ageKey: false }),
  getModules: vi.fn().mockResolvedValue({ modules: [] }),
  getGitStatus: vi.fn().mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true }),
  gitPush: vi.fn(), gitPull: vi.fn(),
  getKey: vi.fn().mockResolvedValue({ exists: false, recipient: null, keyPath: "/k/keys.txt", encryptedFiles: 0 }),
  generateKey: vi.fn().mockResolvedValue({ created: true, source: "generated", recipient: "age1abc", keyPath: "/k/keys.txt" }),
  rotateKey: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ maxCaptureMB: 5 }),
  saveSettings: vi.fn(),
  getEnvironment: vi.fn().mockResolvedValue({ checks: [] }),
  postBrewInstall: vi.fn().mockResolvedValue({ ok: true, output: "" }),
}));

describe("Settings key backup", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows the blocking backup modal after generating a key", async () => {
    render(<Settings />);
    (await screen.findByRole("button", { name: "settings.key.generate" })).click();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "onboard.key.continue" })).toBeDisabled();
  });
});
