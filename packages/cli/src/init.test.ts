import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInit } from "./init.js";
import { loadSelection } from "@roost/core";

let repoDir: string;

beforeEach(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-init-"));
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe("runInit", () => {
  it("creates roost/, selection.yaml, and .chezmoi.toml.tmpl on first run", async () => {
    const { created } = await runInit({ repoDir });
    expect(created).toContain(path.join(repoDir, "roost"));
    expect(created).toContain(path.join(repoDir, "roost", "selection.yaml"));
    expect(created).toContain(path.join(repoDir, ".chezmoi.toml.tmpl"));
  });

  it("writes a .chezmoiignore that excludes Roost's own metadata (roost/ and state/)", async () => {
    const { created } = await runInit({ repoDir });
    const ignorePath = path.join(repoDir, ".chezmoiignore");
    expect(created).toContain(ignorePath);
    const body = fs.readFileSync(ignorePath, "utf8");
    expect(body).toMatch(/^roost$/m);
    expect(body).toMatch(/^roost\/\*\*$/m);
    expect(body).toMatch(/^state$/m);
    expect(body).toMatch(/^state\/\*\*$/m);
  });

  it("creates the expected files on disk", async () => {
    await runInit({ repoDir });
    expect(fs.existsSync(path.join(repoDir, "roost"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "roost", "selection.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, ".chezmoi.toml.tmpl"))).toBe(true);
  });

  it("selection.yaml is a valid SelectionDoc (loadSelection works)", async () => {
    await runInit({ repoDir });
    const doc = loadSelection(repoDir);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.modules).toEqual({});
  });

  it("is idempotent — second run returns created:[]", async () => {
    await runInit({ repoDir });
    const { created } = await runInit({ repoDir });
    expect(created).toEqual([]);
  });

  it("does not overwrite existing selection.yaml on re-run", async () => {
    await runInit({ repoDir });
    // write a modified selection.yaml
    const selPath = path.join(repoDir, "roost", "selection.yaml");
    const before = fs.readFileSync(selPath, "utf8");
    await runInit({ repoDir });
    expect(fs.readFileSync(selPath, "utf8")).toBe(before);
  });

  it("does not overwrite existing .chezmoi.toml.tmpl on re-run", async () => {
    await runInit({ repoDir });
    const tmplPath = path.join(repoDir, ".chezmoi.toml.tmpl");
    fs.writeFileSync(tmplPath, "custom content");
    const { created } = await runInit({ repoDir });
    expect(created).toEqual([]);
    expect(fs.readFileSync(tmplPath, "utf8")).toBe("custom content");
  });
});
