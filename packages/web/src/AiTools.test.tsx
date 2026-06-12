import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { AiTools } from "./views/AiTools";

vi.mock("./api", () => ({
  getAiToolsCatalog: vi.fn().mockResolvedValue({ tools: [] }),
  addSelection: vi.fn().mockResolvedValue({}),
  removeSelection: vi.fn().mockResolvedValue({}),
  getSkills: vi.fn().mockResolvedValue({
    config: { sourceDir: "~/.agents/skills", method: "symlink", targets: ["claude"], skills: {} },
    targets: [{ id: "claude", path: ".claude/skills", label: "Claude Code" }],
    skills: [],
  }),
  discoverSkills: vi.fn().mockResolvedValue({ candidates: [] }),
  adoptSkills: vi.fn().mockResolvedValue({ written: [], blocked: [], materialized: [] }),
  unadoptSkills: vi.fn().mockResolvedValue({ ok: true, removed: [] }),
  toggleSkill: vi.fn().mockResolvedValue({ ok: true }),
  linkSkills: vi.fn().mockResolvedValue({ applied: [], skipped: [] }),
  saveSkillsConfig: vi.fn(),
  resolveSkillConflict: vi.fn().mockResolvedValue({ ok: true }),
  postSkillsImportScan: vi.fn().mockResolvedValue({ token: "t", skills: [] }),
  postSkillsImportApply: vi.fn().mockResolvedValue({ imported: [], blocked: [] }),
  saveSkillsTargets: vi.fn().mockResolvedValue({ ok: true }),
}));

describe("AiTools container", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders both tab buttons", async () => {
    await act(async () => {
      render(<AiTools />);
    });
    expect(screen.getByRole("button", { name: "Config backup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skills" })).toBeTruthy();
  });

  it("defaults to backup tab and renders AiBackup content", async () => {
    await act(async () => {
      render(<AiTools />);
    });
    const backupBtn = screen.getByRole("button", { name: "Config backup" });
    expect(backupBtn).toBeTruthy();
    // AiBackup renders (no AI tool configs discovered message after load)
    await waitFor(() =>
      expect(screen.getByText("No AI tool configs discovered on this machine.")).toBeTruthy(),
    );
  });

  it("switches to Skills tab on click", async () => {
    await act(async () => {
      render(<AiTools />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    });
    // After switching, Skills component is rendered (no AiBackup empty message)
    await waitFor(() =>
      expect(screen.queryByText("No AI tool configs discovered on this machine.")).toBeNull(),
    );
  });
});
