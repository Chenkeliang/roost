import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FreshnessBanners } from "./components/FreshnessBanners";
import * as api from "./api";
import type { GitStatus } from "./api";

vi.mock("./api", () => ({
  gitPush: vi.fn().mockResolvedValue({ ok: true, output: "" }),
  gitPull: vi.fn().mockResolvedValue({ ok: true, output: "" }),
}));
const t = (k: string) => k;
const GS = (over: Partial<GitStatus> = {}): GitStatus =>
  ({ isRepo: true, remote: "git@x:y.git", branch: "main", ahead: 0, behind: 0, clean: true, ...over });
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

describe("FreshnessBanners", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when everything is fresh", () => {
    const { container } = render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS()} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("update banner: shows version, Download + dismiss", () => {
    const onDismiss = vi.fn();
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS()} lastCaptureAt={daysAgo(1)}
        update={{ version: "v0.9.0", url: "https://x" }} onDismissUpdate={onDismiss} onRefresh={() => {}} />,
    );
    expect(screen.getByText(/v0\.9\.0/)).toBeInTheDocument();
    screen.getByRole("button", { name: "fresh.update.dismiss" }).click();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("behind banner pulls and refreshes", async () => {
    const onRefresh = vi.fn();
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ behind: 3 })} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={onRefresh} />,
    );
    expect(screen.getByText(/3/)).toBeInTheDocument();
    screen.getByRole("button", { name: "fresh.behind.pull" }).click();
    await waitFor(() => expect(api.gitPull).toHaveBeenCalled());
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("ahead banner pushes; auth failure shows the terminal hint", async () => {
    vi.mocked(api.gitPush).mockResolvedValueOnce({ ok: false, output: "denied", hint: "auth" });
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ ahead: 2 })} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    screen.getByRole("button", { name: "fresh.ahead.push" }).click();
    expect(await screen.findByText("fresh.ahead.authHint")).toBeInTheDocument();
  });

  it("ahead banner hidden when there is no remote", () => {
    render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ ahead: 2, remote: null })} lastCaptureAt={daysAgo(1)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "fresh.ahead.push" })).toBeNull();
  });

  it("stale banner appears at 7+ days and when never backed up", () => {
    const { rerender } = render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS()} lastCaptureAt={daysAgo(8)} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(screen.getByText(/fresh\.stale\.title/)).toBeInTheDocument();
    rerender(
      <FreshnessBanners t={t} locale="en" gitStatus={GS()} lastCaptureAt={null} update={null} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(screen.getByText("fresh.stale.never")).toBeInTheDocument();
  });

  it("no banners at all when there is no repo (onboarding owns that state)", () => {
    const { container } = render(
      <FreshnessBanners t={t} locale="en" gitStatus={GS({ isRepo: false })} lastCaptureAt={null}
        update={{ version: "v9", url: "x" }} onDismissUpdate={() => {}} onRefresh={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });
});
