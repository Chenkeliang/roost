import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./components/CommandPalette";

describe("CommandPalette", () => {
  const noop = vi.fn();

  it("does not render when closed", () => {
    render(
      <CommandPalette
        open={false}
        onClose={noop}
        onCapture={noop}
        onLoad={noop}
        onOpenSync={noop}
        onOpenTimeline={noop}
        onOpenSettings={noop}
      />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders when open with all commands", () => {
    render(
      <CommandPalette
        open={true}
        onClose={noop}
        onCapture={noop}
        onLoad={noop}
        onOpenSync={noop}
        onOpenTimeline={noop}
        onOpenSettings={noop}
      />
    );
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
    expect(screen.getByText("Capture")).toBeTruthy();
    expect(screen.getByText("Load (dry-run)")).toBeTruthy();
    expect(screen.getByText("View diff")).toBeTruthy();
    expect(screen.queryByText("Open Drift")).toBeNull();
  });

  it("filters commands by query", () => {
    render(
      <CommandPalette
        open={true}
        onClose={noop}
        onCapture={noop}
        onLoad={noop}
        onOpenSync={noop}
        onOpenTimeline={noop}
        onOpenSettings={noop}
      />
    );
    const input = screen.getByPlaceholderText("Search commands…");
    fireEvent.change(input, { target: { value: "diff" } });
    expect(screen.getByText("View diff")).toBeTruthy();
    expect(screen.queryByText("Capture")).toBeNull();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        open={true}
        onClose={onClose}
        onCapture={noop}
        onLoad={noop}
        onOpenSync={noop}
        onOpenTimeline={noop}
        onOpenSettings={noop}
      />
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls action and closes when Enter is pressed", () => {
    const onCapture = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open={true}
        onClose={onClose}
        onCapture={onCapture}
        onLoad={noop}
        onOpenSync={noop}
        onOpenTimeline={noop}
        onOpenSettings={noop}
      />
    );
    // First item "Capture" is selected by default
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    expect(onCapture).toHaveBeenCalled();
  });
});
