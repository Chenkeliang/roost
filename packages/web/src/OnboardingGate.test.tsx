import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Overview } from "./views/Overview";
import * as api from "./api";
import type { EnvCheck } from "./api";

vi.mock("./i18n", () => ({
  useT: () => ({ t: (k: string) => k, locale: "en", setLocale: () => {} }),
}));

const noop = () => {};
function mockApi(git: { isRepo: boolean; remote: string | null }) {
  const checks: EnvCheck[] = [{ id: "git", ok: true, required: true }];
  vi.mocked(api.getGitStatus).mockResolvedValue({ ...git, branch: "main", ahead: 0, behind: 0, clean: true });
  vi.mocked(api.getHealth).mockResolvedValue({ ok: true, name: "mac", repoDir: "/r", ageKey: false });
  vi.mocked(api.getMachines).mockResolvedValue({ hosts: [], states: {} });
  vi.mocked(api.getStatus).mockResolvedValue({ reports: [] });
  vi.mocked(api.getEnvironment).mockResolvedValue({ checks });
  vi.mocked(api.getDiscover).mockResolvedValue({ candidates: {} });
}

vi.mock("./api", () => ({
  getGitStatus: vi.fn(), getHealth: vi.fn(), getMachines: vi.fn(), getStatus: vi.fn(),
  getEnvironment: vi.fn(), getDiscover: vi.fn(), addSelection: vi.fn(), getSelection: vi.fn(),
  getKey: vi.fn(), generateKey: vi.fn(), postCapture: vi.fn(), gitPush: vi.fn(), postInit: vi.fn(),
  postClone: vi.fn(), postBrewInstall: vi.fn(), setGitRemote: vi.fn(),
  getBackupStatus: vi.fn().mockResolvedValue({ autoBackup: "daily", autoPush: false, lastRun: null, lastCaptureAt: new Date().toISOString() }),
  gitPull: vi.fn().mockResolvedValue({ ok: true, output: "" }),
}));

describe("Overview onboarding gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the onboarding repo step when there is no repo", async () => {
    mockApi({ isRepo: false, remote: null });
    render(<Overview showHud={noop} />);
    expect(await screen.findByRole("button", { name: "onboard.repo.createBtn" })).toBeInTheDocument();
  });

  it("renders the remote warning when repo exists but has no remote", async () => {
    mockApi({ isRepo: true, remote: null });
    render(<Overview showHud={noop} />);
    expect(await screen.findByText("onboard.remote.warning")).toBeInTheDocument();
  });

  it("renders the normal dashboard (capture button) when repo + remote present", async () => {
    mockApi({ isRepo: true, remote: "git@x:y.git" });
    render(<Overview showHud={noop} />);
    expect(await screen.findByText("overview.capture")).toBeInTheDocument();
  });
});
