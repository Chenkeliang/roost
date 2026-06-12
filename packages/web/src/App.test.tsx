import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import { App } from "./App";
import { LocaleProvider } from "./i18n";

// Mock the api module
vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "roost" }),
  getEnvironment: vi.fn().mockResolvedValue({ checks: [] }),
  getMachines: vi.fn().mockResolvedValue({ hosts: [], states: {} }),
  getStatus: vi.fn().mockResolvedValue({ reports: [] }),
  getDiff: vi.fn().mockResolvedValue({ diffs: [] }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  getModules: vi.fn().mockResolvedValue({ modules: [] }),
  getIndex: vi.fn().mockResolvedValue({ index: {} }),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
  postLoad: vi.fn().mockResolvedValue({ results: [] }),
  getGitStatus: vi.fn().mockResolvedValue({
    isRepo: false,
    remote: null,
    branch: null,
    ahead: 0,
    behind: 0,
    clean: true,
  }),
  gitPush: vi.fn().mockResolvedValue({ ok: true, output: "" }),
  gitPull: vi.fn().mockResolvedValue({ ok: true, output: "" }),
  getKey: vi.fn().mockResolvedValue({ exists: false, recipient: null, keyPath: "/x", encryptedFiles: 0 }),
  generateKey: vi.fn().mockResolvedValue({ created: true, source: "generated", recipient: "age1x", keyPath: "/x" }),
  rotateKey: vi.fn().mockResolvedValue({ recipient: "age1x", rotated: [], failed: [], swapped: true }),
  getSettings: vi.fn().mockResolvedValue({ maxCaptureMB: 100 }),
  saveSettings: vi.fn().mockResolvedValue({ ok: true, maxCaptureMB: 100 }),
  getBackupStatus: vi.fn().mockResolvedValue({ autoBackup: "daily", autoPush: false, lastRun: null, lastCaptureAt: new Date().toISOString() }),
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all nav items in the sidebar", async () => {
    await act(async () => {
      render(<App />);
    });
    // Multiple "Overview" buttons exist (nav item + action bar) — use getAllByRole
    expect(screen.getAllByRole("button", { name: "Overview" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Projects" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI Tools" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("drift and setup nav items are gone, aitools nav item appears", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.queryByRole("button", { name: "Drift" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Setup" })).toBeNull();
    expect(screen.getByRole("button", { name: "AI Tools" })).toBeTruthy();
  });

  it("switches views when a sidebar nav item is clicked", async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    });
    expect(screen.getByRole("button", { name: "Projects" }).getAttribute("aria-current")).toBe("page");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows a Docs link to the website", async () => {
    await act(async () => {
      render(<App />);
    });
    const docs = screen.getByRole("link", { name: "Docs" });
    expect(docs.getAttribute("href")).toBe("https://github.com/Chenkeliang/roost/tree/main/website");
  });

  it("shows the Roost brand name", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText("Roost")).toBeTruthy();
  });

  it("shows local shield chip", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText("local")).toBeTruthy();
  });

  it("command palette opens when Actions button is clicked in action bar", async () => {
    await act(async () => {
      render(<App />);
    });
    const actionsBtn = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(actionsBtn);
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  it("command palette has 'View diff' command (drift replaced by sync)", async () => {
    await act(async () => {
      render(<App />);
    });
    const actionsBtn = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(actionsBtn);
    expect(screen.getByText("View diff")).toBeTruthy();
    expect(screen.queryByText("Open Drift")).toBeNull();
  });

  it("command palette closes on Escape", async () => {
    await act(async () => {
      render(<App />);
    });
    const actionsBtn = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(actionsBtn);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking the 中 language switch flips a nav label to its zh string", async () => {
    localStorage.clear();
    await act(async () => {
      render(
        <LocaleProvider>
          <App />
        </LocaleProvider>,
      );
    });
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "中" }));
    });
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });
});
