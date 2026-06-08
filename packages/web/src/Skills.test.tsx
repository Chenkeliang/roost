import { describe, it, expect, vi } from "vitest";
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
  it("renders the managed skill row with an IDE matrix (target columns)", async () => {
    render(<Skills />);
    expect(await screen.findByText("foo")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Claude Code/)).toBeInTheDocument());
    expect(screen.getByText(/Codex/)).toBeInTheDocument();
  });

  it("offers Resolve on a conflict cell and calls the API on confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Skills />);
    const btn = await screen.findByRole("button", { name: /resolve|解决/i });
    btn.click();
    await waitFor(() => expect(api.resolveSkillConflict).toHaveBeenCalledWith("foo", "claude"));
  });
});
