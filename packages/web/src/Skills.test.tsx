import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Skills } from "./views/Skills";
import * as api from "./api";

vi.mock("./api", () => ({
  getSkills: vi.fn().mockResolvedValue({
    config: { sourceDir: "~/.agents/skills", method: "symlink", targets: ["claude", "codex"], skills: { foo: {} } },
    targets: [
      { id: "claude", path: ".claude/skills", label: "Claude Code" },
      { id: "codex", path: ".codex/skills", label: "Codex" },
    ],
    skills: [{ name: "foo", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [], conflicts: ["claude"] }],
  }),
  discoverSkills: vi.fn().mockResolvedValue({ candidates: [] }),
  captureSkills: vi.fn(),
  toggleSkill: vi.fn().mockResolvedValue({ ok: true, config: {} }),
  linkSkills: vi.fn().mockResolvedValue({ applied: [], skipped: [] }),
  saveSkillsConfig: vi.fn(),
  resolveSkillConflict: vi.fn().mockResolvedValue({ ok: true, backedUp: "/b", linked: "/l" }),
}));

describe("Skills view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the managed skill row with an IDE matrix (target columns)", async () => {
    render(<Skills />);
    expect(await screen.findByText("foo")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Claude Code/)).toBeInTheDocument());
    expect(screen.getByText(/Codex/)).toBeInTheDocument();
  });

  it("Resolve opens an in-app confirm dialog; confirming calls the API", async () => {
    render(<Skills />);
    // click the Resolve button on the conflict cell
    const resolveBtn = await screen.findByRole("button", { name: /resolve|解决/i });
    resolveBtn.click();
    // an in-app confirm dialog appears with the move-to-backups message + a confirm action
    const confirmBtn = await screen.findByRole("button", { name: /move|take over|接管|确认|继续/i });
    confirmBtn.click();
    await waitFor(() => expect(api.resolveSkillConflict).toHaveBeenCalledWith("foo", "claude"));
  });

  it("Resolve dialog can be cancelled without calling the API", async () => {
    render(<Skills />);
    (await screen.findByRole("button", { name: /resolve|解决/i })).click();
    const cancelBtn = await screen.findByRole("button", { name: /cancel|取消/i });
    cancelBtn.click();
    expect(api.resolveSkillConflict).not.toHaveBeenCalled();
  });
});
