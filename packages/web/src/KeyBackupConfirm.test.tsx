import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KeyBackupConfirm } from "./components/KeyBackupConfirm";

const t = (k: string) => k;

describe("KeyBackupConfirm", () => {
  it("disables Continue until the checkbox is ticked, then calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(<KeyBackupConfirm recipient="age1abc" keyPath="/home/u/keys.txt" t={t} onConfirm={onConfirm} />);
    const btn = screen.getByRole("button", { name: "onboard.key.continue" });
    expect(btn).toBeDisabled();
    screen.getByRole("checkbox").click();
    expect(btn).not.toBeDisabled();
    btn.click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows the recipient and key path", () => {
    render(<KeyBackupConfirm recipient="age1xyz" keyPath="/k/keys.txt" t={t} onConfirm={() => {}} />);
    expect(screen.getByText("age1xyz")).toBeInTheDocument();
    expect(screen.getByText("/k/keys.txt")).toBeInTheDocument();
  });
});
