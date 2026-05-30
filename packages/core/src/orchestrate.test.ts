import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext, Selection } from "@roost/shared";
import { defaultRegistry, discoverAll, captureAll, gateSecrets, statusAll, loadAll, indexAll } from "./orchestrate.js";

// ── fake exec ─────────────────────────────────────────────────────────────────

type FakeResponse = ExecResult | ((cmd: string, args: string[]) => ExecResult);

function makeFakeExec(responses: FakeResponse[]): {
  exec: Exec;
  calls: { cmd: string; args: string[] }[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
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

function makeCtx(overrides: Partial<ModuleContext> & { exec: Exec; home: string; repoDir: string }): ModuleContext {
  return {
    profile: "base",
    dryRun: false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (key: string) => key,
    ...overrides,
  };
}

// ── test state ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-orch-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── defaultRegistry ───────────────────────────────────────────────────────────

describe("defaultRegistry", () => {
  it("lists dotfiles, packages, appconfig, projects, and env modules", () => {
    const reg = defaultRegistry();
    const names = reg.list().map((m) => m.name);
    expect(names).toContain("dotfiles");
    expect(names).toContain("packages");
    expect(names).toContain("appconfig");
    expect(names).toContain("projects");
    expect(names).toContain("env");
    expect(names).toHaveLength(5);
  });
});

// ── discoverAll ───────────────────────────────────────────────────────────────

describe("discoverAll", () => {
  it("returns record keyed by module name", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "", stderr: "" }, // brew --version (packages discover)
    ]);
    const reg = defaultRegistry();
    const ctx = makeCtx({ exec, home: tmpDir, repoDir: tmpDir });
    const result = await discoverAll(reg, ctx);
    expect(result).toHaveProperty("dotfiles");
    expect(result).toHaveProperty("packages");
  });
});

// ── indexAll ──────────────────────────────────────────────────────────────────

describe("indexAll", () => {
  it("returns a ModuleIndex per module that implements index()", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "git version 2.x", stderr: "" }, // projects index → git --version
    ]);
    const reg = defaultRegistry();
    const ctx = makeCtx({ exec, home: tmpDir, repoDir: tmpDir });
    const result = await indexAll(reg, ctx);
    // projects implements index() → present and shaped
    expect(result["projects"]).toBeDefined();
    expect(typeof result["projects"]!.managed).toBe("number");
    expect(typeof result["projects"]!.available).toBe("boolean");
  });
});

// ── captureAll ───────────────────────────────────────────────────────────────

describe("captureAll", () => {
  it("invokes capture for modules present in selection, returns ChangeSets", async () => {
    // chezmoi add calls (one per dotfiles id) + brew bundle dump for packages
    const { exec, calls } = makeFakeExec(
      Array.from({ length: 20 }, () => ({ code: 0, stdout: "", stderr: "" })),
    );
    const reg = defaultRegistry();
    const repoDir = tmpDir;
    const home = tmpDir;
    const ctx = makeCtx({ exec, home, repoDir });

    // Create a selection with a dotfile and Brewfile
    const dotfileId = path.join(home, ".zshrc");
    const sel: Selection = {
      modules: {
        dotfiles: [dotfileId],
        packages: ["Brewfile"],
      },
    };

    const changeSets = await captureAll(reg, ctx, sel);

    expect(changeSets.length).toBe(2);
    const dotfilesCs = changeSets.find((cs) => cs.module === "dotfiles");
    const packagesCs = changeSets.find((cs) => cs.module === "packages");
    expect(dotfilesCs).toBeDefined();
    expect(packagesCs).toBeDefined();

    // chezmoi add was called for the dotfile
    const chezmoiCall = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add"));
    expect(chezmoiCall).toBeDefined();
    // brew bundle dump was called
    const brewCall = calls.find((c) => c.cmd === "brew" && c.args.includes("bundle"));
    expect(brewCall).toBeDefined();
  });

  it("skips modules not in selection", async () => {
    const { exec, calls } = makeFakeExec(
      Array.from({ length: 10 }, () => ({ code: 0, stdout: "", stderr: "" })),
    );
    const reg = defaultRegistry();
    const ctx = makeCtx({ exec, home: tmpDir, repoDir: tmpDir });

    // Only packages in selection
    const sel: Selection = { modules: { packages: ["Brewfile"] } };

    const changeSets = await captureAll(reg, ctx, sel);

    expect(changeSets.length).toBe(1);
    expect(changeSets[0]?.module).toBe("packages");

    // chezmoi add should NOT have been called
    const chezmoiAdd = calls.find((c) => c.cmd === "chezmoi" && c.args.includes("add"));
    expect(chezmoiAdd).toBeUndefined();
  });
});

// ── gateSecrets ───────────────────────────────────────────────────────────────

describe("gateSecrets", () => {
  it("throws when a file contains a plaintext secret", () => {
    const files = [
      { path: "/home/user/.zshrc", content: "export AWS_KEY=AKIAIOSFODNN7EXAMPLE1234" },
    ];
    expect(() => gateSecrets(files)).toThrow(/secret/i);
  });

  it("passes for clean content", () => {
    const files = [
      { path: "/home/user/.zshrc", content: "export PS1='%n@%m %1~ %# '" },
    ];
    expect(() => gateSecrets(files)).not.toThrow();
  });

  it("passes for empty files array", () => {
    expect(() => gateSecrets([])).not.toThrow();
  });
});

// ── statusAll ─────────────────────────────────────────────────────────────────

describe("statusAll", () => {
  it("returns DriftReports for each module in selection", async () => {
    const { exec } = makeFakeExec(
      Array.from({ length: 10 }, () => ({ code: 0, stdout: "", stderr: "" })),
    );
    const reg = defaultRegistry();
    const ctx = makeCtx({ exec, home: tmpDir, repoDir: tmpDir });
    const sel: Selection = {
      modules: { dotfiles: ["/home/user/.zshrc"], packages: ["Brewfile"] },
    };

    const reports = await statusAll(reg, ctx, sel);

    expect(reports.length).toBeGreaterThan(0);
    expect(reports.some((r) => r.module === "dotfiles")).toBe(true);
    expect(reports.some((r) => r.module === "packages")).toBe(true);
  });
});

// ── loadAll ───────────────────────────────────────────────────────────────────

describe("loadAll", () => {
  it("dryRun=true: no backup dir written, modules applied in dry-run mode", async () => {
    const { exec } = makeFakeExec(
      Array.from({ length: 10 }, () => ({ code: 0, stdout: "", stderr: "" })),
    );
    const reg = defaultRegistry();
    const ctx = makeCtx({ exec, home: tmpDir, repoDir: tmpDir, dryRun: true });
    const sel: Selection = { modules: { packages: ["Brewfile"] } };
    const backupDir = path.join(tmpDir, "backup");

    const results = await loadAll(reg, ctx, sel, { dryRun: true, backupDir });

    // Backup dir should not have been created (no dotfiles managed)
    expect(fs.existsSync(backupDir)).toBe(false);
    // Packages result: skipped (dry-run)
    const pkgResult = results.find((r) => r.module === "packages");
    expect(pkgResult).toBeDefined();
    expect(pkgResult?.skipped).toContain("Brewfile");
    expect(pkgResult?.applied).toHaveLength(0);
  });

  it("dryRun=false with dotfiles: backs up managed files that exist in home", async () => {
    // Create a real .zshrc in temp home
    const home = tmpDir;
    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });

    const zshrcPath = path.join(home, ".zshrc");
    fs.writeFileSync(zshrcPath, "# my zshrc");

    // chezmoi managed returns ".zshrc", then chezmoi apply runs
    const { exec } = makeFakeExec([
      { code: 0, stdout: ".zshrc\n", stderr: "" }, // chezmoi managed
      { code: 0, stdout: "", stderr: "" },          // chezmoi apply
    ]);
    const reg = defaultRegistry();
    const ctx = makeCtx({ exec, home, repoDir, dryRun: false });
    const backupDir = path.join(tmpDir, "backup");

    const sel: Selection = { modules: { dotfiles: [zshrcPath] } };

    const results = await loadAll(reg, ctx, sel, { dryRun: false, backupDir });

    const dotResult = results.find((r) => r.module === "dotfiles");
    expect(dotResult).toBeDefined();
    // backedUp should include zshrcPath since it exists
    expect(dotResult?.backedUp).toContain(zshrcPath);
    // backup dir was created and file copied (full path mirrored under backupDir)
    const zshrcRel = zshrcPath.replace(/^[/\\]/, "");
    expect(fs.existsSync(path.join(backupDir, zshrcRel))).toBe(true);
  });
});
