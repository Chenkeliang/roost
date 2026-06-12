import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAiToolsCatalog, DEFAULT_AI_TOOLS_CATALOG, NEVER_BACKUP } from "./ai-tools-catalog.js";

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-aicat-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("ai-tools catalog", () => {
  it("defaults include the v1 tools and credential never-list", () => {
    const ids = DEFAULT_AI_TOOLS_CATALOG.map((t) => t.id);
    expect(ids).toEqual(["claude-code", "claude-desktop", "codex", "gemini", "cc-switch"]);
    expect(NEVER_BACKUP).toContain(".claude.json");
    expect(NEVER_BACKUP).toContain(".codex/auth.json");
  });
  it("override file replaces by id and adds new tools", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "roost", "ai-tools-catalog.yaml"), `
tools:
  - id: codex
    label: Codex CLI
    paths:
      - { path: .codex/config.toml, kind: settings }
  - id: aider
    label: aider
    paths:
      - { path: .aider.conf.yml, kind: settings, encrypt: true }
`, "utf8");
    const cat = loadAiToolsCatalog(tmpDir);
    expect(cat.find((t) => t.id === "codex")!.paths).toHaveLength(1);
    expect(cat.find((t) => t.id === "aider")!.paths[0]!.encrypt).toBe(true);
    expect(cat.find((t) => t.id === "claude-code")).toBeDefined(); // defaults kept
  });
  it("malformed override falls back to defaults", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "roost", "ai-tools-catalog.yaml"), "tools: 42", "utf8");
    expect(loadAiToolsCatalog(tmpDir)).toEqual(DEFAULT_AI_TOOLS_CATALOG);
  });
});
