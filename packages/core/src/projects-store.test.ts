import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import {
  emptyProjects,
  loadProjects,
  saveProjects,
  PROJECTS_SCHEMA_VERSION,
} from "./projects.js";
import type { ProjectsDoc, ProjectEntry } from "./projects.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-projects-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── emptyProjects ─────────────────────────────────────────────────────────────

describe("emptyProjects", () => {
  it("returns correct schema version and empty projects array", () => {
    const doc = emptyProjects();
    expect(doc.schemaVersion).toBe(PROJECTS_SCHEMA_VERSION);
    expect(doc.projects).toEqual([]);
  });
});

// ── loadProjects — missing file ───────────────────────────────────────────────

describe("loadProjects — missing file", () => {
  it("returns empty doc when projects.yaml does not exist", () => {
    const doc = loadProjects(tmpDir);
    expect(doc.projects).toEqual([]);
    expect(doc.schemaVersion).toBe(PROJECTS_SCHEMA_VERSION);
  });
});

// ── round-trip ────────────────────────────────────────────────────────────────

describe("round-trip save/load", () => {
  it("persists and restores a projects doc", () => {
    const entry: ProjectEntry = {
      path: "/Users/test/myproject",
      repo: "git@github.com:test/myproject.git",
      envTool: "mise",
    };
    const doc: ProjectsDoc = {
      schemaVersion: PROJECTS_SCHEMA_VERSION,
      projects: [entry],
    };
    saveProjects(tmpDir, doc);
    const loaded = loadProjects(tmpDir);
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.projects[0]).toEqual(entry);
    expect(loaded.schemaVersion).toBe(PROJECTS_SCHEMA_VERSION);
  });

  it("creates the roost/ directory if it does not exist", () => {
    const nestedRepo = path.join(tmpDir, "subrepo");
    const doc = emptyProjects();
    saveProjects(nestedRepo, doc);
    expect(fs.existsSync(path.join(nestedRepo, "roost", "projects.yaml"))).toBe(true);
  });

  it("round-trips multiple entries preserving order", () => {
    const entries: ProjectEntry[] = [
      { path: "/a", repo: null, envTool: "none" },
      { path: "/b", repo: "https://github.com/x/y.git", envTool: "mise" },
    ];
    const doc: ProjectsDoc = { schemaVersion: PROJECTS_SCHEMA_VERSION, projects: entries };
    saveProjects(tmpDir, doc);
    const loaded = loadProjects(tmpDir);
    expect(loaded.projects).toEqual(entries);
  });
});

// ── malformed YAML ────────────────────────────────────────────────────────────

describe("loadProjects — malformed", () => {
  function writeRaw(content: string): void {
    const dir = path.join(tmpDir, "roost");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "projects.yaml"), content, "utf8");
  }

  it("throws when projects is not an array", () => {
    writeRaw(yaml.dump({ schemaVersion: 1, projects: "not-an-array" }));
    expect(() => loadProjects(tmpDir)).toThrow();
  });

  it("throws when an entry is missing path", () => {
    writeRaw(yaml.dump({ schemaVersion: 1, projects: [{ repo: null, envTool: "none" }] }));
    expect(() => loadProjects(tmpDir)).toThrow(/path/i);
  });

  it("throws when envTool has an invalid value", () => {
    writeRaw(
      yaml.dump({
        schemaVersion: 1,
        projects: [{ path: "/x", repo: null, envTool: "asdf" }],
      }),
    );
    expect(() => loadProjects(tmpDir)).toThrow(/envTool/i);
  });

  it("throws when the root is not an object", () => {
    writeRaw("- just a list item\n");
    expect(() => loadProjects(tmpDir)).toThrow();
  });
});
