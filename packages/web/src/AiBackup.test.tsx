import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { within } from "@testing-library/react";
import { AiBackup } from "./views/AiBackup";
import * as api from "./api";

vi.mock("./api", () => ({
  getAiToolsCatalog: vi.fn().mockResolvedValue({
    tools: [
      {
        id: "claude-code",
        label: "Claude Code",
        paths: [
          { path: "/u/.claude/CLAUDE.md", kind: "memory", encrypt: false, state: "available" },
          { path: "/u/.claude/settings.local.json", kind: "settings", encrypt: true, state: "dotfiles" },
          { path: "/u/.claude.json", kind: "data", encrypt: false, state: "never" },
          { path: "/u/.claude/missing.json", kind: "settings", encrypt: false, state: "missing" },
        ],
      },
      {
        id: "claude-desktop",
        label: "Claude Desktop",
        paths: [
          { path: "/u/Library/Application Support/Claude/claude_desktop_config.json", kind: "mcp", encrypt: true, state: "selected" },
        ],
      },
    ],
  }),
  addSelection: vi.fn().mockResolvedValue({}),
  removeSelection: vi.fn().mockResolvedValue({}),
}));

describe("AiBackup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders tool groups after load", async () => {
    await act(async () => { render(<AiBackup showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("Claude Code")).toBeInTheDocument());
    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
  });

  it("available row has Add button; clicking it calls addSelection", async () => {
    await act(async () => { render(<AiBackup showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("Claude Code")).toBeInTheDocument());
    // CLAUDE.md row is available
    const claudeRow = screen.getByText("CLAUDE.md").closest("[role='row']") as HTMLElement;
    const addBtn = within(claudeRow).getByRole("button", { name: /add/i });
    addBtn.click();
    await waitFor(() =>
      expect(api.addSelection).toHaveBeenCalledWith("aitools", "/u/.claude/CLAUDE.md"),
    );
  });

  it("dotfiles row is dimmed and has no action button", async () => {
    await act(async () => { render(<AiBackup showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("Claude Code")).toBeInTheDocument());
    const dotfilesRow = screen.getByText("settings.local.json").closest("[role='row']") as HTMLElement;
    expect(dotfilesRow).toHaveStyle({ opacity: "0.55" });
    expect(within(dotfilesRow).queryByRole("button")).toBeNull();
  });

  it("never row is dimmed and has no action button", async () => {
    await act(async () => { render(<AiBackup showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("Claude Code")).toBeInTheDocument());
    const neverRow = screen.getByText(".claude.json").closest("[role='row']") as HTMLElement;
    expect(neverRow).toHaveStyle({ opacity: "0.55" });
    expect(within(neverRow).queryByRole("button")).toBeNull();
  });

  it("missing row is not rendered", async () => {
    await act(async () => { render(<AiBackup showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("Claude Code")).toBeInTheDocument());
    expect(screen.queryByText("missing.json")).not.toBeInTheDocument();
  });

  it("selected row shows Remove button and calls removeSelection", async () => {
    await act(async () => { render(<AiBackup showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("Claude Desktop")).toBeInTheDocument());
    const selRow = screen.getByText("claude_desktop_config.json").closest("[role='row']") as HTMLElement;
    const removeBtn = within(selRow).getByRole("button", { name: /remove/i });
    removeBtn.click();
    await waitFor(() =>
      expect(api.removeSelection).toHaveBeenCalledWith(
        "aitools",
        "/u/Library/Application Support/Claude/claude_desktop_config.json",
      ),
    );
  });
});
