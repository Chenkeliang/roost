import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AiBackup } from "./views/AiBackup";
import * as api from "./api";

vi.mock("./api", () => ({
  getAiToolsCatalog: vi.fn().mockResolvedValue({ tools: [] }),
  addSelection: vi.fn().mockResolvedValue({}),
  removeSelection: vi.fn().mockResolvedValue({}),
  addAiCustom: vi.fn().mockResolvedValue({ ok: true }),
}));

describe("AiBackup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("collapsed tool shows coverage; expanding reveals file rows", async () => {
    vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [
      { id: "claude-code", label: "Claude Code", paths: [
        { path: "/h/.claude/CLAUDE.md", kind: "memory", encrypt: false, state: "selected" },
        { path: "/h/.claude/settings.json", kind: "settings", encrypt: false, state: "available" },
        { path: "/h/.claude.json", kind: "data", encrypt: false, state: "never" },
      ]},
      { id: "cursor", label: "Cursor", paths: [ { path: "/h/.cursor/mcp.json", kind: "mcp", encrypt: true, state: "missing" } ] },
    ] });
    render(<AiBackup />);
    const head = await screen.findByText("Claude Code");
    // missing-only tool (Cursor) hidden under "all" — not in detected view
    fireEvent.click(head);
    expect(await screen.findByText("CLAUDE.md")).toBeInTheDocument();
    expect(screen.getByText(/never backed up|永不备份/)).toBeInTheDocument();
  });

  it("available row adds to aitools selection", async () => {
    vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [ { id: "claude-code", label: "Claude Code", paths: [ { path: "/h/.claude/settings.json", kind: "settings", encrypt: false, state: "available" } ] } ] });
    render(<AiBackup />);
    fireEvent.click(await screen.findByText("Claude Code"));
    // Per-row "Add" link (not "Add tool" header button or "Add all" bulk button)
    const row = (await screen.findByText("settings.json")).closest("[role='row']") as HTMLElement;
    fireEvent.click(row.querySelector("button")!);
    await waitFor(() => expect(api.addSelection).toHaveBeenCalledWith("aitools", "/h/.claude/settings.json"));
  });

  it("add-tool form posts a custom path", async () => {
    vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [] });
    render(<AiBackup />);
    fireEvent.click(await screen.findByRole("button", { name: /Add tool|添加工具/ }));
    fireEvent.change(screen.getByPlaceholderText(/Path|路径/), { target: { value: "~/.x/c.json" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$|^添加$/ }));
    await waitFor(() => expect(api.addAiCustom).toHaveBeenCalledWith(expect.objectContaining({ path: "~/.x/c.json" })));
  });

  it("'All supported' toggle reveals undetected tools as not-installed rows", async () => {
    vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [
      { id: "claude-code", label: "Claude Code", paths: [ { path: "/h/.claude/CLAUDE.md", kind: "memory", encrypt: false, state: "selected" } ] },
      { id: "cursor", label: "Cursor", paths: [ { path: "/h/.cursor/mcp.json", kind: "mcp", encrypt: false, state: "missing" } ] },
    ] });
    render(<AiBackup />);
    // "Cursor" is undetected — must be absent in Detected view
    await screen.findByText("Claude Code");
    expect(screen.queryByText("Cursor")).not.toBeInTheDocument();
    // Switch to "All supported" — Cursor must now appear
    fireEvent.click(screen.getByRole("button", { name: /All supported|全部支持/ }));
    expect(await screen.findByText("Cursor")).toBeInTheDocument();
    expect(screen.getByText(/not installed|未安装/)).toBeInTheDocument();
  });

  it("add-tool button visible when catalog has detected tools (populated case)", async () => {
    vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [
      { id: "claude-code", label: "Claude Code", paths: [
        { path: "/h/.claude/CLAUDE.md", kind: "memory", encrypt: false, state: "selected" },
        { path: "/h/.claude/settings.json", kind: "settings", encrypt: false, state: "available" },
      ]},
    ] });
    render(<AiBackup />);
    // Button must be present even though the catalog is populated (non-empty list)
    expect(await screen.findByRole("button", { name: /Add tool|添加工具/ })).toBeInTheDocument();
  });

  it("path with extract:true renders a 提取 tag after the filename", async () => {
    vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [
      { id: "claude-code", label: "Claude Code", paths: [
        { path: "/h/.claude.json", kind: "mcp", encrypt: true, state: "selected", extract: true },
      ]},
    ] });
    render(<AiBackup />);
    fireEvent.click(await screen.findByText("Claude Code"));
    // The extract tag must appear next to the filename row
    expect(await screen.findByText(/提取|field/)).toBeInTheDocument();
  });

  it("tool with suggest:true renders in suggestion group with adopt button that calls addAiCustom with extract", async () => {
    vi.mocked(api.getAiToolsCatalog).mockResolvedValue({ tools: [
      { id: "myapp", label: "MyApp", paths: [ { path: "/h/.myapp/config.json", kind: "mcp", encrypt: false, state: "available" } ], suggest: true },
    ] });
    render(<AiBackup />);
    // Suggestion group heading
    expect(await screen.findByText(/检测到可提取的 MCP|Detected MCP you can extract/)).toBeInTheDocument();
    // Adopt button
    const adoptBtn = screen.getByRole("button", { name: /按提取方式纳管|Back up just the MCP/ });
    expect(adoptBtn).toBeInTheDocument();
    fireEvent.click(adoptBtn);
    await waitFor(() => expect(api.addAiCustom).toHaveBeenCalledWith({
      path: "/h/.myapp/config.json",
      label: "MyApp",
      kind: "mcp",
      extract: { fields: ["mcpServers"] },
    }));
  });
});
