import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext, Selection, ApplyPlan } from "@roost/shared";
import { classifyDomain, appconfigModule, SENSITIVE_DOMAIN_HINTS } from "./appconfig.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeExec(
  responses: Array<ExecResult | ((cmd: string, args: string[]) => ExecResult)>,
): {
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-appconfig-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── classifyDomain ────────────────────────────────────────────────────────────

describe("classifyDomain", () => {
  it("tracks com.apple.dock", () => {
    expect(classifyDomain("com.apple.dock")).toBe("track");
  });

  it("tracks com.apple.Finder", () => {
    expect(classifyDomain("com.apple.Finder")).toBe("track");
  });

  it("tracks com.googlecode.iterm2", () => {
    expect(classifyDomain("com.googlecode.iterm2")).toBe("track");
  });

  it("skips com.apple.loginwindow", () => {
    expect(classifyDomain("com.apple.loginwindow")).toBe("skip");
  });

  it("skips MobileMeAccounts", () => {
    expect(classifyDomain("MobileMeAccounts")).toBe("skip");
  });

  it("skips knownnetworks", () => {
    expect(classifyDomain("com.apple.knownnetworks")).toBe("skip");
  });

  it("skips com.apple.security.something", () => {
    expect(classifyDomain("com.apple.security.something")).toBe("skip");
  });

  it("skips pasteboard domain", () => {
    expect(classifyDomain("com.apple.pasteboard")).toBe("skip");
  });

  it("skips universalaccessAuthWarning", () => {
    expect(classifyDomain("com.apple.universalaccessAuthWarning")).toBe("skip");
  });

  it("skips domain containing 'account' (lowercase)", () => {
    expect(classifyDomain("com.foo.account.manager")).toBe("skip");
  });

  it("skips domain containing 'Account' (uppercase)", () => {
    expect(classifyDomain("com.bar.AccountSync")).toBe("skip");
  });

  it("tracks a generic third-party domain", () => {
    expect(classifyDomain("com.microsoft.VSCode")).toBe("track");
  });
});

// ── discover ──────────────────────────────────────────────────────────────────

describe("appconfigModule.discover", () => {
  it("parses defaults domains output and emits tracked candidates", async () => {
    const domainsOutput =
      "com.apple.dock, com.apple.Finder, com.apple.loginwindow, com.googlecode.iterm2";
    const { exec } = makeFakeExec([
      { code: 0, stdout: domainsOutput, stderr: "" },
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const candidates = await appconfigModule.discover(ctx);

    // loginwindow must be filtered
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain("domain:com.apple.dock");
    expect(ids).toContain("domain:com.apple.Finder");
    expect(ids).toContain("domain:com.googlecode.iterm2");
    expect(ids).not.toContain("domain:com.apple.loginwindow");
  });

  it("sets category to 'appconfig' on all candidates", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "com.apple.dock, com.apple.Finder", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const candidates = await appconfigModule.discover(ctx);
    for (const c of candidates) {
      expect(c.category).toBe("appconfig");
      expect(c.recommendation).toBe("track");
    }
  });

  it("caps output at 80 candidates", async () => {
    // Generate 100 trackable domains
    const domains = Array.from({ length: 100 }, (_, i) => `com.test.app${i}`).join(", ");
    const { exec } = makeFakeExec([{ code: 0, stdout: domains, stderr: "" }]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const candidates = await appconfigModule.discover(ctx);
    expect(candidates.length).toBeLessThanOrEqual(80);
  });

  it("path is roost/appconfig/<domain>.plist", async () => {
    const { exec } = makeFakeExec([
      { code: 0, stdout: "com.apple.dock", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const candidates = await appconfigModule.discover(ctx);
    expect(candidates[0]?.path).toBe("roost/appconfig/com.apple.dock.plist");
  });
});

// ── capture ───────────────────────────────────────────────────────────────────

describe("appconfigModule.capture", () => {
  it("exports domain XML and writes to correct repo path", async () => {
    const domain = "com.apple.dock";
    const xml = "<?xml version=\"1.0\"?><plist><dict></dict></plist>";
    const { exec, calls } = makeFakeExec([
      { code: 0, stdout: xml, stderr: "" },
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };

    const result = await appconfigModule.capture(ctx, sel);

    // defaults export was called
    const exportCall = calls.find(
      (c) => c.cmd === "defaults" && c.args.includes("export") && c.args.includes(domain),
    );
    expect(exportCall).toBeDefined();

    // file written to right place
    const expectedPath = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.readFileSync(expectedPath, "utf8")).toBe(xml);

    // result shape
    expect(result.module).toBe("appconfig");
    expect(result.written).toContain(expectedPath);
    expect(result.encrypted).toHaveLength(0);
  });

  it("throws when defaults export exits non-zero", async () => {
    const { exec } = makeFakeExec([{ code: 1, stdout: "", stderr: "error" }]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { appconfig: ["domain:com.apple.dock"] } };
    await expect(appconfigModule.capture(ctx, sel)).rejects.toThrow();
  });

  it("handles empty selection gracefully", async () => {
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: {} };
    const result = await appconfigModule.capture(ctx, sel);
    expect(result.written).toHaveLength(0);
    expect(result.encrypted).toHaveLength(0);
  });

  it("blocks a domain whose plist contains an AWS key (AKIA…) and logs a warning", async () => {
    const domain = "com.example.awsapp";
    const dangerousPlist =
      '<?xml version="1.0"?><plist><string>AKIAIOSFODNN7EXAMPLE</string></plist>';
    const { exec } = makeFakeExec([{ code: 0, stdout: dangerousPlist, stderr: "" }]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      repoDir: tmpDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };

    const result = await appconfigModule.capture(ctx, sel);

    // File must NOT be written
    const dest = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    expect(fs.existsSync(dest)).toBe(false);
    expect(result.written).toHaveLength(0);

    // Warning must have been logged (with domain, without the raw secret value)
    expect(warnSpy).toHaveBeenCalled();
    const warningArg: string = warnSpy.mock.calls[0]?.[0] ?? "";
    expect(warningArg).toContain(domain);
    expect(warningArg).not.toContain("AKIAIOSFODNN7EXAMPLE");

    // blocked list must record the domain
    expect((result as { blocked?: string[] }).blocked).toContain(domain);
  });

  it("blocks a domain containing a GitHub token (ghp_…) and logs a warning", async () => {
    const domain = "com.example.githubapp";
    const dangerousPlist =
      '<?xml version="1.0"?><plist><string>ghp_1234567890abcdefghij</string></plist>';
    const { exec } = makeFakeExec([{ code: 0, stdout: dangerousPlist, stderr: "" }]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      repoDir: tmpDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };

    const result = await appconfigModule.capture(ctx, sel);

    const dest = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    expect(fs.existsSync(dest)).toBe(false);
    expect(result.written).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    expect((result as { blocked?: string[] }).blocked).toContain(domain);
  });

  it("blocks a domain containing an OpenAI key (sk-…) and logs a warning", async () => {
    const domain = "com.example.openaiapp";
    const dangerousPlist =
      '<?xml version="1.0"?><plist><string>sk-abcdefghijklmnopqrstuvwxyz123456</string></plist>';
    const { exec } = makeFakeExec([{ code: 0, stdout: dangerousPlist, stderr: "" }]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      repoDir: tmpDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };

    const result = await appconfigModule.capture(ctx, sel);

    const dest = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    expect(fs.existsSync(dest)).toBe(false);
    expect(result.written).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    expect((result as { blocked?: string[] }).blocked).toContain(domain);
  });

  it("writes a clean plist that has no secrets", async () => {
    const domain = "com.apple.dock";
    const cleanPlist =
      '<?xml version="1.0"?><plist><dict><key>tilesize</key><integer>48</integer></dict></plist>';
    const { exec } = makeFakeExec([{ code: 0, stdout: cleanPlist, stderr: "" }]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };

    const result = await appconfigModule.capture(ctx, sel);

    const dest = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    expect(fs.existsSync(dest)).toBe(true);
    expect(result.written).toContain(dest);
    expect((result as { blocked?: string[] }).blocked ?? []).toHaveLength(0);
  });

  it("writes clean domain and blocks secret domain in the same capture call", async () => {
    const cleanDomain = "com.apple.dock";
    const secretDomain = "com.example.awsapp";
    const cleanPlist = '<?xml version="1.0"?><plist><dict></dict></plist>';
    const secretPlist = '<?xml version="1.0"?><plist><string>AKIAIOSFODNN7EXAMPLE</string></plist>';

    const { exec } = makeFakeExec([
      { code: 0, stdout: cleanPlist, stderr: "" },
      { code: 0, stdout: secretPlist, stderr: "" },
    ]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      repoDir: tmpDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = {
      modules: { appconfig: [`domain:${cleanDomain}`, `domain:${secretDomain}`] },
    };

    const result = await appconfigModule.capture(ctx, sel);

    const cleanDest = path.join(tmpDir, "roost/appconfig", `${cleanDomain}.plist`);
    const secretDest = path.join(tmpDir, "roost/appconfig", `${secretDomain}.plist`);
    expect(fs.existsSync(cleanDest)).toBe(true);
    expect(fs.existsSync(secretDest)).toBe(false);
    expect(result.written).toContain(cleanDest);
    expect(result.written).not.toContain(secretDest);
    expect((result as { blocked?: string[] }).blocked).toContain(secretDomain);
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});

// ── SENSITIVE_DOMAIN_HINTS ────────────────────────────────────────────────────

describe("SENSITIVE_DOMAIN_HINTS", () => {
  it("is exported and is an array of RegExp", () => {
    expect(Array.isArray(SENSITIVE_DOMAIN_HINTS)).toBe(true);
    expect(SENSITIVE_DOMAIN_HINTS.length).toBeGreaterThan(0);
    for (const r of SENSITIVE_DOMAIN_HINTS) {
      expect(r).toBeInstanceOf(RegExp);
    }
  });

  it("matches obvious credential-holding domain names", () => {
    const sensitiveNames = [
      "com.openai.chatgpt",
      "com.anthropic.claude",
      "com.github.desktop",
      "com.gitlab.runner",
      "com.slack.Slack",
      "com.amazon.aws.cli",
      "com.google.gcloud",
      "com.example.authservice",
      "com.example.tokenmanager",
      "com.1password.extension",
      "com.bitwarden.vault",
      "com.example.credential-store",
    ];
    for (const name of sensitiveNames) {
      const matched = SENSITIVE_DOMAIN_HINTS.some((r) => r.test(name));
      expect(matched, `Expected ${name} to be matched by SENSITIVE_DOMAIN_HINTS`).toBe(true);
    }
  });

  it("does not match benign domains", () => {
    const benignNames = [
      "com.apple.dock",
      "com.apple.Finder",
      "com.googlecode.iterm2",
      "com.microsoft.VSCode",
    ];
    for (const name of benignNames) {
      const matched = SENSITIVE_DOMAIN_HINTS.some((r) => r.test(name));
      expect(matched, `Expected ${name} NOT to be matched by SENSITIVE_DOMAIN_HINTS`).toBe(false);
    }
  });
});

// ── apply ─────────────────────────────────────────────────────────────────────

describe("appconfigModule.apply", () => {
  it("quits the app via osascript BEFORE defaults import at runtime", async () => {
    const domain = "com.apple.dock";
    const plistFile = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(plistFile), { recursive: true });
    fs.writeFileSync(plistFile, "<plist></plist>");

    // Two responses: osascript (quit) then defaults import
    const { exec, calls } = makeFakeExec([
      { code: 0, stdout: "", stderr: "" }, // osascript quit (may fail — tolerated)
      { code: 0, stdout: "", stderr: "" }, // defaults import
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir, dryRun: false });
    const plan: ApplyPlan = {
      module: "appconfig",
      actions: [{ id: `domain:${domain}`, kind: "update", target: plistFile }],
    };

    await appconfigModule.apply(ctx, plan);

    // osascript must appear before defaults import in call order
    const osascriptIdx = calls.findIndex((c) => c.cmd === "osascript");
    const importIdx = calls.findIndex(
      (c) => c.cmd === "defaults" && c.args.includes("import"),
    );
    expect(osascriptIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeGreaterThan(osascriptIdx);

    // osascript must carry a quit command for the domain
    const quitCall = calls[osascriptIdx]!;
    expect(quitCall.args).toContain("-e");
    const scriptArg = quitCall.args[quitCall.args.indexOf("-e") + 1] ?? "";
    expect(scriptArg).toContain("quit");
    expect(scriptArg).toContain(domain);
  });

  it("tolerates osascript quit failure and still imports", async () => {
    const domain = "com.apple.dock";
    const plistFile = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(plistFile), { recursive: true });
    fs.writeFileSync(plistFile, "<plist></plist>");

    // osascript fails (app not running), defaults import succeeds
    const { exec, calls } = makeFakeExec([
      { code: 1, stdout: "", stderr: "Application isn't running" }, // osascript fails
      { code: 0, stdout: "", stderr: "" }, // defaults import still runs
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir, dryRun: false });
    const plan: ApplyPlan = {
      module: "appconfig",
      actions: [{ id: `domain:${domain}`, kind: "update", target: plistFile }],
    };

    const result = await appconfigModule.apply(ctx, plan);

    expect(result.applied).toContain(`domain:${domain}`);
    const importCall = calls.find(
      (c) => c.cmd === "defaults" && c.args.includes("import"),
    );
    expect(importCall).toBeDefined();
  });

  it("calls defaults import with domain and file path in real mode", async () => {
    const domain = "com.apple.dock";
    const plistFile = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(plistFile), { recursive: true });
    fs.writeFileSync(plistFile, "<plist></plist>");

    // Two responses: osascript (quit) then defaults import
    const { exec, calls } = makeFakeExec([
      { code: 0, stdout: "", stderr: "" }, // osascript quit
      { code: 0, stdout: "", stderr: "" }, // defaults import
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir, dryRun: false });
    const plan: ApplyPlan = {
      module: "appconfig",
      actions: [{ id: `domain:${domain}`, kind: "update", target: plistFile }],
    };

    const result = await appconfigModule.apply(ctx, plan);

    const importCall = calls.find(
      (c) =>
        c.cmd === "defaults" &&
        c.args.includes("import") &&
        c.args.includes(domain),
    );
    expect(importCall).toBeDefined();
    expect(importCall!.args).toContain(plistFile);

    expect(result.module).toBe("appconfig");
    expect(result.applied).toContain(`domain:${domain}`);
    expect(result.skipped).toHaveLength(0);
  });

  it("skips defaults import in dryRun mode (no osascript either)", async () => {
    const domain = "com.apple.dock";
    const { exec, calls } = makeFakeExec([]);
    const ctx = makeCtx({ exec, repoDir: tmpDir, dryRun: true });
    const plan: ApplyPlan = {
      module: "appconfig",
      actions: [{ id: `domain:${domain}`, kind: "update", target: "some/file" }],
    };

    const result = await appconfigModule.apply(ctx, plan);

    const importCall = calls.find(
      (c) => c.cmd === "defaults" && c.args.includes("import"),
    );
    expect(importCall).toBeUndefined();
    const osascriptCall = calls.find((c) => c.cmd === "osascript");
    expect(osascriptCall).toBeUndefined();

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toContain(`domain:${domain}`);
  });

  it("throws when defaults import exits non-zero", async () => {
    const domain = "com.apple.dock";
    const plistFile = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(plistFile), { recursive: true });
    fs.writeFileSync(plistFile, "<plist></plist>");

    // osascript ok, defaults import fails
    const { exec } = makeFakeExec([
      { code: 0, stdout: "", stderr: "" }, // osascript
      { code: 1, stdout: "", stderr: "error" }, // defaults import
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir, dryRun: false });
    const plan: ApplyPlan = {
      module: "appconfig",
      actions: [{ id: `domain:${domain}`, kind: "update", target: plistFile }],
    };

    await expect(appconfigModule.apply(ctx, plan)).rejects.toThrow();
  });
});

// ── status ────────────────────────────────────────────────────────────────────

describe("appconfigModule.status", () => {
  it("returns synced when stored plist matches current export", async () => {
    const domain = "com.apple.dock";
    const xml = "<?xml version=\"1.0\"?><plist><dict></dict></plist>";

    // Write matching stored plist
    const plistFile = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(plistFile), { recursive: true });
    fs.writeFileSync(plistFile, xml);

    const { exec } = makeFakeExec([
      { code: 0, stdout: xml, stderr: "" }, // defaults export
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };

    const report = await appconfigModule.status(ctx, sel);

    expect(report.module).toBe("appconfig");
    expect(report.items[0]?.id).toBe(`domain:${domain}`);
    expect(report.items[0]?.state).toBe("synced");
  });

  it("returns drift when stored plist differs from current export", async () => {
    const domain = "com.apple.dock";
    const storedXml = "<?xml version=\"1.0\"?><plist><dict><key>old</key></dict></plist>";
    const currentXml = "<?xml version=\"1.0\"?><plist><dict><key>new</key></dict></plist>";

    const plistFile = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(plistFile), { recursive: true });
    fs.writeFileSync(plistFile, storedXml);

    const { exec } = makeFakeExec([
      { code: 0, stdout: currentXml, stderr: "" }, // defaults export returns different content
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };

    const report = await appconfigModule.status(ctx, sel);

    expect(report.items[0]?.state).toBe("drift");
  });

  it("returns drift when stored plist is missing", async () => {
    const domain = "com.apple.dock";
    const { exec } = makeFakeExec([
      { code: 0, stdout: "<plist></plist>", stderr: "" },
    ]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };

    const report = await appconfigModule.status(ctx, sel);

    expect(report.items[0]?.state).toBe("drift");
  });
});

// ── unmanage ──────────────────────────────────────────────────────────────────

describe("appconfigModule.unmanage", () => {
  it("removes stored plist from repo and returns applied", async () => {
    const domain = "com.apple.dock";
    const plistFile = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(plistFile), { recursive: true });
    fs.writeFileSync(plistFile, "<plist></plist>");

    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };
    const result = await appconfigModule.unmanage(ctx, sel);

    expect(result.module).toBe("appconfig");
    expect(result.applied).toContain(`domain:${domain}`);
    expect(result.skipped).toHaveLength(0);
    expect(fs.existsSync(plistFile)).toBe(false);
  });

  it("skips when plist is already absent", async () => {
    const domain = "com.apple.dock";
    const { exec } = makeFakeExec([]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };
    const result = await appconfigModule.unmanage(ctx, sel);

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toContain(`domain:${domain}`);
  });

  it("logs a git history warning when domains are removed", async () => {
    const domain = "com.apple.dock";
    const plistFile = path.join(tmpDir, "roost/appconfig", `${domain}.plist`);
    fs.mkdirSync(path.dirname(plistFile), { recursive: true });
    fs.writeFileSync(plistFile, "<plist></plist>");

    const { exec } = makeFakeExec([]);
    const warnSpy = vi.fn();
    const ctx = makeCtx({
      exec,
      repoDir: tmpDir,
      log: { info: () => {}, warn: warnSpy, error: () => {} },
    });
    const sel: Selection = { modules: { appconfig: [`domain:${domain}`] } };
    await appconfigModule.unmanage(ctx, sel);

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
    const sel: Selection = { modules: { appconfig: [] } };
    await appconfigModule.unmanage(ctx, sel);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── doctor ────────────────────────────────────────────────────────────────────

describe("appconfigModule.doctor", () => {
  it("returns ok:true when defaults exits 0", async () => {
    const { exec } = makeFakeExec([{ code: 0, stdout: "", stderr: "" }]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const health = await appconfigModule.doctor(ctx);
    expect(health).toHaveLength(1);
    expect(health[0]?.name).toBe("defaults");
    expect(health[0]?.ok).toBe(true);
  });

  it("returns ok:false when defaults exits non-zero", async () => {
    const { exec } = makeFakeExec([{ code: 127, stdout: "", stderr: "not found" }]);
    const ctx = makeCtx({ exec, repoDir: tmpDir });
    const health = await appconfigModule.doctor(ctx);
    expect(health[0]?.ok).toBe(false);
    expect(health[0]?.detail).toBeTruthy();
  });
});

// ── index ─────────────────────────────────────────────────────────────────────

describe("appconfigModule.index", () => {
  // defaults is a macOS system tool → always available; index must not shell out
  // (no `defaults domains`, no `osascript`, no per-domain export).
  const throwingExec: Exec = {
    async run(): Promise<ExecResult> {
      throw new Error("index must not run any external command");
    },
  };

  it("is cheap: available=true, counts captured plist files, runs no commands", async () => {
    const dir = path.join(tmpDir, "roost", "appconfig");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "com.apple.dock.plist"), "<plist/>");
    fs.writeFileSync(path.join(dir, "com.apple.finder.plist"), "<plist/>");
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
    const ctx = makeCtx({ exec: throwingExec, repoDir: tmpDir });
    const idx = await appconfigModule.index!(ctx);
    expect(idx.available).toBe(true);
    expect(idx.reason).toBeUndefined();
    expect(idx.managed).toBe(2);
  });

  it("managed is 0 when no appconfig data dir exists", async () => {
    const ctx = makeCtx({ exec: throwingExec, repoDir: tmpDir });
    const idx = await appconfigModule.index!(ctx);
    expect(idx.available).toBe(true);
    expect(idx.managed).toBe(0);
  });
});
