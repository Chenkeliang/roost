import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext } from "@roost/shared";
import { saveSelection, emptySelection, loadSelection } from "@roost/core";
import { runLearn } from "./learn.js";

// ── helpers ───────────────────────────────────────────────────────────────────

type Call = { cmd: string; args: string[] };

function makeFakeExec(
  responses: Array<ExecResult | ((cmd: string, args: string[]) => ExecResult)>,
): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  let idx = 0;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      const resp = responses[idx] ?? { code: 0, stdout: "", stderr: "" };
      idx++;
      if (typeof resp === "function") return resp(cmd, args);
      return resp;
    },
  };
  return { exec, calls };
}

function makeCtx(
  overrides: Partial<ModuleContext> & { exec: Exec; repoDir: string },
): ModuleContext {
  return {
    home: os.homedir(),
    profile: "base",
    dryRun: false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (key: string) => key,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-learn-cli-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── runLearn ──────────────────────────────────────────────────────────────────

describe("runLearn", () => {
  it("detects a changed domain, writes its plist, and updates selection", async () => {
    const domain = "com.apple.dock";
    const xmlBefore = "<plist><dict><key>before</key></dict></plist>";
    const xmlAfter = "<plist><dict><key>after</key></dict></plist>";

    // Exec sequence:
    //   1. defaults domains (before snapshot — returns only com.apple.dock)
    //   2. defaults export com.apple.dock - (before)
    //   3. defaults domains (after snapshot)
    //   4. defaults export com.apple.dock - (after — DIFFERENT content)
    //   5. defaults export com.apple.dock - (capture into repo)
    const { exec } = makeFakeExec([
      { code: 0, stdout: domain, stderr: "" },             // domains (before)
      { code: 0, stdout: xmlBefore, stderr: "" },          // export before
      { code: 0, stdout: domain, stderr: "" },             // domains (after)
      { code: 0, stdout: xmlAfter, stderr: "" },           // export after
      { code: 0, stdout: xmlAfter, stderr: "" },           // capture export
    ]);

    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });

    // Save an initial (empty) selection
    saveSelection(repoDir, emptySelection());

    const ctx = makeCtx({ exec, repoDir });
    const confirm = async () => { /* stub: resolves immediately */ };

    const result = await runLearn({ ctx, repoDir, confirm });

    // Returns the changed domain
    expect(result.changedDomains).toContain(domain);

    // Plist file was written
    const expectedPlist = path.join(repoDir, "roost/appconfig", `${domain}.plist`);
    expect(fs.existsSync(expectedPlist)).toBe(true);
    expect(fs.readFileSync(expectedPlist, "utf8")).toBe(xmlAfter);

    // Selection now contains domain:com.apple.dock under appconfig
    const sel = loadSelection(repoDir);
    expect(sel.modules["appconfig"]).toContain(`domain:${domain}`);
  });

  it("returns empty changedDomains when nothing changed", async () => {
    const domain = "com.apple.dock";
    const xml = "<plist><dict></dict></plist>";

    const { exec } = makeFakeExec([
      { code: 0, stdout: domain, stderr: "" },  // domains before
      { code: 0, stdout: xml, stderr: "" },      // export before
      { code: 0, stdout: domain, stderr: "" },  // domains after
      { code: 0, stdout: xml, stderr: "" },      // export after (same)
    ]);

    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    saveSelection(repoDir, emptySelection());

    const ctx = makeCtx({ exec, repoDir });
    const confirm = async () => {};

    const result = await runLearn({ ctx, repoDir, confirm });

    expect(result.changedDomains).toHaveLength(0);
  });

  it("does not overwrite an existing selection entry for unrelated modules", async () => {
    const domain = "com.apple.dock";
    const xml = "<plist><dict><key>v</key></dict></plist>";
    const xmlAfter = "<plist><dict><key>v2</key></dict></plist>";

    const { exec } = makeFakeExec([
      { code: 0, stdout: domain, stderr: "" },
      { code: 0, stdout: xml, stderr: "" },
      { code: 0, stdout: domain, stderr: "" },
      { code: 0, stdout: xmlAfter, stderr: "" },
      { code: 0, stdout: xmlAfter, stderr: "" },
    ]);

    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });

    // Pre-existing selection with dotfiles
    let sel = emptySelection();
    sel = { ...sel, modules: { ...sel.modules, dotfiles: ["/home/user/.zshrc"] } };
    saveSelection(repoDir, sel);

    const ctx = makeCtx({ exec, repoDir });
    const result = await runLearn({ ctx, repoDir, confirm: async () => {} });

    expect(result.changedDomains).toContain(domain);

    const after = loadSelection(repoDir);
    // dotfiles still present
    expect(after.modules["dotfiles"]).toContain("/home/user/.zshrc");
    // appconfig added
    expect(after.modules["appconfig"]).toContain(`domain:${domain}`);
  });
});
