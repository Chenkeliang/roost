import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./components/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title + body and wires confirm / cancel buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Rotate the age key?"
        body="This re-encrypts everything."
        confirmLabel="Rotate now"
        cancelLabel="Cancel"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("This re-encrypts everything.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Rotate now" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
