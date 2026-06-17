import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilePreviewPane } from "./components/FilePreview";

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
