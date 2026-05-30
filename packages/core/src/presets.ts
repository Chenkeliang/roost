import type { Candidate } from "@roost/shared";
import * as path from "node:path";

export interface Preset {
  name: string;
  description: string;
  match(c: Candidate): boolean;
}

const DEVELOPER_ESSENTIAL_BASENAMES = new Set([
  ".zshrc",
  ".zprofile",
  ".zshenv",
  ".bashrc",
  ".bash_profile",
  ".gitconfig",
  ".gitignore_global",
  ".p10k.zsh",
]);

// Shell RC files only (for shell-only and terminal presets)
const SHELL_RC_BASENAMES = new Set([
  ".zshrc",
  ".zprofile",
  ".zshenv",
  ".bashrc",
  ".bash_profile",
  ".p10k.zsh",
]);

// Terminal-relevant app config domains (terminal emulators + editors)
const TERMINAL_APP_DOMAINS = new Set([
  "com.googlecode.iterm2",
  "com.apple.Terminal",
  "net.kovidgoyal.kitty",
  "com.github.wez.wezterm",
  "dev.warp.Warp-Stable",
  "com.microsoft.VSCode",
  "com.neovide.neovide",
]);

export const PRESETS: Preset[] = [
  {
    name: "developer-essentials",
    description: "Core shell, git, and package manager files every developer needs",
    match(c: Candidate): boolean {
      const base = path.basename(c.id);
      if (DEVELOPER_ESSENTIAL_BASENAMES.has(base)) return true;
      if (c.id === "Brewfile") return true;
      return false;
    },
  },
  {
    name: "terminal",
    description: "Shell RC files plus terminal emulator and editor app config domains",
    match(c: Candidate): boolean {
      const base = path.basename(c.id);
      if (SHELL_RC_BASENAMES.has(base)) return true;
      // appconfig candidates have ids like "domain:<bundle-id>"
      if (c.id.startsWith("domain:")) {
        const domain = c.id.slice("domain:".length);
        if (TERMINAL_APP_DOMAINS.has(domain)) return true;
      }
      return false;
    },
  },
  {
    name: "shell-only",
    description: "Shell RC files only (.zshrc, .zprofile, .zshenv, .bashrc, .bash_profile, .p10k.zsh)",
    match(c: Candidate): boolean {
      return SHELL_RC_BASENAMES.has(path.basename(c.id));
    },
  },
  {
    name: "everything",
    description: "All candidates not explicitly excluded",
    match(c: Candidate): boolean {
      return c.recommendation !== "exclude";
    },
  },
];

export function getPreset(name: string): Preset {
  const preset = PRESETS.find((p) => p.name === name);
  if (!preset) throw new Error(`Unknown preset: "${name}". Available: ${PRESETS.map((p) => p.name).join(", ")}`);
  return preset;
}

export function applyPreset(name: string, candidates: Candidate[]): string[] {
  const preset = getPreset(name);
  return candidates.filter((c) => preset.match(c)).map((c) => c.id);
}
