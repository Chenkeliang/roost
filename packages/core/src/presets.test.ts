import { describe, it, expect } from "vitest";
import type { Candidate } from "@roost/shared";
import { PRESETS, getPreset, applyPreset } from "./presets.js";

function makeCandidate(id: string, recommendation: "track" | "encrypt" | "exclude" = "track"): Candidate {
  return { id, path: id, category: "other", recommendation };
}

// env-module candidates: category is "env" and ids are kind-prefixed (see modules/env.ts).
function makeEnvCandidate(id: string, recommendation: "track" | "encrypt" | "exclude" = "track"): Candidate {
  return { id, path: "roost/env.yaml", category: "env", recommendation };
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
  makeCandidate("domain:com.googlecode.iterm2"),
  makeCandidate("domain:com.apple.dock"),
  // env module candidates (aliases / env vars / PATH / functions)
  makeEnvCandidate("alias:ll"),
  makeEnvCandidate("env:EDITOR"),
  makeEnvCandidate("env:API_KEY", "encrypt"),
  makeEnvCandidate("path:$HOME/bin"),
  makeEnvCandidate("function:mkcd"),
];

describe("PRESETS", () => {
  it("has developer-essentials, terminal, shell-only, and everything", () => {
    const names = PRESETS.map((p) => p.name);
    expect(names).toContain("developer-essentials");
    expect(names).toContain("terminal");
    expect(names).toContain("shell-only");
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

  it("selects env module items (portable shell aliases/env/PATH every dev needs)", () => {
    const ids = applyPreset("developer-essentials", candidates);
    expect(ids).toContain("alias:ll");
    expect(ids).toContain("env:EDITOR");
    expect(ids).toContain("path:$HOME/bin");
    expect(ids).toContain("function:mkcd");
  });
});

describe("applyPreset terminal", () => {
  it("selects shell RC files (.zshrc, .zprofile, .zshenv, .bash_profile, .p10k.zsh)", () => {
    const ids = applyPreset("terminal", candidates);
    expect(ids.some((id) => id.endsWith(".zshrc"))).toBe(true);
    expect(ids.some((id) => id.endsWith(".zprofile"))).toBe(true);
    expect(ids.some((id) => id.endsWith(".zshenv"))).toBe(true);
    expect(ids.some((id) => id.endsWith(".bash_profile"))).toBe(true);
    expect(ids.some((id) => id.endsWith(".p10k.zsh"))).toBe(true);
  });

  it("selects terminal app config domains (iterm2)", () => {
    const ids = applyPreset("terminal", candidates);
    expect(ids).toContain("domain:com.googlecode.iterm2");
  });

  it("does NOT select non-terminal appconfig domains (com.apple.dock)", () => {
    const ids = applyPreset("terminal", candidates);
    expect(ids).not.toContain("domain:com.apple.dock");
  });

  it("does NOT select .gitconfig (not a shell file)", () => {
    const ids = applyPreset("terminal", candidates);
    expect(ids.some((id) => id.endsWith(".gitconfig"))).toBe(false);
  });

  it("does NOT select Brewfile", () => {
    const ids = applyPreset("terminal", candidates);
    expect(ids).not.toContain("Brewfile");
  });

  it("selects env module items (aliases, env vars, PATH, functions)", () => {
    const ids = applyPreset("terminal", candidates);
    expect(ids).toContain("alias:ll");
    expect(ids).toContain("env:EDITOR");
    expect(ids).toContain("path:$HOME/bin");
    expect(ids).toContain("function:mkcd");
  });
});

describe("applyPreset shell-only", () => {
  it("selects shell RC files only", () => {
    const ids = applyPreset("shell-only", candidates);
    expect(ids.some((id) => id.endsWith(".zshrc"))).toBe(true);
    expect(ids.some((id) => id.endsWith(".bash_profile"))).toBe(true);
    expect(ids.some((id) => id.endsWith(".p10k.zsh"))).toBe(true);
  });

  it("does NOT select .gitconfig", () => {
    const ids = applyPreset("shell-only", candidates);
    expect(ids.some((id) => id.endsWith(".gitconfig"))).toBe(false);
  });

  it("does NOT select Brewfile", () => {
    const ids = applyPreset("shell-only", candidates);
    expect(ids).not.toContain("Brewfile");
  });

  it("does NOT select appconfig domains", () => {
    const ids = applyPreset("shell-only", candidates);
    expect(ids.some((id) => id.startsWith("domain:"))).toBe(false);
  });

  it("selects env module items (portable aliases / env / PATH belong in the shell)", () => {
    const ids = applyPreset("shell-only", candidates);
    expect(ids).toContain("alias:ll");
    expect(ids).toContain("env:EDITOR");
    expect(ids).toContain("path:$HOME/bin");
    expect(ids).toContain("function:mkcd");
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

  it("includes env module items (track and encrypt)", () => {
    const ids = applyPreset("everything", candidates);
    expect(ids).toContain("alias:ll");
    expect(ids).toContain("env:API_KEY"); // encrypt but not excluded
  });
});
