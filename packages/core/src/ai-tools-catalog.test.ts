import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAiToolsCatalog, DEFAULT_AI_TOOLS_CATALOG, effectivePolicy, aiPathPolicies } from "./ai-tools-catalog.js";
import { loadExternalManagers, DEFAULT_EXTERNAL_MANAGERS } from "./external-managers.js";

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-aicat-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("ai-tools catalog", () => {
  it("defaults include the v1 tools (credentials are now skip entries, not a separate list)", () => {
    const ids = DEFAULT_AI_TOOLS_CATALOG.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["claude-code", "claude-desktop", "codex", "gemini", "cc-switch"]));
    // credentials folded into catalog as policy:"skip" (ADR-0023)
    const codex = DEFAULT_AI_TOOLS_CATALOG.find((t) => t.id === "codex")!;
    expect(codex.paths.some((p) => p.path === ".codex/auth.json" && p.policy === "skip")).toBe(true);
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
    expect(cat.find((t) => t.id === "aider")!.paths[0]!.policy).toBe("encrypt"); // back-compat: encrypt:true → policy:"encrypt"
    expect(cat.find((t) => t.id === "claude-code")).toBeDefined(); // defaults kept
  });
  it("malformed override falls back to defaults", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "roost", "ai-tools-catalog.yaml"), "tools: 42", "utf8");
    expect(loadAiToolsCatalog(tmpDir)).toEqual(DEFAULT_AI_TOOLS_CATALOG);
  });
});

describe("ai catalog policy (ADR-0023)", () => {
  it("defaults to plain; reads encrypt/skip", () => {
    expect(effectivePolicy({ path: "x", kind: "settings" })).toBe("plain");
    expect(effectivePolicy({ path: "x", kind: "settings", policy: "encrypt" })).toBe("encrypt");
    expect(effectivePolicy({ path: "x", kind: "data", policy: "skip" })).toBe("skip");
  });
  it("credentials are skip entries in the catalog, not a separate list", () => {
    const cc = DEFAULT_AI_TOOLS_CATALOG.find((t) => t.id === "claude-code")!;
    expect(cc.paths.find((p) => p.path === ".claude.json")!.policy).toBe("skip");
    const gem = DEFAULT_AI_TOOLS_CATALOG.find((t) => t.id === "gemini")!;
    expect(gem.paths.some((p) => p.path === ".gemini/oauth_creds.json" && p.policy === "skip")).toBe(true);
    expect(gem.paths.some((p) => p.path === ".gemini/google_accounts.json" && p.policy === "skip")).toBe(true);
  });
  it("includes the v1.1 tools", () => {
    const ids = DEFAULT_AI_TOOLS_CATALOG.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["cursor", "windsurf", "zed", "copilot"]));
  });
  it("aiPathPolicies maps abs paths to policy", () => {
    const home = "/h";
    const m = aiPathPolicies("/repo-nonexistent", home);
    expect(m.get("/h/.claude.json")).toBe("skip");
    expect(m.get("/h/.claude/settings.local.json")).toBe("encrypt");
    expect(m.get("/h/.claude/CLAUDE.md")).toBe("plain");
  });
  it("override yaml back-compat: encrypt:true ⇒ encrypt", () => {
    // covered by loader test below; see existing override test pattern
  });
});

describe("external-managers", () => {
  it("defaults contain cc-switch", () => {
    const cc = DEFAULT_EXTERNAL_MANAGERS.find((m) => m.id === "cc-switch");
    expect(cc).toBeDefined();
    expect(cc!.roots).toContain(".cc-switch");
  });

  it("override adds a new manager by id", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "roost", "external-managers.yaml"),
      `managers:\n  - id: foo\n    label: Foo Manager\n    roots:\n      - .foo-manager\n`,
      "utf8",
    );
    const managers = loadExternalManagers(tmpDir);
    const foo = managers.find((m) => m.id === "foo");
    expect(foo).toBeDefined();
    expect(foo!.label).toBe("Foo Manager");
    expect(foo!.roots).toContain(".foo-manager");
    // defaults still present
    expect(managers.find((m) => m.id === "cc-switch")).toBeDefined();
  });

  it("malformed override falls back to defaults", () => {
    fs.mkdirSync(path.join(tmpDir, "roost"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "roost", "external-managers.yaml"), "managers: 99", "utf8");
    expect(loadExternalManagers(tmpDir)).toEqual(DEFAULT_EXTERNAL_MANAGERS);
  });
});

