import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StepSelect } from "./views/onboarding/StepSelect";
import * as api from "./api";

vi.mock("./api", () => ({
  getDiscover: vi.fn().mockResolvedValue({ candidates: {
    dotfiles: [{ id: "a", path: "~/.zshrc" }, { id: "b", path: "~/.vimrc" }],
    env: [{ id: "e1", path: "SECRET" }],
  } }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
}));
const t = (k: string) => k;

describe("StepSelect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pre-selects non-secret modules and adds their candidates on confirm", async () => {
    const onDone = vi.fn();
    render(<StepSelect t={t} onDone={onDone} />);
    await screen.findByText("dotfiles");
    screen.getByRole("button", { name: "onboard.select.confirm" }).click();
    await waitFor(() => {
      expect(api.addSelection).toHaveBeenCalledWith("dotfiles", "a");
      expect(api.addSelection).toHaveBeenCalledWith("dotfiles", "b");
    });
    expect(api.addSelection).not.toHaveBeenCalledWith("env", "e1");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
