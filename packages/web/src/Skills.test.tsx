import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  adoptSkills: vi.fn().mockResolvedValue({ written: [], blocked: [], materialized: [] }),
  unadoptSkills: vi.fn().mockResolvedValue({ ok: true, removed: [] }),
  toggleSkill: vi.fn().mockResolvedValue({ ok: true, config: {} }),
  linkSkills: vi.fn().mockResolvedValue({ applied: [], skipped: [] }),
  saveSkillsConfig: vi.fn(),
  resolveSkillConflict: vi.fn().mockResolvedValue({ ok: true, backedUp: "/b", linked: "/l" }),
}));

const BASE_VIEW = {
  config: { sourceDir: "~/.agents/skills", method: "symlink", targets: ["claude", "codex"], skills: { foo: {} } },
  targets: [
    { id: "claude", path: ".claude/skills", label: "Claude Code" },
    { id: "codex", path: ".codex/skills", label: "Codex" },
  ],
  skills: [{ name: "foo", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [], conflicts: ["claude"] }],
};

const TWO_CANDIDATES = [
  { id: "alpha", note: "found in ~/.agents/skills", origin: { location: "~/.agents/skills", linked: false } },
  { id: "beta", note: "needs repair", origin: { location: "~/.cc-switch/skills", linked: true, needsRepair: true } },
];

describe("Skills view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the managed skill row with an IDE matrix (target columns)", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    expect(await screen.findByText("foo")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Claude Code/)).toBeInTheDocument());
    expect(screen.getByText(/Codex/)).toBeInTheDocument();
  });

  it("Resolve opens an in-app confirm dialog; confirming calls the API", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    // click the Resolve button on the conflict cell
    const resolveBtn = await screen.findByRole("button", { name: /resolve|解决/i });
    resolveBtn.click();
    // an in-app confirm dialog appears with the move-to-backups message + a confirm action
    const confirmBtn = await screen.findByRole("button", { name: /take over|接管|确认|继续/i });
    confirmBtn.click();
    await waitFor(() => expect(api.resolveSkillConflict).toHaveBeenCalledWith("foo", "claude"));
  });

  it("Resolve dialog can be cancelled without calling the API", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    (await screen.findByRole("button", { name: /resolve|解决/i })).click();
    const cancelBtn = await screen.findByRole("button", { name: /cancel|取消/i });
    cancelBtn.click();
    expect(api.resolveSkillConflict).not.toHaveBeenCalled();
  });

  // ── adopt feature tests ────────────────────────────────────────────────────

  it("discovered tab groups candidates by location and shows linked-group hint only for all-linked groups", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: TWO_CANDIDATES });

    render(<Skills />);
    // wait for initial load
    await screen.findByText("foo");

    // switch to the Discovered tab — use aria-pressed to pick the tab pill, not the scan button
    const discoveredTab = await screen.findByRole("button", { name: /^Discovered/, pressed: false });
    discoveredTab.click();

    // both group headers should appear
    await screen.findByText("~/.agents/skills");
    await screen.findByText("~/.cc-switch/skills");

    // the linked-group hint should appear for ~/.cc-switch/skills (all-linked group)
    // but NOT for ~/.agents/skills (non-linked group)
    await waitFor(() =>
      expect(screen.getByText(/These skills' real content lives in the directory above/)).toBeInTheDocument()
    );
    // only one hint rendered (the bare group ~/.agents/skills should not get one)
    expect(screen.getAllByText(/These skills' real content lives in the directory above/).length).toBe(1);
  });

  it("discovered tab shows 'needs repair' badge on candidates with needsRepair", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: TWO_CANDIDATES });

    render(<Skills />);
    await screen.findByText("foo");

    const discoveredTab = await screen.findByRole("button", { name: /^Discovered/, pressed: false });
    discoveredTab.click();

    // beta should show the repair badge; alpha should not
    await screen.findByText("beta");
    expect(await screen.findByText("needs repair")).toBeInTheDocument();
  });

  it("adopt flow: checking a candidate then confirming calls adoptSkills with decouple:true", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: TWO_CANDIDATES });
    vi.mocked(api.adoptSkills).mockResolvedValue({ written: ["alpha"], blocked: [], materialized: [] });

    render(<Skills />);
    await screen.findByText("foo");

    // switch to Discovered tab — target the tab pill (aria-pressed), not the scan button
    const discoveredTab = await screen.findByRole("button", { name: /^Discovered/, pressed: false });
    discoveredTab.click();

    // check the alpha candidate checkbox
    const alphaCheckbox = await screen.findByRole("checkbox", { name: "select alpha" });
    alphaCheckbox.click();

    // the "Adopt" action button should now appear above the list
    const adoptActionBtn = await screen.findByRole("button", { name: /^Adopt$/i });
    adoptActionBtn.click();

    // the confirm dialog should appear with the title "Adopt these skills?"
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Adopt these skills\?/)).toBeInTheDocument();

    // click the confirm "Adopt" button inside the dialog
    const confirmBtn = within(dialog).getByRole("button", { name: /^Adopt$/i });
    confirmBtn.click();

    await waitFor(() =>
      expect(api.adoptSkills).toHaveBeenCalledWith(
        ["alpha"],
        expect.objectContaining({ decouple: true }),
      )
    );
  });

  it("remove flow: clicking Remove on a managed row then confirming calls unadoptSkills", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    vi.mocked(api.unadoptSkills).mockResolvedValue({ ok: true, removed: ["foo"] });

    render(<Skills />);
    // the managed tab is shown by default; wait for the foo row
    const removeBtn = await screen.findByRole("button", { name: "remove foo" });
    removeBtn.click();

    // the remove confirm dialog should appear
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Remove from management\?/)).toBeInTheDocument();

    // confirm
    const confirmBtn = within(dialog).getByRole("button", { name: /^Remove$/i });
    confirmBtn.click();

    await waitFor(() =>
      expect(api.unadoptSkills).toHaveBeenCalledWith(["foo"])
    );
  });
});
