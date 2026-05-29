import { describe, it, expect } from "vitest";
import type { Candidate } from "@roost/shared";
import { PRESETS, getPreset, applyPreset } from "./presets.js";

function makeCandidate(id: string, recommendation: "track" | "encrypt" | "exclude" = "track"): Candidate {
  return { id, path: id, category: "other", recommendation };
}

const candidates: Candidate[] = [
  makeCandidate("/home/user/.zshrc"),
  makeCandidate("/home/user/.gitconfig"),
  makeCandidate("/home/user/.ssh/id_ed25519", "encrypt"),
  makeCandidate("Brewfile"),
  makeCandidate("/home/user/.vimrc"),
  makeCandidate("/home/user/.p10k.zsh"),
  makeCandidate("/home/user/.bash_profile"),
  makeCandidate("/home/user/.zprofile"),
  makeCandidate("/home/user/.zshenv"),
  makeCandidate("/home/user/.gitignore_global"),
  makeCandidate("/home/user/.npmrc", "encrypt"),
  makeCandidate("/home/user/.DS_Store", "exclude"),
];

describe("PRESETS", () => {
  it("has at least developer-essentials and everything", () => {
    const names = PRESETS.map((p) => p.name);
    expect(names).toContain("developer-essentials");
    expect(names).toContain("everything");
  });
});

describe("getPreset", () => {
  it("returns the preset by name", () => {
    const p = getPreset("developer-essentials");
    expect(p.name).toBe("developer-essentials");
  });

  it("throws for unknown preset name", () => {
    expect(() => getPreset("nonexistent-preset")).toThrow();
  });
});

describe("applyPreset developer-essentials", () => {
  it("selects .zshrc", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.endsWith(".zshrc"))).toBe(true);
  });

  it("selects Brewfile", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids).toContain("Brewfile");
  });

  it("selects .gitconfig", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.endsWith(".gitconfig"))).toBe(true);
  });

  it("selects .p10k.zsh", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.endsWith(".p10k.zsh"))).toBe(true);
  });

  it("selects .bash_profile", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.endsWith(".bash_profile"))).toBe(true);
  });

  it("selects .zprofile", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.endsWith(".zprofile"))).toBe(true);
  });

  it("selects .zshenv", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.endsWith(".zshenv"))).toBe(true);
  });

  it("selects .gitignore_global", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.endsWith(".gitignore_global"))).toBe(true);
  });

  it("does NOT select .ssh paths (not in essential basenames)", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.includes(".ssh"))).toBe(false);
  });

  it("does NOT select .vimrc (not a shell/git essential by basename)", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids.some((id) => id.endsWith(".vimrc"))).toBe(false);
  });
});

describe("applyPreset everything", () => {
  it("selects candidates whose recommendation is not exclude", () => {
    const ids = applyPreset("everything", candidates);
    // .DS_Store has recommendation "exclude" → must not be in result
    expect(ids.some((id) => id.includes(".DS_Store"))).toBe(false);
  });

  it("includes track and encrypt candidates", () => {
    const ids = applyPreset("everything", candidates);
    expect(ids.some((id) => id.endsWith(".zshrc"))).toBe(true);
    expect(ids.some((id) => id.endsWith(".npmrc"))).toBe(true); // encrypt but not excluded
  });
});
