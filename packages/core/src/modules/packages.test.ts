import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext, Selection, ApplyPlan } from "@roost/shared";
import { packagesModule } from "./packages.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeExec(
  responses: Array<Partial<ExecResult> & { code: number }>,
): {
  exec: Exec;
  calls: { cmd: string; args: string[] }[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
  let idx = 0;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      const r = responses[idx] ?? { code: 0 };
      idx++;
      return { code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
  return { exec, calls };
}

function makeCtx(
  overrides: Partial<ModuleContext> & { exec: Exec; repoDir: string },
): ModuleContext {
  return {
    home: os.homedir(),
    profile: "default",
    dryRun: false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    t: (key) => key,
    ...overrides,
  };
}

// ── discover ──────────────────────────────────────────────────────────────────

describe("packagesModule.discover", () => {
  it("returns a single Brewfile candidate with correct shape", async () => {
    const { exec } = makeFakeExec([{ code: 0, stdout: "Homebrew 4.x", stderr: "" }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const candidates = await packagesModule.discover(ctx);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.id).toBe("Brewfile");
    expect(c.path).toBe("roost/Brewfile");
    expect(c.category).toBe("packages");
    expect(c.recommendation).toBe("track");
  });

  it("note is a non-empty string", async () => {
    const { exec } = makeFakeExec([{ code: 0 }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const candidates = await packagesModule.discover(ctx);
    expect(typeof candidates[0]!.note).toBe("string");
    expect(candidates[0]!.note!.length).toBeGreaterThan(0);
  });

  it("still returns the candidate when brew is absent (code non-zero)", async () => {
    const { exec } = makeFakeExec([{ code: 127, stdout: "", stderr: "brew: command not found" }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const candidates = await packagesModule.discover(ctx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe("Brewfile");
  });
});

// ── capture ───────────────────────────────────────────────────────────────────

describe("packagesModule.capture", () => {
  it("runs brew bundle dump when Brewfile is selected", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0 }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const sel: Selection = { modules: { packages: ["Brewfile"] } };
    const result = await packagesModule.capture(ctx, sel);

    // Assert argv
    const dumpCall = calls.find((c) => c.cmd === "brew" && c.args.includes("bundle"));
    expect(dumpCall).toBeDefined();
    expect(dumpCall!.args).toContain("dump");
    expect(dumpCall!.args).toContain("--force");
    const fileArg = dumpCall!.args.find((a) => a.includes("roost/Brewfile"));
    expect(fileArg).toBeDefined();

    // Return value
    expect(result.module).toBe("packages");
    expect(result.written).toEqual(["roost/Brewfile"]);
    expect(result.encrypted).toHaveLength(0);
  });

  it("does NOT run brew when Brewfile is not selected", async () => {
    const { exec, calls } = makeFakeExec([]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const sel: Selection = { modules: {} };
    const result = await packagesModule.capture(ctx, sel);

    expect(calls.filter((c) => c.cmd === "brew")).toHaveLength(0);
    expect(result.module).toBe("packages");
    expect(result.written).toHaveLength(0);
    expect(result.encrypted).toHaveLength(0);
  });

  it("throws when brew bundle dump exits non-zero", async () => {
    const { exec } = makeFakeExec([{ code: 1, stderr: "error" }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const sel: Selection = { modules: { packages: ["Brewfile"] } };
    await expect(packagesModule.capture(ctx, sel)).rejects.toThrow();
  });
});

// ── apply ─────────────────────────────────────────────────────────────────────

describe("packagesModule.apply", () => {
  it("runs 'brew bundle --file <path>' in real mode and returns applied", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0 }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo", dryRun: false });
    const plan: ApplyPlan = { module: "packages", actions: [] };
    const result = await packagesModule.apply(ctx, plan);

    const bundleCall = calls.find((c) => c.cmd === "brew" && c.args.includes("bundle"));
    expect(bundleCall).toBeDefined();
    // Should NOT contain "check" in real mode
    expect(bundleCall!.args).not.toContain("check");

    expect(result.module).toBe("packages");
    expect(result.applied).toContain("Brewfile");
    expect(result.skipped).toHaveLength(0);
    expect(result.backedUp).toHaveLength(0);
  });

  it("runs 'brew bundle check --file <path>' in dryRun mode and returns skipped", async () => {
    const { exec, calls } = makeFakeExec([{ code: 0 }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo", dryRun: true });
    const plan: ApplyPlan = { module: "packages", actions: [] };
    const result = await packagesModule.apply(ctx, plan);

    const checkCall = calls.find((c) => c.cmd === "brew" && c.args.includes("check"));
    expect(checkCall).toBeDefined();
    // Should NOT be a full install
    expect(checkCall!.args).not.toContain("install");

    expect(result.module).toBe("packages");
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toContain("Brewfile");
    expect(result.backedUp).toHaveLength(0);
  });

  it("throws when brew bundle exits non-zero in real mode", async () => {
    const { exec } = makeFakeExec([{ code: 1, stderr: "install failed" }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo", dryRun: false });
    const plan: ApplyPlan = { module: "packages", actions: [] };
    await expect(packagesModule.apply(ctx, plan)).rejects.toThrow();
  });
});

// ── status ────────────────────────────────────────────────────────────────────

describe("packagesModule.status", () => {
  it("returns synced when brew bundle check exits 0", async () => {
    const { exec } = makeFakeExec([{ code: 0 }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const sel: Selection = { modules: { packages: ["Brewfile"] } };
    const report = await packagesModule.status(ctx, sel);

    expect(report.module).toBe("packages");
    expect(report.items).toHaveLength(1);
    expect(report.items[0]!.id).toBe("Brewfile");
    expect(report.items[0]!.state).toBe("synced");
  });

  it("returns drift when brew bundle check exits non-zero", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "Missing: foo" }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const sel: Selection = { modules: { packages: ["Brewfile"] } };
    const report = await packagesModule.status(ctx, sel);

    expect(report.items[0]!.state).toBe("drift");
  });

  it("does NOT call brew when packages are not selected (status guard)", async () => {
    // A throwing exec proves no external command runs on the unmanaged path.
    const exec = {
      run: async () => {
        throw new Error("exec must not be called when packages unmanaged");
      },
    } as unknown as import("@roost/shared").Exec;
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const report = await packagesModule.status(ctx, { modules: {} });
    expect(report.module).toBe("packages");
    expect(report.items).toHaveLength(0);
  });
});

// ── diff ──────────────────────────────────────────────────────────────────────

describe("packagesModule.diff", () => {
  it("returns stdout of brew bundle check --verbose when code non-zero", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "Missing: jq\nMissing: fzf" }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const sel: Selection = { modules: {} };
    const out = await packagesModule.diff(ctx, sel);
    expect(out).toContain("Missing: jq");
  });

  it("returns empty string when brew bundle check exits 0", async () => {
    const { exec } = makeFakeExec([{ code: 0, stdout: "Everything's fine" }]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const sel: Selection = { modules: {} };
    const out = await packagesModule.diff(ctx, sel);
    expect(out).toBe("");
  });
});

// ── unmanage ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-packages-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("packagesModule.unmanage", () => {
  it("removes the Brewfile from the repo and returns applied", async () => {
    // Create a Brewfile in the repo
    const brewDir = path.join(tmpDir, "roost");
    fs.mkdirSync(brewDir, { recursive: true });
    fs.writeFileSync(path.join(brewDir, "Brewfile"), "brew 'jq'\n");

    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { packages: ["Brewfile"] } };
    const result = await packagesModule.unmanage(ctx, sel);

    expect(result.module).toBe("packages");
    expect(result.applied).toContain("Brewfile");
    expect(result.skipped).toHaveLength(0);
    expect(fs.existsSync(path.join(brewDir, "Brewfile"))).toBe(false);
  });

  it("returns skipped when Brewfile is absent (already removed)", async () => {
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { packages: ["Brewfile"] } };
    const result = await packagesModule.unmanage(ctx, sel);

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toContain("Brewfile");
  });

  it("returns empty result when Brewfile is not in selection", async () => {
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: {} };
    const result = await packagesModule.unmanage(ctx, sel);

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("logs a git history warning when Brewfile is removed", async () => {
    const brewDir = path.join(tmpDir, "roost");
    fs.mkdirSync(brewDir, { recursive: true });
    fs.writeFileSync(path.join(brewDir, "Brewfile"), "brew 'jq'\n");

    const { exec } = makeFakeExec([]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      repoDir: tmpDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = { modules: { packages: ["Brewfile"] } };
    await packagesModule.unmanage(ctx, sel);

    expect(warnSpy).toHaveBeenCalled();
    const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
    expect(msg).toMatch(/git.*history|history.*git/i);
    expect(msg).toMatch(/filter-repo|BFG/i);
  });

  it("does NOT log git history warning when nothing is removed", async () => {
    const { exec } = makeFakeExec([]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      repoDir: tmpDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = { modules: {} };
    await packagesModule.unmanage(ctx, sel);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── doctor ────────────────────────────────────────────────────────────────────

describe("packagesModule.doctor", () => {
  it("returns brew ok:true and mas ok:true when both exit 0", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "Homebrew 4.x" },
      { code: 0, stdout: "mas version 1.8" },
    ]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const health = await packagesModule.doctor(ctx);
    expect(health).toHaveLength(2);
    const brew = health.find((h) => h.name === "brew");
    const mas = health.find((h) => h.name === "mas");
    expect(brew).toBeDefined();
    expect(brew!.ok).toBe(true);
    expect(brew!.detail).toBeUndefined();
    expect(mas).toBeDefined();
    expect(mas!.ok).toBe(true);
  });

  it("returns brew ok:false when brew exits non-zero", async () => {
    const { exec } = makeFakeExec([
      { code: 127, stderr: "brew not found" },
      { code: 0 },
    ]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const health = await packagesModule.doctor(ctx);
    const brew = health.find((h) => h.name === "brew");
    expect(brew!.ok).toBe(false);
    expect(brew!.detail).toBeTruthy();
  });

  it("returns mas ok:false with detail when mas exits non-zero", async () => {
    const { exec } = makeFakeExec([
      { code: 0 },
      { code: 127, stderr: "mas not found" },
    ]);
    const ctx = makeCtx({ exec, repoDir: "/tmp/roost-repo" });
    const health = await packagesModule.doctor(ctx);
    const mas = health.find((h) => h.name === "mas");
    expect(mas!.ok).toBe(false);
    expect(mas!.detail).toContain("App Store");
  });
});

// ── index ─────────────────────────────────────────────────────────────────────

describe("packagesModule.index", () => {
  let repoDir: string;
  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-packages-idx-"));
    fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("is cheap: probes brew --version + counts Brewfile lines, never runs brew bundle", async () => {
    fs.writeFileSync(
      path.join(repoDir, "roost", "Brewfile"),
      "# comment\nbrew \"git\"\n\nbrew \"jq\"\ncask \"firefox\"\n",
    );
    const { exec, calls } = makeFakeExec([{ code: 0, stdout: "Homebrew 4.x" }]);
    const ctx = makeCtx({ exec, repoDir });
    const idx = await packagesModule.index!(ctx);
    expect(idx.available).toBe(true);
    expect(idx.reason).toBeUndefined();
    expect(idx.managed).toBe(3);
    // never the heavy path
    expect(calls.every((c) => !c.args.includes("bundle"))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["--version"]);
  });

  it("reports unavailable with reason when brew is absent; managed still counted", async () => {
    fs.writeFileSync(path.join(repoDir, "roost", "Brewfile"), "brew \"git\"\n");
    const { exec } = makeFakeExec([{ code: 127, stderr: "command not found" }]);
    const ctx = makeCtx({ exec, repoDir });
    const idx = await packagesModule.index!(ctx);
    expect(idx.available).toBe(false);
    expect(idx.reason).toBe("Homebrew not installed");
    expect(idx.managed).toBe(1);
  });

  it("managed is 0 when no Brewfile exists", async () => {
    const { exec } = makeFakeExec([{ code: 0 }]);
    const ctx = makeCtx({ exec, repoDir });
    const idx = await packagesModule.index!(ctx);
    expect(idx.managed).toBe(0);
  });
});
