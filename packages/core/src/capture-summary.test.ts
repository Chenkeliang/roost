import { describe, it, expect } from "vitest";
import { summarizeCapture } from "./capture-summary.js";
import type { ChangeSet } from "@roost/shared";

const cs = (module: string, written: string[] = [], encrypted: string[] = [], blocked?: { id: string; reason: string }[]): ChangeSet =>
  ({ module, written, encrypted, blocked: blocked?.map((b) => b.id), blockedDetail: blocked as ChangeSet["blockedDetail"] });

describe("summarizeCapture", () => {
  it("subject lists active modules with counts; body lists every id", () => {
    const r = summarizeCapture([cs("dotfiles", ["/u/.zshrc"], ["/u/.npmrc"]), cs("packages", ["Brewfile"]), cs("skills")]);
    expect(r.subject).toBe("capture: dotfiles(2) packages(1)");
    expect(r.body).toContain("dotfiles: /u/.zshrc, /u/.npmrc (encrypted)");
    expect(r.body).toContain("packages: Brewfile");
    expect(r.body).not.toContain("skills");
  });
  it("blocked items appear as blocked lines", () => {
    const r = summarizeCapture([cs("dotfiles", [], [], [{ id: "/u/huge.bin", reason: "large" }])]);
    expect(r.body).toContain("blocked: /u/huge.bin (large)");
  });
  it("empty → compatibility fallback", () => {
    expect(summarizeCapture([])).toEqual({ subject: "roost: capture", body: "" });
    expect(summarizeCapture([cs("dotfiles")])).toEqual({ subject: "roost: capture", body: "" });
  });
  it("subject overflow collapses to totals", () => {
    const many = Array.from({ length: 9 }, (_, i) => cs(`verylongmodulename${i}`, [`/a${i}`]));
    const r = summarizeCapture(many);
    expect(r.subject.length).toBeLessThanOrEqual(72);
    expect(r.subject).toMatch(/^capture: \d+ modules, \d+ items$/);
  });
});
