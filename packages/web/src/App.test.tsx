import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { App } from "./App";

// Mock the api module
vi.mock("./api", () => ({
  getHealth: vi.fn().mockResolvedValue({ ok: true, name: "roost" }),
  getMachines: vi.fn().mockResolvedValue({ hosts: [], states: {} }),
  getStatus: vi.fn().mockResolvedValue({ reports: [] }),
  getSelection: vi.fn().mockResolvedValue({ schemaVersion: 1, modules: {} }),
  postCapture: vi.fn().mockResolvedValue({ changes: [] }),
  postLoad: vi.fn().mockResolvedValue({ results: [] }),
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all nav tabs", () => {
    render(<App />);
    // Multiple "Overview" buttons exist (nav tab + action bar) — use getAllByRole
    expect(screen.getAllByRole("button", { name: "Overview" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Manage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Drift" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("shows the Roost brand name", () => {
    render(<App />);
    expect(screen.getByText("Roost")).toBeTruthy();
  });

  it("shows local shield chip", () => {
    render(<App />);
    expect(screen.getByText("local")).toBeTruthy();
  });

  it("command palette opens when Actions button is clicked in action bar", () => {
    render(<App />);
    const actionsBtn = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(actionsBtn);
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  it("command palette closes on Escape", () => {
    render(<App />);
    const actionsBtn = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(actionsBtn);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
