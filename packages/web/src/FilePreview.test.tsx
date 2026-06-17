import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
