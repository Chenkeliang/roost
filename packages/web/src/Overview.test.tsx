import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { Overview } from "./views/Overview";
import * as api from "./api";
import { postCapture } from "./api";

// Mock with realistic server shapes matching server.ts actual responses
vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "roost", ageKey: false }),
  getEnvironment: vi.fn().mockResolvedValue({ checks: [] }),
  getMachines: vi.fn().mockResolvedValue({ hosts: ["macbook.local"], states: {} }),
  getGitStatus: vi.fn().mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true }),
  getStatus: vi.fn().mockResolvedValue({
    reports: [
      {
        module: "dotfiles",
        items: [
          { id: "~/.zshrc", state: "synced" },
          { id: "~/.vimrc", state: "drift" },
        ],
      },
      {
        module: "packages",
        items: [
          { id: "homebrew", state: "synced" },
        ],
      },
    ],
  }),
  postCapture: vi.fn().mockResolvedValue({
    changes: [{ module: "dotfiles", written: ["~/.zshrc"], encrypted: [] }],
  }),
  postLoad: vi.fn().mockResolvedValue({
    results: [{ module: "dotfiles", applied: ["~/.zshrc"], backedUp: [], skipped: [] }],
  }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  removeSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  getBackupStatus: vi.fn().mockResolvedValue({ autoBackup: "daily", autoPush: false, lastRun: null, lastCaptureAt: new Date().toISOString(), largeItems: [] }),
  excludeDotfile: vi.fn().mockResolvedValue({ ok: true }),
  gitPull: vi.fn().mockResolvedValue({ ok: true, output: "" }),
  gitPush: vi.fn().mockResolvedValue({ ok: true, output: "" }),
  getSettings: vi.fn().mockResolvedValue({ checkUpdates: false }),
  generateKey: vi.fn(),
}));

describe("Overview", () => {
  const noop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders module health section header", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      expect(screen.getByText("Backup Health")).toBeTruthy();
    });
  });

  it("renders module status chips after loading — using server item.state", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      // Both module names appear in health chips
      expect(screen.getByText("dotfiles")).toBeTruthy();
      expect(screen.getByText("packages")).toBeTruthy();
    });
  });

  it("derives drift status from items (dotfiles has a drift item)", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      // dotfiles module has a drift item — StatusDot aria-label should include "drift"
      const driftDots = screen.getAllByRole("status", { name: "drift" });
      expect(driftDots.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders capture and review buttons", async () => {
    await act(async () => { render(<Overview showHud={noop} />); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Capture/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Review & restore/i })).toBeTruthy();
    });
  });

  it("renders the machine card as soon as fast data lands, without waiting for the slow status call", async () => {
    // /api/status is the slow call (statusAll shells out per module). It must
    // not hold the whole first paint hostage: with status pending forever, the
    // machine card (fed by health/machines) must still render its hostname.
    vi.mocked(api.getStatus).mockReturnValue(new Promise(() => {}));
    await act(async () => { render(<Overview showHud={noop} />); });
    expect(await screen.findByText("macbook.local")).toBeTruthy();
  });

  it("shows one real machine card and an honest empty state when there is no second machine", async () => {
    await act(async () => {
      render(<Overview showHud={noop} />);
    });
    // Real hostname from /api/health, not a hardcoded follower.
    await waitFor(() => expect(screen.getAllByText(/macbook\.local|roost/).length).toBeGreaterThanOrEqual(1));
    // No fake follower.
    expect(screen.queryByText("Mac mini")).not.toBeInTheDocument();
    // Honest empty state for the absent second machine.
    expect(screen.getByText(/No other machine yet/i)).toBeInTheDocument();
  });

  it("renders a too-large blocked item with a Remove action (not encrypt-retry) that calls removeSelection", async () => {
    vi.mocked(api.postCapture).mockResolvedValueOnce({
      changes: [
        {
          module: "dotfiles",
          written: [],
          encrypted: [],
          blocked: ["/x"],
          blockedDetail: [{ id: "/x", reason: "too-large", detail: "160MB" }],
        },
      ],
    });
    await act(async () => { render(<Overview showHud={noop} />); });
    const captureBtn = await screen.findByRole("button", { name: /Capture/i });
    await act(async () => { fireEvent.click(captureBtn); });

    const removeBtn = await screen.findByRole("button", { name: /Remove|移除/i });
    expect(removeBtn).toBeTruthy();
    // A too-large item must NOT offer encrypt-retry.
    expect(screen.queryByRole("button", { name: /Encrypt & retry|加密并重试/i })).toBeNull();

    await act(async () => { fireEvent.click(removeBtn); });
    await waitFor(() => {
      expect(api.removeSelection).toHaveBeenCalledWith("dotfiles", "/x");
    });
  });

  it("the review button navigates to Sync Review (calls onOpenSync)", async () => {
    const onOpenSync = vi.fn();
    await act(async () => { render(<Overview showHud={noop} onOpenSync={onOpenSync} />); });
    const reviewBtn = await screen.findByRole("button", { name: /Review & restore/i });
    fireEvent.click(reviewBtn);
    await waitFor(() => {
      expect(onOpenSync).toHaveBeenCalled();
    });
  });

  it("shows the unpushed banner when git status reports ahead > 0", async () => {
    vi.mocked(api.getGitStatus).mockResolvedValue({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 2, behind: 0, clean: true });
    await act(async () => { render(<Overview showHud={noop} />); });
    expect(await screen.findByRole("button", { name: /Push|推送/ })).toBeInTheDocument();
  });

  it("shows the stale banner when the last capture is older than 7 days", async () => {
    vi.mocked(api.getBackupStatus).mockResolvedValue({ autoBackup: "daily", autoPush: false, lastRun: null, lastCaptureAt: new Date(Date.now() - 9 * 86400000).toISOString(), largeItems: [] });
    await act(async () => { render(<Overview showHud={noop} />); });
    expect(await screen.findByText(/Last backup was|上次备份已是/)).toBeInTheDocument();
  });

  it("blocked 'large' item offers keep + exclude actions", async () => {
    vi.mocked(api.postCapture).mockResolvedValueOnce({
      changes: [{ module: "dotfiles", written: [], encrypted: [], blocked: ["/u/.x/huge.bin"], blockedDetail: [{ id: "/u/.x/huge.bin", reason: "large", detail: "11MB" }] }],
    });
    await act(async () => { render(<Overview showHud={noop} />); });
    const captureBtn = await screen.findByRole("button", { name: /Capture/i });
    await act(async () => { fireEvent.click(captureBtn); });
    expect(await screen.findByRole("button", { name: /Back up anyway|仍要备份/ })).toBeInTheDocument();
    const exclude = screen.getByRole("button", { name: /Stop backing up|移出管理/ });
    await act(async () => { fireEvent.click(exclude); });
    await waitFor(() => expect(api.excludeDotfile).toHaveBeenCalledWith("/u/.x/huge.bin"));
  });
});

// ── Task 4: Overview — module tracking + de-mislabel title/HUD ───────────────

function captureResult(blockedDetail: { id: string; reason: string; detail?: string }[]) {
  return { changes: [{ module: "dotfiles", written: [], encrypted: [], blocked: blockedDetail.map((b) => b.id), blockedDetail }] };
}

async function captureWith(detail: { id: string; reason: string; detail?: string }[]) {
  (postCapture as ReturnType<typeof vi.fn>).mockResolvedValueOnce(captureResult(detail));
  const showHud = vi.fn();
  await act(async () => { render(<Overview showHud={showHud} onOpenSetup={() => {}} />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Capture/i })); });
  return showHud;
}

describe("Overview — blocked card labelling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the neutral title + non-secret HUD when no item is a secret", async () => {
    const showHud = await captureWith([{ id: "/h/.aws/credentials", reason: "error", detail: "no age key" }]);
    await waitFor(() => expect(screen.getByText("items need attention")).toBeInTheDocument());
    expect(showHud).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("need attention") }),
    );
    expect(screen.queryByText("items blocked — potential secrets")).toBeNull();
  });

  it("keeps the potential-secrets title when a secret item is present", async () => {
    await captureWith([{ id: "/h/.npmrc", reason: "secret", detail: "1 file(s)" }]);
    await waitFor(() => expect(screen.getByText("items blocked — potential secrets")).toBeInTheDocument());
  });
});

// ── Task 5: Overview — no-key remedy cluster ──────────────────────────────────

import { generateKey } from "./api";

describe("Overview — no-key remedy cluster", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the no-key label, hint, and Generate key & retry button", async () => {
    await captureWith([{ id: "/h/.aws/credentials", reason: "error", detail: "no age key" }]);
    await waitFor(() => expect(screen.getByText("age key required")).toBeInTheDocument());
    expect(screen.getByText("Sensitive files can only be backed up age-encrypted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate key & retry" })).toBeInTheDocument();
    // raw "no age key" string must NOT be shown
    expect(screen.queryByText(/· no age key/)).toBeNull();
  });

  it("Generate key & retry calls generateKey then shows the backup-confirm modal", async () => {
    (generateKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: true, source: "generated", recipient: "age1xyz", keyPath: "/h/.config/sops/age/keys.txt",
    });
    await captureWith([{ id: "/h/.aws/credentials", reason: "error", detail: "no age key" }]);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Generate key & retry" }));
    });
    await waitFor(() => expect(generateKey).toHaveBeenCalledOnce());
    // KeyBackupConfirm shows the key path + a disabled Continue until ack
    expect(screen.getByText("/h/.config/sops/age/keys.txt")).toBeInTheDocument();
  });
});
