import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Skills } from "./views/Skills";
import * as api from "./api";
import type { SkillsView, SkillRow } from "./api";

vi.mock("./api", () => ({
  getSkills: vi.fn().mockResolvedValue({
    config: { sourceDir: "~/.agents/skills", method: "symlink" as const, targets: ["claude", "codex"], skills: { foo: {} } },
    targets: [
      { id: "claude", path: ".claude/skills", label: "Claude Code" },
      { id: "codex", path: ".codex/skills", label: "Codex" },
    ],
    skills: [{ name: "foo", effective: { enabled: true, targets: ["claude"], method: "symlink" as const }, links: [], conflicts: ["claude"] }],
  }),
  discoverSkills: vi.fn().mockResolvedValue({ candidates: [] }),
  adoptSkills: vi.fn().mockResolvedValue({ written: [], blocked: [], materialized: [] }),
  unadoptSkills: vi.fn().mockResolvedValue({ ok: true, removed: [] }),
  toggleSkill: vi.fn().mockResolvedValue({ ok: true, config: {} }),
  linkSkills: vi.fn().mockResolvedValue({ applied: [], skipped: [] }),
  saveSkillsConfig: vi.fn(),
  resolveSkillConflict: vi.fn().mockResolvedValue({ ok: true, backedUp: "/b", linked: "/l" }),
  postSkillsImportScan: vi.fn().mockResolvedValue({ token: "t", skills: [] }),
  postSkillsImportApply: vi.fn().mockResolvedValue({ imported: [], blocked: [] }),
  saveSkillsTargets: vi.fn().mockResolvedValue({ ok: true }),
}));

// Typed helpers to avoid `method: string` inference issues
const mkRow = (o: Partial<SkillRow> & { name: string }): SkillRow => ({
  effective: { enabled: true, targets: ["claude"], method: "symlink" },
  links: [],
  conflicts: [],
  ...o,
});

const BASE_VIEW: SkillsView = {
  config: { sourceDir: "~/.agents/skills", method: "symlink", targets: ["claude", "codex"], skills: { foo: {} } },
  targets: [
    { id: "claude", path: ".claude/skills", label: "Claude Code" },
    { id: "codex", path: ".codex/skills", label: "Codex" },
  ],
  skills: [mkRow({ name: "foo", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [], conflicts: ["claude"] })],
};

const mkView = (skills: SkillRow[]): SkillsView => ({ ...BASE_VIEW, skills });

const TWO_CANDIDATES = [
  { id: "alpha", note: "found in ~/.agents/skills", origin: { location: "~/.agents/skills", linked: false } },
  { id: "beta", note: "needs repair", origin: { location: "~/.cc-switch/skills", linked: true, needsRepair: true } },
];

describe("Skills view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the managed skill row with coverage column instead of per-tool columns", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    expect(await screen.findByText("foo")).toBeInTheDocument();
    // coverage column header is present
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Coverage" })).toBeInTheDocument());
    // old per-tool column headers are gone
    expect(screen.queryByRole("columnheader", { name: "Gemini CLI" })).not.toBeInTheDocument();
  });

  it("Resolve opens an in-app confirm dialog via the coverage cell popover; confirming calls the API", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    // open the coverage cell popover (foo has a conflict on claude)
    const coverageBtn = await screen.findByRole("button", { name: /Coverage/i });
    coverageBtn.click();
    // the popover opens with a Resolve button for the claude conflict
    const dialog = await screen.findByRole("dialog");
    const resolveBtn = within(dialog).getByRole("button", { name: /resolve|解决/i });
    resolveBtn.click();
    // dismiss popover; confirm dialog appears
    const confirmBtn = await screen.findByRole("button", { name: /take over|接管|确认|继续/i });
    confirmBtn.click();
    await waitFor(() => expect(api.resolveSkillConflict).toHaveBeenCalledWith("foo", "claude"));
  });

  it("Resolve dialog can be cancelled without calling the API", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    const coverageBtn = await screen.findByRole("button", { name: /Coverage/i });
    coverageBtn.click();
    const dialog = await screen.findByRole("dialog");
    const resolveBtn = within(dialog).getByRole("button", { name: /resolve|解决/i });
    resolveBtn.click();
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

  it("remove flow: ⋯ menu → Remove → confirm calls unadoptSkills", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    vi.mocked(api.unadoptSkills).mockResolvedValue({ ok: true, removed: ["foo"] });
    render(<Skills />);
    (await screen.findByRole("button", { name: "actions foo" })).click();
    (await screen.findByRole("menuitem", { name: /Remove|移出/ })).click();
    const dialog = await screen.findByRole("dialog");
    within(dialog).getByRole("button", { name: /^Remove$/i }).click();
    await waitFor(() => expect(api.unadoptSkills).toHaveBeenCalledWith(["foo"]));
  });

  it("managed tab shows a coverage cell (n/m) instead of per-tool columns", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(mkView([
      mkRow({ name: "alpha", effective: { enabled: true, targets: ["claude", "codex"], method: "symlink" },
        links: [{ skill: "alpha", target: "claude", path: "/p", kind: "symlink" }, { skill: "alpha", target: "codex", path: "/p", kind: "symlink" }], conflicts: [] }),
      mkRow({ name: "beta", effective: { enabled: true, targets: ["claude", "codex"], method: "symlink" },
        links: [{ skill: "beta", target: "claude", path: "/p", kind: "symlink" }], conflicts: [] }),
    ]));
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    // n/m is split into colored spans (enabled count green / total muted), so match via the cell aria-label
    expect(await screen.findByLabelText(/Coverage 2\/2/)).toBeInTheDocument(); // alpha covered
    expect(await screen.findByLabelText(/Coverage 1\/2/)).toBeInTheDocument(); // beta partial
    // the old per-tool column headers are gone
    expect(screen.queryByRole("columnheader", { name: "Gemini CLI" })).not.toBeInTheDocument();
  });

  it("clicking the coverage cell opens a per-tool popover; toggling a tool calls toggleSkill", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(mkView([
      mkRow({ name: "alpha", effective: { enabled: true, targets: ["claude"], method: "symlink" },
        links: [{ skill: "alpha", target: "claude", path: "/p", kind: "symlink" }], conflicts: [] }),
    ]));
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    vi.mocked(api.toggleSkill).mockResolvedValue({ ok: true, config: {} as never });
    render(<Skills />);
    (await screen.findByRole("button", { name: /Coverage 1\/2/i })).click();
    const dialog = await screen.findByRole("dialog");
    // Codex is a catalog target but NOT in alpha's desired set → toggling it ON
    within(dialog).getByRole("switch", { name: /Codex/ }).click();
    await waitFor(() => expect(api.toggleSkill).toHaveBeenCalledWith("alpha", true, "codex"));
  });

  it("managed tab filters rows by the search box", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(mkView([
      mkRow({ name: "alpha", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [{ skill: "alpha", target: "claude", path: "/p", kind: "symlink" }], conflicts: [] }),
      mkRow({ name: "zeta", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [{ skill: "zeta", target: "claude", path: "/p", kind: "symlink" }], conflicts: [] }),
    ]));
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    await screen.findByText("alpha");
    const box = screen.getByPlaceholderText(/Filter|筛选/) as HTMLInputElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(box, { target: { value: "zet" } });
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    expect(screen.getByText("zeta")).toBeInTheDocument();
  });

  it("target manager: adding a custom target calls saveSkillsTargets", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(BASE_VIEW);
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    vi.mocked(api.saveSkillsTargets).mockResolvedValue({ ok: true });
    render(<Skills />);
    (await screen.findByRole("button", { name: /Manage targets|管理目标/ })).click();
    const dialog = await screen.findByRole("dialog");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(within(dialog).getByPlaceholderText(/name|名称/i), { target: { value: "myproj" } });
    fireEvent.change(within(dialog).getByPlaceholderText(/directory|目录/i), { target: { value: "~/work/.skills" } });
    within(dialog).getByRole("button", { name: /Add|添加/ }).click();
    within(dialog).getByRole("button", { name: /Save|保存/ }).click();
    await waitFor(() => expect(api.saveSkillsTargets).toHaveBeenCalled());
    const saved = vi.mocked(api.saveSkillsTargets).mock.calls[0]![0]!
    expect(saved.some((t) => t.id === "myproj" && t.path === "~/work/.skills")).toBe(true);
  });

  // ── external badge ──────────────────────────────────────────────────────────

  it("row with external cc-switch shows the badge", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(mkView([
      mkRow({ name: "foo", external: { id: "cc-switch", label: "cc-switch" } }),
    ]));
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    await screen.findByText("foo");
    expect(await screen.findByText(/cc-switch\s+managed/i)).toBeInTheDocument();
  });

  it("row with unknown external manager shows the badge label", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(mkView([
      mkRow({ name: "bar", external: { id: "unknown", label: "~/.foo-manager" } }),
    ]));
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    render(<Skills />);
    await screen.findByText("bar");
    expect(await screen.findByText(/~\/.foo-manager\s+managed/i)).toBeInTheDocument();
  });

  it("conflict dialog for external skill shows cede button that calls toggleSkill", async () => {
    vi.mocked(api.getSkills).mockResolvedValue(mkView([
      mkRow({ name: "foo", effective: { enabled: true, targets: ["claude"], method: "symlink" }, links: [], conflicts: ["claude"], external: { id: "cc-switch", label: "cc-switch" } }),
    ]));
    vi.mocked(api.discoverSkills).mockResolvedValue({ candidates: [] });
    vi.mocked(api.toggleSkill).mockResolvedValue({ ok: true, config: {} as never });
    render(<Skills />);
    // open coverage popover
    const coverageBtn = await screen.findByRole("button", { name: /Coverage/i });
    coverageBtn.click();
    // popover opens; Resolve button is present even for external conflict
    const popover = await screen.findByRole("dialog");
    const resolveBtn = within(popover).getByRole("button", { name: /resolve|解决/i });
    // clicking Resolve closes popover and opens the conflict dialog
    resolveBtn.click();
    // wait for the conflict dialog (the popover closes and conflict dialog opens)
    await waitFor(() => {
      const dialogs = screen.queryAllByRole("dialog");
      expect(dialogs.length).toBeGreaterThan(0);
    });
    const dialog = screen.getByRole("dialog");
    // cede button must be present in the conflict dialog
    const cedeBtn = within(dialog).getByRole("button", { name: /让给\s*cc-switch|Leave it to\s*cc-switch/i });
    expect(cedeBtn).toBeInTheDocument();
    // clicking cede triggers toggleSkill with enabled=false
    cedeBtn.click();
    await waitFor(() => expect(api.toggleSkill).toHaveBeenCalledWith("foo", false, "claude"));
  });
});
