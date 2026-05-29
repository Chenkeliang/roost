import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Exec, ExecResult, ModuleContext, Selection } from "@roost/shared";
import { classifyDotfile, isSensitivePath, dotfilesModule } from "./dotfiles.js";

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

// ── isSensitivePath ───────────────────────────────────────────────────────────

describe("isSensitivePath", () => {
  it("returns true for .ssh/ key path", () => {
    expect(isSensitivePath("/home/user/.ssh/id_ed25519")).toBe(true);
  });

  it("returns true for .ssh directory itself", () => {
    expect(isSensitivePath("/home/user/.ssh")).toBe(true);
  });

  it("returns true for .aws path", () => {
    expect(isSensitivePath("/home/user/.aws/credentials")).toBe(true);
  });

  it("returns true for .npmrc", () => {
    expect(isSensitivePath("/home/user/.npmrc")).toBe(true);
  });

  it("returns true for .git-credentials", () => {
    expect(isSensitivePath("/home/user/.git-credentials")).toBe(true);
  });

  it("returns true for .netrc", () => {
    expect(isSensitivePath("/home/user/.netrc")).toBe(true);
  });

  it("returns true for .config/gh/ path", () => {
    expect(isSensitivePath("/home/user/.config/gh/config.yml")).toBe(true);
  });

  it("returns true for .config/env.sh", () => {
    expect(isSensitivePath("/home/user/.config/env.sh")).toBe(true);
  });

  it("returns true for basename containing 'secret'", () => {
    expect(isSensitivePath("/home/user/.my-secret-config")).toBe(true);
  });

  it("returns true for basename containing 'token'", () => {
    expect(isSensitivePath("/home/user/.github-token")).toBe(true);
  });

  it("returns true for basename containing 'credential'", () => {
    expect(isSensitivePath("/home/user/.stored-credentials")).toBe(true);
  });

  it("returns true for .key extension", () => {
    expect(isSensitivePath("/home/user/id_rsa.key")).toBe(true);
  });

  it("returns true for .pem extension", () => {
    expect(isSensitivePath("/home/user/server.pem")).toBe(true);
  });

  it("returns false for .zshrc", () => {
    expect(isSensitivePath("/home/user/.zshrc")).toBe(false);
  });

  it("returns false for .vimrc", () => {
    expect(isSensitivePath("/home/user/.vimrc")).toBe(false);
  });

  it("returns false for .config/nvim/", () => {
    expect(isSensitivePath("/home/user/.config/nvim/init.lua")).toBe(false);
  });
});

// ── classifyDotfile ───────────────────────────────────────────────────────────

describe("classifyDotfile", () => {
  it(".zshrc → track", () => {
    expect(classifyDotfile("/home/user/.zshrc")).toBe("track");
  });

  it(".vimrc → track", () => {
    expect(classifyDotfile("/home/user/.vimrc")).toBe("track");
  });

  it(".ssh/id_ed25519 → encrypt", () => {
    expect(classifyDotfile("/home/user/.ssh/id_ed25519")).toBe("encrypt");
  });

  it(".npmrc → encrypt", () => {
    expect(classifyDotfile("/home/user/.npmrc")).toBe("encrypt");
  });

  it(".cache → exclude (noise)", () => {
    expect(classifyDotfile("/home/user/.cache")).toBe("exclude");
  });

  it(".DS_Store → exclude (noise)", () => {
    expect(classifyDotfile("/home/user/.DS_Store")).toBe("exclude");
  });

  it(".bash_history → exclude (noise)", () => {
    expect(classifyDotfile("/home/user/.bash_history")).toBe("exclude");
  });
});

// ── discover ──────────────────────────────────────────────────────────────────

describe("dotfilesModule.discover", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "roost-dotfiles-home-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("includes .zshrc as a track candidate", async () => {
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "# zsh");
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: tmpHome });
    const candidates = await dotfilesModule.discover(ctx);
    const zshrc = candidates.find((c) => c.path.endsWith(".zshrc"));
    expect(zshrc).toBeDefined();
    expect(zshrc!.recommendation).toBe("track");
  });

  it("includes .ssh as an encrypt candidate", async () => {
    fs.mkdirSync(path.join(tmpHome, ".ssh"));
    fs.writeFileSync(path.join(tmpHome, ".ssh", "id_ed25519"), "key-content");
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: tmpHome });
    const candidates = await dotfilesModule.discover(ctx);
    const ssh = candidates.find((c) => c.path.endsWith(".ssh"));
    expect(ssh).toBeDefined();
    expect(ssh!.recommendation).toBe("encrypt");
  });

  it("excludes .cache directory", async () => {
    fs.mkdirSync(path.join(tmpHome, ".cache"));
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "# zsh");
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: tmpHome });
    const candidates = await dotfilesModule.discover(ctx);
    expect(candidates.some((c) => c.path.endsWith(".cache"))).toBe(false);
  });

  it("includes items from .config subdirectory", async () => {
    fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".config", "nvim"), { recursive: true });
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: tmpHome });
    const candidates = await dotfilesModule.discover(ctx);
    const nvim = candidates.find((c) => c.path.endsWith("nvim"));
    expect(nvim).toBeDefined();
    expect(nvim!.recommendation).toBe("track");
  });

  it("assigns correct categories to known basenames", async () => {
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "");
    fs.writeFileSync(path.join(tmpHome, ".gitconfig"), "");
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: tmpHome });
    const candidates = await dotfilesModule.discover(ctx);
    const zshrc = candidates.find((c) => c.path.endsWith(".zshrc"));
    const gitconfig = candidates.find((c) => c.path.endsWith(".gitconfig"));
    expect(zshrc?.category).toBe("shell");
    expect(gitconfig?.category).toBe("git");
  });

  it("id equals the absolute path", async () => {
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "# zsh");
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: tmpHome });
    const candidates = await dotfilesModule.discover(ctx);
    const zshrc = candidates.find((c) => c.path.endsWith(".zshrc"));
    expect(zshrc!.id).toBe(zshrc!.path);
  });
});

// ── capture ───────────────────────────────────────────────────────────────────

describe("dotfilesModule.capture", () => {
  it("calls chezmoi add without --encrypt for non-sensitive id", async () => {
    const { exec, calls } = makeFakeExec([
      { code: 0, stdout: "", stderr: "" }, // chezmoi add .zshrc
    ]);
    const ctx = makeCtx({ exec, home: os.homedir() });
    const sel: Selection = { modules: { dotfiles: ["/home/user/.zshrc"] } };
    const result = await dotfilesModule.capture(ctx, sel);
    const addCall = calls.find(
      (c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes("/home/user/.zshrc"),
    );
    expect(addCall).toBeDefined();
    expect(addCall!.args).not.toContain("--encrypt");
    expect(result.module).toBe("dotfiles");
    expect(result.written).toContain("/home/user/.zshrc");
    expect(result.encrypted).toHaveLength(0);
  });

  it("calls chezmoi add with --encrypt for sensitive id", async () => {
    const { exec, calls } = makeFakeExec([
      { code: 0, stdout: "", stderr: "" }, // chezmoi add .ssh
    ]);
    const ctx = makeCtx({ exec, home: os.homedir() });
    const sel: Selection = { modules: { dotfiles: ["/home/user/.ssh"] } };
    const result = await dotfilesModule.capture(ctx, sel);
    const addCall = calls.find(
      (c) => c.cmd === "chezmoi" && c.args.includes("add") && c.args.includes("/home/user/.ssh"),
    );
    expect(addCall).toBeDefined();
    expect(addCall!.args).toContain("--encrypt");
    expect(result.encrypted).toContain("/home/user/.ssh");
    expect(result.written).toHaveLength(0);
  });

  it("handles empty selection gracefully", async () => {
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, home: os.homedir() });
    const sel: Selection = { modules: {} };
    const result = await dotfilesModule.capture(ctx, sel);
    expect(result.module).toBe("dotfiles");
    expect(result.written).toHaveLength(0);
    expect(result.encrypted).toHaveLength(0);
  });
});

// ── doctor ────────────────────────────────────────────────────────────────────

describe("dotfilesModule.doctor", () => {
  it("returns ok:true when chezmoi --version exits 0", async () => {
    const { exec } = makeFakeExec([{ code: 0, stdout: "chezmoi version 2.x", stderr: "" }]);
    const ctx = makeCtx({ exec, home: os.homedir() });
    const health = await dotfilesModule.doctor(ctx);
    expect(health).toHaveLength(1);
    expect(health[0]!).toMatchObject({ name: "chezmoi", ok: true });
    expect(health[0]!.detail).toBeUndefined();
  });

  it("returns ok:false with detail when chezmoi --version exits non-zero", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "", stderr: "not found" }]);
    const ctx = makeCtx({ exec, home: os.homedir() });
    const health = await dotfilesModule.doctor(ctx);
    expect(health[0]!).toMatchObject({ name: "chezmoi", ok: false });
    expect(health[0]!.detail).toBeTruthy();
  });
});
