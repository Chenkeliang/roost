import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  emptySelection,
  loadSelection,
  saveSelection,
  addItem,
  removeItem,
  SELECTION_SCHEMA_VERSION,
} from "./selection.js";

let repoDir: string;

beforeEach(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-"));
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe("emptySelection", () => {
  it("returns a doc with schemaVersion and empty modules", () => {
    const doc = emptySelection();
    expect(doc.schemaVersion).toBe(SELECTION_SCHEMA_VERSION);
    expect(doc.modules).toEqual({});
  });
});

describe("loadSelection", () => {
  it("returns emptySelection when file is missing", () => {
    const doc = loadSelection(repoDir);
    expect(doc).toEqual(emptySelection());
  });

  it("round-trips save then load", () => {
    const original = emptySelection();
    const withItem = addItem(original, "brew", "git");
    saveSelection(repoDir, withItem);
    const loaded = loadSelection(repoDir);
    expect(loaded).toEqual(withItem);
  });

  it("throws on malformed YAML", () => {
    const roostDir = path.join(repoDir, "roost");
    fs.mkdirSync(roostDir, { recursive: true });
    fs.writeFileSync(path.join(roostDir, "selection.yaml"), ":::invalid yaml:::\n{[");
    expect(() => loadSelection(repoDir)).toThrow();
  });

  it("throws when schemaVersion is missing", () => {
    const roostDir = path.join(repoDir, "roost");
    fs.mkdirSync(roostDir, { recursive: true });
    fs.writeFileSync(path.join(roostDir, "selection.yaml"), "modules:\n  brew: []\n");
    expect(() => loadSelection(repoDir)).toThrow(/schemaVersion/);
  });

  it("throws when modules is not a map", () => {
    const roostDir = path.join(repoDir, "roost");
    fs.mkdirSync(roostDir, { recursive: true });
    fs.writeFileSync(path.join(roostDir, "selection.yaml"), "schemaVersion: 1\nmodules: not-an-object\n");
    expect(() => loadSelection(repoDir)).toThrow(/modules/);
  });
});

describe("saveSelection", () => {
  it("creates roost/ dir if it does not exist", () => {
    const doc = emptySelection();
    saveSelection(repoDir, doc);
    expect(fs.existsSync(path.join(repoDir, "roost", "selection.yaml"))).toBe(true);
  });
});

describe("addItem", () => {
  it("adds a new item to a module", () => {
    const doc = emptySelection();
    const result = addItem(doc, "brew", "git");
    expect(result.modules["brew"]).toContain("git");
  });

  it("deduplicates items", () => {
    const doc = emptySelection();
    const once = addItem(doc, "brew", "git");
    const twice = addItem(once, "brew", "git");
    expect(twice.modules["brew"]).toEqual(["git"]);
  });

  it("is immutable (original is unchanged)", () => {
    const doc = emptySelection();
    addItem(doc, "brew", "git");
    expect(doc.modules).toEqual({});
  });

  it("adds to an existing module list", () => {
    const doc = emptySelection();
    const first = addItem(doc, "brew", "git");
    const second = addItem(first, "brew", "node");
    expect(second.modules["brew"]).toEqual(["git", "node"]);
  });
});

describe("removeItem", () => {
  it("removes an existing item", () => {
    const doc = emptySelection();
    const withItem = addItem(doc, "brew", "git");
    const removed = removeItem(withItem, "brew", "git");
    expect(removed.modules["brew"]).not.toContain("git");
  });

  it("is immutable (original is unchanged)", () => {
    const doc = emptySelection();
    const withItem = addItem(doc, "brew", "git");
    removeItem(withItem, "brew", "git");
    expect(withItem.modules["brew"]).toContain("git");
  });

  it("removing non-existent item is a no-op", () => {
    const doc = emptySelection();
    const withItem = addItem(doc, "brew", "git");
    const result = removeItem(withItem, "brew", "curl");
    expect(result.modules["brew"]).toEqual(["git"]);
  });

  it("removing from non-existent module is a no-op", () => {
    const doc = emptySelection();
    const result = removeItem(doc, "brew", "git");
    expect(result.modules).toEqual({});
  });
});
