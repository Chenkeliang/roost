import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RemoteWarningBanner } from "./components/RemoteWarningBanner";
import * as api from "./api";

vi.mock("./api", () => ({ setGitRemote: vi.fn().mockResolvedValue({ ok: true, remote: "git@x:y.git" }) }));
const t = (k: string) => k;

describe("RemoteWarningBanner", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reveals an input on Set, saves, and calls onConfigured", async () => {
    const onConfigured = vi.fn();
    render(<RemoteWarningBanner t={t} onConfigured={onConfigured} />);
    screen.getByRole("button", { name: "onboard.remote.set" }).click();
    const input = await screen.findByPlaceholderText("onboard.remote.placeholder");
    fireEvent.change(input, { target: { value: "git@x:y.git" } });
    screen.getByRole("button", { name: "onboard.remote.save" }).click();
    await waitFor(() => expect(api.setGitRemote).toHaveBeenCalledWith("git@x:y.git"));
    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
  });
});
