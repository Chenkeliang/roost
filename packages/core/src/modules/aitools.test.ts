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

  it("capture encrypts catalog-encrypt paths and blocks never-backup ids", async () => {
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "repo"); fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(home, "Library/Application Support/Claude"), { recursive: true });
    const mcp = path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
    fs.writeFileSync(mcp, "{}", "utf8");
    const cred = path.join(home, ".claude.json");
    fs.writeFileSync(cred, "{}", "utf8");
    // Create age key so ensureChezmoiAgeConfig returns ready:true
    fs.mkdirSync(path.join(home, ".config", "sops", "age"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "sops", "age", "keys.txt"), "AGE-SECRET-KEY-X");
    let sel = emptySelection();
    sel = addItem(sel, "aitools", mcp);
    sel = addItem(sel, "aitools", cred); // hand-added credential — must be refused
    const { exec, calls } = makeFakeExec(Array.from({ length: 10 }, () => ({ code: 0, stdout: "age1recipientkey", stderr: "" })));
    const ctx = makeCtx({ exec, home, repoDir });
    const cs = await aitoolsModule.capture(ctx, sel);
    const add = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes(mcp));
    expect(add).toBeDefined();
    expect(add!.args).toContain("--encrypt"); // catalog says encrypt for the MCP file
    expect(cs.blockedDetail?.some((b) => b.id === cred && b.reason === "managed")).toBe(true);
    expect(calls.some((c) => c.args.includes(cred) && c.args.includes("add"))).toBe(false);
    expect(fs.existsSync(cred)).toBe(true); // local file untouched
  });
});
