import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { FilePreviewPane } from "./components/FilePreview";
import * as api from "./api";

vi.mock("./api", () => ({ getFilePreview: vi.fn() }));

describe("FilePreviewPane — masked structural preview", () => {
  it("shows the masked note above the content when masked", () => {
    render(<FilePreviewPane preview={{ open: true, loading: false, content: '{\n  "mcpServers": "••••"\n}', masked: true }} />);
    expect(screen.getByText(/structure only, values hidden/i)).toBeInTheDocument();
    expect(screen.getByText(/mcpServers/)).toBeInTheDocument();
  });
  it("shows no masked note for a normal (unmasked) preview", () => {
    render(<FilePreviewPane preview={{ open: true, loading: false, content: "plain text", masked: false }} />);
    expect(screen.queryByText(/structure only, values hidden/i)).toBeNull();
    expect(screen.getByText("plain text")).toBeInTheDocument();
  });
});

describe("FilePreviewPane — reveal eye (ADR-0025)", () => {
  it("masked preview shows a leading eye that calls onReveal(true)", () => {
    const onReveal = vi.fn();
    render(<FilePreviewPane preview={{ open: true, loading: false, content: '{"k":"••••"}', masked: true }} onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button", { name: /show value/i }));
    expect(onReveal).toHaveBeenCalledWith(true);
  });
  it("revealed preview shows a hide eye that calls onReveal(false)", () => {
    const onReveal = vi.fn();
    render(<FilePreviewPane preview={{ open: true, loading: false, content: '{"k":"real"}', revealed: true }} onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button", { name: /hide value/i }));
    expect(onReveal).toHaveBeenCalledWith(false);
  });
  it("no eye when onReveal is not provided", () => {
    render(<FilePreviewPane preview={{ open: true, loading: false, content: '{"k":"••••"}', masked: true }} />);
    expect(screen.queryByRole("button", { name: /show value|hide value/i })).toBeNull();
  });
});

describe("FilePreviewPane — directory tree", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders directory entries as a tree (folders + files aligned)", () => {
    render(<FilePreviewPane path="/h/skill" preview={{ open: true, loading: false, entries: [{ name: "scripts", dir: true }, { name: "SKILL.md", dir: false }] }} />);
    expect(screen.getByText("scripts")).toBeInTheDocument();
    expect(screen.getByText("SKILL.md")).toBeInTheDocument();
  });

  it("expanding a folder node lazy-fetches its children", async () => {
    (api.getFilePreview as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, entries: [{ name: "build.sh", dir: false }] });
    render(<FilePreviewPane path="/h/skill" preview={{ open: true, loading: false, entries: [{ name: "scripts", dir: true }] }} />);
    await act(async () => { fireEvent.click(screen.getByText("scripts")); });
    await waitFor(() => expect(api.getFilePreview).toHaveBeenCalledWith("/h/skill/scripts", false));
    expect(await screen.findByText("build.sh")).toBeInTheDocument();
  });

  it("opening a file node previews its content", async () => {
    (api.getFilePreview as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, content: "# the skill" });
    render(<FilePreviewPane path="/h/skill" preview={{ open: true, loading: false, entries: [{ name: "SKILL.md", dir: false }] }} />);
    await act(async () => { fireEvent.click(screen.getByText("SKILL.md")); });
    await waitFor(() => expect(api.getFilePreview).toHaveBeenCalledWith("/h/skill/SKILL.md", false));
    expect(await screen.findByText("# the skill")).toBeInTheDocument();
  });
});
