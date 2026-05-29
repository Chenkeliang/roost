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
