import { describe, it, expect } from "vitest";
import type { Candidate } from "@roost/shared";
import { buildSelection } from "./wizard.js";

function makeCandidate(id: string, recommendation: Candidate["recommendation"] = "track"): Candidate {
  return { id, path: id, category: "misc", recommendation };
}

describe("buildSelection", () => {
  it("groups chosen ids by module, keeping only chosen ones", () => {
    const byModule: Record<string, Candidate[]> = {
      dotfiles: [makeCandidate("/home/.zshrc"), makeCandidate("/home/.vimrc")],
      packages: [makeCandidate("brew/git"), makeCandidate("brew/curl")],
    };
    const chosen = new Set(["/home/.zshrc", "brew/git"]);

    const result = buildSelection(byModule, chosen);

    expect(result.modules["dotfiles"]).toEqual(["/home/.zshrc"]);
    expect(result.modules["packages"]).toEqual(["brew/git"]);
  });

  it("omits a module entirely when none of its candidates are chosen", () => {
    const byModule: Record<string, Candidate[]> = {
      dotfiles: [makeCandidate("/home/.zshrc")],
      packages: [makeCandidate("brew/git")],
    };
    // Only dotfiles chosen — packages should be absent
    const chosen = new Set(["/home/.zshrc"]);

    const result = buildSelection(byModule, chosen);

    expect(result.modules["dotfiles"]).toEqual(["/home/.zshrc"]);
    expect(result.modules["packages"]).toBeUndefined();
    expect(Object.keys(result.modules)).toHaveLength(1);
  });

  it("returns empty modules when no ids are chosen", () => {
    const byModule: Record<string, Candidate[]> = {
      dotfiles: [makeCandidate("/home/.zshrc")],
    };
    const chosen = new Set<string>();

    const result = buildSelection(byModule, chosen);

    expect(Object.keys(result.modules)).toHaveLength(0);
  });
});
