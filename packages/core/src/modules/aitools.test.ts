import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext } from "@roost/shared";
import { aitoolsModule } from "./aitools.js";
import { emptySelection, addItem, saveSelection } from "../selection.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeExec(responses: ExecResult[]): {
  exec: Exec;
  calls: { cmd: string; args: string[] }[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
  let idx = 0;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      const result = responses[idx] ?? { code: 0, stdout: "", stderr: "" };
      idx++;
      return result;
    },
  };
  return { exec, calls };
}

function makeCtx(overrides: Partial<ModuleContext> & { exec: Exec; home: string }): ModuleContext {
  return {
    repoDir: "/tmp/roost-repo",
    profile: "default",
    dryRun: false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (key) => key,
    ...overrides,
  };
}

// ── aitools module ────────────────────────────────────────────────────────────

describe("aitools module", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-aitools-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discover emits existing catalog paths with tool labels, skips missing and dotfiles-managed ones", async () => {
    const home = tmpDir;
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "# global", "utf8");
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}", "utf8");
    const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir);
    // settings.json already managed by dotfiles → dedupe note, not a candidate
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", path.join(home, ".claude", "settings.json"));
    saveSelection(repoDir, sel);
    const ctx = makeCtx({ exec: makeFakeExec([]).exec, home, repoDir });
    const cands = await aitoolsModule.discover(ctx);
    const ids = cands.map((c) => c.id);
    expect(ids).toContain(path.join(home, ".claude", "CLAUDE.md"));
    expect(ids).not.toContain(path.join(home, ".claude", "settings.json"));
    expect(ids).not.toContain(path.join(home, ".claude.json")); // never-list, even if it existed
    const memo = cands.find((c) => c.id.endsWith("CLAUDE.md"))!;
    expect(memo.note).toContain("Claude Code");
  });

  it("capture encrypts catalog-encrypt paths; .claude.json with no mcpServers is silently skipped (ADR-0024 extract)", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, "Library/Application Support/Claude"), { recursive: true });
    const mcp = path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
    fs.writeFileSync(mcp, "{}", "utf8");
    const cred = path.join(home, ".claude.json");
    // .claude.json has no mcpServers → extract branch picks nothing → silently skipped
    fs.writeFileSync(cred, "{}", "utf8");
    // Create age key so ensureChezmoiAgeConfig returns ready:true
    fs.mkdirSync(path.join(home, ".config", "sops", "age"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "sops", "age", "keys.txt"), "AGE-SECRET-KEY-X");
    let sel = emptySelection();
    sel = addItem(sel, "aitools", mcp);
    sel = addItem(sel, "aitools", cred);
    const { exec, calls } = makeFakeExec(Array.from({ length: 10 }, () => ({ code: 0, stdout: "age1recipientkey", stderr: "" })));
    const ctx = makeCtx({ exec, home, repoDir });
    const cs = await aitoolsModule.capture(ctx, sel);
    const add = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes(mcp));
    expect(add).toBeDefined();
    expect(add!.args).toContain("--encrypt"); // catalog says encrypt for the MCP file
    // .claude.json silently skipped (no extractable fields) — not in blocked, not in encrypted
    expect(cs.blocked).not.toContain(cred);
    expect(cs.encrypted).not.toContain(cred);
    expect(calls.some((c) => c.args.includes(cred) && c.args.includes("add"))).toBe(false);
    expect(fs.existsSync(cred)).toBe(true); // local file untouched
  });
});

describe("aitools policy capture (ADR-0023)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-aitools-policy-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it(".claude.json routes to extract branch (ADR-0024); no mcpServers → silently skipped, not blocked-managed", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    // No mcpServers → nothing extractable → silent skip (not blocked-managed as in v1.1)
    const cred = path.join(home, ".claude.json"); fs.writeFileSync(cred, "{}", "utf8");
    let sel = emptySelection(); sel = addItem(sel, "aitools", cred);
    const { exec, calls } = makeFakeExec([]);
    const cs = await aitoolsModule.capture(makeCtx({ exec, home, repoDir }), sel);
    // In v1.2 the extract branch handles .claude.json; with no fields to pick, it silently continues
    expect(cs.blocked).not.toContain(cred);
    expect(calls.some((c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes(cred))).toBe(false);
    expect(fs.existsSync(cred)).toBe(true);
  });

  it("encrypt-policy path adds with --encrypt; plain path runs scanner then plain add", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, "Library/Application Support/Claude"), { recursive: true });
    const mcp = path.join(home, "Library/Application Support/Claude/claude_desktop_config.json"); fs.writeFileSync(mcp, "{}", "utf8");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    const mem = path.join(home, ".claude/CLAUDE.md"); fs.writeFileSync(mem, "# notes", "utf8");
    // Create age key so ensureChezmoiAgeConfig returns ready:true
    fs.mkdirSync(path.join(home, ".config", "sops", "age"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "sops", "age", "keys.txt"), "AGE-SECRET-KEY-X");
    let sel = emptySelection(); sel = addItem(sel, "aitools", mcp); sel = addItem(sel, "aitools", mem);
    const { exec, calls } = makeFakeExec(Array.from({ length: 12 }, () => ({ code: 0, stdout: "age1recipientkey", stderr: "" })));
    const cs = await aitoolsModule.capture(makeCtx({ exec, home, repoDir }), sel);
    const encAdd = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes(mcp));
    expect(encAdd!.args).toContain("--encrypt");
    expect(cs.written).toContain(mem);     // plain
    expect(cs.encrypted).toContain(mcp);   // encrypt
  });
});

describe("aitools field extraction (ADR-0024)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-aitools-ext-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("capture extracts only mcpServers; the token never enters the artifact JSON", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    const f = path.join(home, ".claude.json");
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { x: { command: "y" } }, oauthAccount: "TOKEN", projects: {} }), "utf8");
    // age key present so recipientFromKey works
    fs.mkdirSync(path.join(home, ".config/sops/age"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config/sops/age/keys.txt"), "AGE-SECRET-KEY-1");
    let sel = emptySelection(); sel = addItem(sel, "aitools", f);
    let captured = "";
    const exec: Exec = { async run(cmd, args) {
      if (cmd === "age-keygen") return { code: 0, stdout: "age1recipient", stderr: "" };
      if (cmd === "age" && args.includes("-r")) { const last = args[args.length - 1]; if (last) captured = fs.readFileSync(last, "utf8"); return { code: 0, stdout: "", stderr: "" }; }
      return { code: 0, stdout: "", stderr: "" };
    }};
    const cs = await aitoolsModule.capture(makeCtx({ exec, home, repoDir }), sel);
    expect(cs.encrypted).toContain(f);
    expect(captured).toContain("mcpServers");
    expect(captured).not.toContain("TOKEN");   // token never extracted
  });

  it("discover emits extract-entry candidate with · 提取 note", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    // .claude.json exists and has mcpServers (extract entry is a candidate only when the field exists)
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { a: {} } }), "utf8");
    const cands = await aitoolsModule.discover(makeCtx({ exec: makeFakeExec([]).exec, home, repoDir }));
    const c = cands.find((c) => c.path.endsWith(".claude.json"));
    expect(c).toBeDefined();
    expect(c!.note).toContain("提取");
  });

  it("apply merges mcpServers back, preserves token, backs up first, dryRun no-write", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    const f = path.join(home, ".claude.json");
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { old: 1 }, oauthAccount: "KEEPTOKEN" }), "utf8");
    // age key so decryptEnvSecret existsSync checks pass
    fs.mkdirSync(path.join(home, ".config/sops/age"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config/sops/age/keys.txt"), "k");
    // artifact file must exist so decryptEnvSecret skips the existsSync guard
    const artifactDir = path.join(repoDir, "aitools-extract");
    fs.mkdirSync(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, "claude-code__.claude.json.json.age");
    fs.writeFileSync(artifactPath, "ciphertext-placeholder", "utf8");
    const exec: Exec = { async run(cmd, args) {
      if (cmd === "age" && args.includes("-d")) return { code: 0, stdout: JSON.stringify({ mcpServers: { new: 2 } }), stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    }};
    const plan = { module: "aitools", actions: [{ id: f, kind: "update" as const, target: f }] };
    // dry-run: no write
    await aitoolsModule.apply({ ...makeCtx({ exec, home, repoDir }), dryRun: true }, plan);
    expect(JSON.parse(fs.readFileSync(f, "utf8")).mcpServers).toEqual({ old: 1 });
    // real: merge
    await aitoolsModule.apply(makeCtx({ exec, home, repoDir }), plan);
    const after = JSON.parse(fs.readFileSync(f, "utf8"));
    expect(after.mcpServers).toEqual({ new: 2 });
    expect(after.oauthAccount).toBe("KEEPTOKEN");   // token preserved
    expect(fs.existsSync(path.join(home, ".roost-backups", "aitools"))).toBe(true); // backed up
  });
});

describe("aitools MCP auto-detect (ADR-0024)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-aitools-autodetect-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suggests extraction for a JSON file with top-level mcpServers + a secret", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, ".weirdtool"), { recursive: true });
    const f = path.join(home, ".weirdtool", "config.json");
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { a: { command: "x" } }, apiKey: "AKIAIOSFODNN7EXAMPLE1234567890AB" }), "utf8");
    const cands = await aitoolsModule.discover(makeCtx({ exec: makeFakeExec([]).exec, home, repoDir }));
    const s = cands.find((c) => c.path === f);
    expect(s?.suggestExtract).toEqual(["mcpServers"]);
  });
  it("does NOT suggest when there is no secret, or no mcpServers", async () => {
    const home = tmpDir; const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, ".cleantool"), { recursive: true });
    fs.writeFileSync(path.join(home, ".cleantool", "config.json"), JSON.stringify({ mcpServers: { a: {} } }), "utf8"); // no secret
    fs.mkdirSync(path.join(home, ".other"), { recursive: true });
    fs.writeFileSync(path.join(home, ".other", "config.json"), JSON.stringify({ apiKey: "AKIAIOSFODNN7EXAMPLE1234567890AB" }), "utf8"); // no mcpServers
    const cands = await aitoolsModule.discover(makeCtx({ exec: makeFakeExec([]).exec, home, repoDir }));
    expect(cands.some((c) => c.suggestExtract)).toBe(false);
  });
});
