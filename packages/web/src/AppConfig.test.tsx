import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { AppConfig } from "./views/AppConfig";

vi.mock("./api", () => ({
  getIndex: vi.fn().mockResolvedValue({ index: { appconfig: { available: true, managed: 2 } } }),
  getAppConfig: vi
    .fn()
    .mockResolvedValue({ available: true, managed: ["com.apple.dock", "com.googlecode.iterm2"] }),
  getDiscoverModule: vi.fn().mockResolvedValue({
    candidates: {
      appconfig: [
        { id: "domain:com.apple.dock", path: "roost/appconfig/com.apple.dock.plist", category: "appconfig", recommendation: "track" },
        { id: "domain:com.apple.finder", path: "roost/appconfig/com.apple.finder.plist", category: "appconfig", recommendation: "track" },
      ],
    },
  }),
  addSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: { appconfig: ["domain:com.apple.finder"] } }),
}));

describe("AppConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("available + managed → renders domains; filter narrows to one", async () => {
    await act(async () => { render(<AppConfig showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("com.apple.dock")).toBeInTheDocument());
    expect(screen.getByText("com.googlecode.iterm2")).toBeInTheDocument();

    const filter = screen.getByPlaceholderText(/filter/i);
    await act(async () => { fireEvent.change(filter, { target: { value: "iterm" } }); });
    expect(screen.getByText("com.googlecode.iterm2")).toBeInTheDocument();
    expect(screen.queryByText("com.apple.dock")).not.toBeInTheDocument();
  });

  it("Scan calls getDiscoverModule('appconfig') and Add calls addSelection (excludes already-managed)", async () => {
    const api = await import("./api");
    await act(async () => { render(<AppConfig showHud={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText("com.apple.dock")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /scan app preferences/i })); });
    expect(api.getDiscoverModule).toHaveBeenCalledWith("appconfig");

    // com.apple.finder is NOT managed → appears as a candidate; com.apple.dock IS managed → excluded
    await waitFor(() => expect(screen.getByRole("button", { name: /add com\.apple\.finder/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /add com\.apple\.dock/i })).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /add com\.apple\.finder/i })); });
    expect(api.addSelection).toHaveBeenCalledWith("appconfig", "domain:com.apple.finder");
  });
});
