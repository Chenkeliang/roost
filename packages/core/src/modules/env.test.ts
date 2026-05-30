import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult, ModuleContext, Selection, EnvData } from "@roost/shared";
import {
  envModule,
  generateEnvSh,
  renderRcSourceLine,
  ensureRcSourced,
  removeRcMarker,
  rcHasMarker,
  extractImportCandidates,
  envShPath,
} from "./env.js";
import { dotfilesModule } from "./dotfiles.js";
import { loadEnvData, saveEnvData } from "../env-data.js";
import { envSecretPath } from "../env-crypto.js";

// ── helpers ───────────────────────────────────────────────────────────────────

type Call = { cmd: string; args: string[] };

/**
 * Fake Exec that simulates the age toolchain:
 *  - `age-keygen -y <key>` → prints a fake recipient
 *  - `age -r <rec> -o <dest> <src>` → writes ciphertext (records plaintext for round-trip)
 *  - `age -d -i <key> <src>` → prints back the recorded plaintext for that file
 */
function makeAgeExec(opts?: { hasKey?: boolean }): { exec: Exec; calls: Call[]; store: Map<string, string> } {
  const hasKey = opts?.hasKey ?? true;
  const calls: Call[] = [];
  const store = new Map<string, string>(); // ciphertext path → plaintext

  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      if (cmd === "age-keygen" && args[0] === "-y") {
        if (!hasKey) return { code: 1, stdout: "", stderr: "no key" };
        return { code: 0, stdout: "age1faketestrecipient\n", stderr: "" };
      }
      if (cmd === "age" && args.includes("-r")) {
        const oIdx = args.indexOf("-o");
        const dest = args[oIdx + 1]!;
        const src = args[args.length - 1]!;
        const plaintext = fs.readFileSync(src, "utf8");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, `AGE-CIPHERTEXT:${plaintext}`, "utf8");
        store.set(dest, plaintext);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (cmd === "age" && args.includes("-d")) {
        const src = args[args.length - 1]!;
        const plain = store.get(src);
        if (plain === undefined) return { code: 1, stdout: "", stderr: "decrypt failed" };
        return { code: 0, stdout: plain, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { exec, calls, store };
}

interface LogCapture {
  log: ModuleContext["log"];
  warns: string[];
  infos: string[];
}
function makeLog(): LogCapture {
  const warns: string[] = [];
  const infos: string[] = [];
  return {
    warns,
    infos,
    log: {
      info: (m) => infos.push(m),
      warn: (m) => warns.push(m),
      error: () => {},
    },
  };
}

/** Create a fake age identity at the default key path so recipientFromKey/decrypt run. */
function writeFakeKey(home: string): void {
  const keyPath = path.join(home, ".config", "sops", "age", "keys.txt");
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, "AGE-SECRET-KEY-FAKE", { mode: 0o600 });
}

function makeCtx(opts: { repoDir: string; home: string; exec: Exec; dryRun?: boolean; log?: ModuleContext["log"] }): ModuleContext {
  return {
    repoDir: opts.repoDir,
    home: opts.home,
    profile: "base",
    dryRun: opts.dryRun ?? false,
    exec: opts.exec,
    log: opts.log ?? { info: () => {}, warn: () => {}, error: () => {} },
    t: (k) => k,
  };
}

function sampleData(overrides?: Partial<EnvData>): EnvData {
  return {
    schemaVersion: 1,
    aliases: [{ kind: "alias", name: "ll", value: "ls -la", enabled: true }],
    env: [{ kind: "env", name: "EDITOR", value: "nvim", secret: false, enabled: true }],
    path: [{ kind: "path", value: "$HOME/bin", position: "prepend", enabled: true }],
    functions: [{ kind: "function", name: "mkcd", body: "mkcd() { mkdir -p \"$1\" && cd \"$1\"; }", enabled: true }],
    ...overrides,
  };
}

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-env-repo-"));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "roost-env-home-"));
});

afterEach(() => {
  fs.rmSync(tmpRepo, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// ── generateEnvSh ─────────────────────────────────────────────────────────────

describe("generateEnvSh", () => {
  it("is deterministic / byte-identical across calls", () => {
    const data = sampleData();
    expect(generateEnvSh(data)).toBe(generateEnvSh(data));
  });

  it("contains a static header with no timestamp", () => {
    const out = generateEnvSh(sampleData());
    expect(out).toContain("# Managed by Roost");
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no ISO date
    expect(out).not.toMatch(/\d{2}:\d{2}:\d{2}/); // no time
  });

  it("emits PATH prepend/append correctly", () => {
    const data = sampleData({
      path: [
        { kind: "path", value: "/a/bin", position: "prepend", enabled: true },
        { kind: "path", value: "/z/bin", position: "append", enabled: true },
      ],
    });
    const out = generateEnvSh(data);
    expect(out).toContain('export PATH="/a/bin:$PATH"');
    expect(out).toContain('export PATH="$PATH:/z/bin"');
  });

  it("escapes single quotes in alias values", () => {
    const data = sampleData({
      aliases: [{ kind: "alias", name: "say", value: "echo 'hi'", enabled: true }],
    });
    const out = generateEnvSh(data);
    expect(out).toContain("alias say='echo '\\''hi'\\'''");
  });

  it("emits secret placeholder when no value provided, inlines when provided", () => {
    const data = sampleData({
      env: [{ kind: "env", name: "API_KEY", value: "", secret: true, enabled: true }],
    });
    const preview = generateEnvSh(data);
    expect(preview).toContain("export API_KEY='<roost-secret:unset>'");

    const withSecret = generateEnvSh(data, new Map([["API_KEY", "s3cr3t"]]));
    expect(withSecret).toContain("export API_KEY='s3cr3t'");
    expect(withSecret).not.toContain("<roost-secret:unset>");
  });

  it("emits function bodies verbatim", () => {
    const body = "greet() {\n  echo \"hello $1\"\n}";
    const data = sampleData({ functions: [{ kind: "function", name: "greet", body, enabled: true }] });
    expect(generateEnvSh(data)).toContain(body);
  });

  it("skips disabled items", () => {
    const data = sampleData({
      aliases: [{ kind: "alias", name: "off", value: "nope", enabled: false }],
    });
    expect(generateEnvSh(data)).not.toContain("alias off=");
  });

  // ── hostile input: belt-and-suspenders even if validation is bypassed ────────

  it("C1: defensively skips items whose name is not a POSIX identifier", () => {
    // Construct EnvData directly (bypassing validateEnvData) to prove the
    // generator is itself a chokepoint and never emits an injectable name.
    const data = sampleData({
      aliases: [{ kind: "alias", name: "ll=1 && curl x|sh #", value: "ls", enabled: true }],
      env: [{ kind: "env", name: 'X=1; rm -rf "$HOME"; Y', value: "v", secret: false, enabled: true }],
      functions: [{ kind: "function", name: "g; rm -rf ~", body: "echo hi", enabled: true }],
      path: [],
    });
    const out = generateEnvSh(data);
    expect(out).not.toContain("curl x|sh");
    expect(out).not.toContain("rm -rf");
    expect(out).not.toContain("X=1;");
  });

  it("C2: collapses newlines in comments so they cannot start a new line", () => {
    const data = sampleData({
      aliases: [{ kind: "alias", name: "ll", value: "ls", enabled: true, comment: "x\nrm -rf ~ #" }],
      env: [],
      path: [],
      functions: [],
    });
    const out = generateEnvSh(data);
    // The comment text survives (collapsed onto one line) but never produces a
    // bare second line `rm -rf ~ #` that the shell would execute.
    expect(out).not.toMatch(/^rm -rf ~ #/m);
    expect(out).toContain("# x rm -rf ~ #");
  });

  it("C3: still emits a valid PATH value double-quoted so $HOME expands", () => {
    const data = sampleData({
      path: [{ kind: "path", value: "$HOME/.local/bin", position: "prepend", enabled: true }],
      aliases: [],
      env: [],
      functions: [],
    });
    expect(generateEnvSh(data)).toContain('export PATH="$HOME/.local/bin:$PATH"');
  });
});

// ── rc source line helpers ────────────────────────────────────────────────────

describe("renderRcSourceLine / ensureRcSourced", () => {
  it("renders the exact marker block", () => {
    expect(renderRcSourceLine()).toBe(
      `# >>> roost env >>>\n[ -f "$HOME/.config/roost/env.sh" ] && . "$HOME/.config/roost/env.sh"\n# <<< roost env <<<`,
    );
  });

  it("appends the block to an rc that lacks it", () => {
    const { content, changed } = ensureRcSourced("# my zshrc\nexport FOO=bar\n");
    expect(changed).toBe(true);
    expect(rcHasMarker(content)).toBe(true);
  });

  it("is idempotent — second call makes no change", () => {
    const first = ensureRcSourced("export FOO=bar\n");
    expect(first.changed).toBe(true);
    const second = ensureRcSourced(first.content);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it("removeRcMarker strips the block", () => {
    const withMarker = ensureRcSourced("export FOO=bar\n").content;
    const { content, changed } = removeRcMarker(withMarker);
    expect(changed).toBe(true);
    expect(rcHasMarker(content)).toBe(false);
    expect(content).toContain("export FOO=bar");
  });

  // M3: a substring `includes` check on the markers gives a false positive when
  // an rc merely *mentions* the marker text in a comment, so the real source
  // block is never appended and env.sh silently never loads.
  it("M3: still appends the real block when the marker text only appears in prose", () => {
    const rc = [
      "# I once read about '# >>> roost env >>>' in the roost docs.",
      "# The end marker is '# <<< roost env <<<' apparently.",
      "export FOO=bar",
    ].join("\n");
    expect(rcHasMarker(rc)).toBe(false); // prose mention is NOT a real block
    const { content, changed } = ensureRcSourced(rc);
    expect(changed).toBe(true);
    // The actual two-line block (with the source line between markers) is added.
    expect(content).toMatch(
      /^# >>> roost env >>>$[\s\S]*?\.config\/roost\/env\.sh[\s\S]*?^# <<< roost env <<<$/m,
    );
    expect(rcHasMarker(content)).toBe(true); // now it really is wired
  });
});

// ── extractImportCandidates ────────────────────────────────────────────────────

describe("extractImportCandidates", () => {
  it("captures top-level simple alias and export", () => {
    const rc = [
      "alias ll='ls -la'",
      'export EDITOR="nvim"',
      "export PATH=\"$HOME/bin:$PATH\"",
    ].join("\n");
    const out = extractImportCandidates(rc);
    expect(out.aliases.map((a) => a.name)).toContain("ll");
    expect(out.aliases.find((a) => a.name === "ll")?.value).toBe("ls -la");
    expect(out.env.map((e) => e.name)).toContain("EDITOR");
    expect(out.path).toHaveLength(1);
    expect(out.path[0]).toMatchObject({ value: "$HOME/bin", position: "prepend" });
  });

  it("captures PATH append form", () => {
    const out = extractImportCandidates('export PATH="$PATH:/opt/bin"');
    expect(out.path[0]).toMatchObject({ value: "/opt/bin", position: "append" });
  });

  it("skips indented statements", () => {
    const rc = "  alias indented='should skip'\n\talias tabbed='skip'";
    const out = extractImportCandidates(rc);
    expect(out.aliases).toHaveLength(0);
  });

  it("skips statements inside an if block", () => {
    const rc = [
      'if [ -n "$ZSH" ]; then',
      "alias inside='nope'",
      "export INSIDE=nope",
      "fi",
      "alias outside='yep'",
    ].join("\n");
    const out = extractImportCandidates(rc);
    expect(out.aliases.map((a) => a.name)).toEqual(["outside"]);
    expect(out.env.map((e) => e.name)).not.toContain("INSIDE");
  });

  it("skips statements inside a case block", () => {
    const rc = [
      "case $- in",
      "  *i*) alias casey='nope' ;;",
      "esac",
      "alias top='ok'",
    ].join("\n");
    const out = extractImportCandidates(rc);
    expect(out.aliases.map((a) => a.name)).toEqual(["top"]);
  });

  it("skips values with command substitution", () => {
    const rc = [
      "export GPG_TTY=$(tty)",
      "alias now=`date`",
      "export PATH=\"$(brew --prefix)/bin:$PATH\"",
    ].join("\n");
    const out = extractImportCandidates(rc);
    expect(out.env).toHaveLength(0);
    expect(out.aliases).toHaveLength(0);
    expect(out.path).toHaveLength(0);
  });
});

// ── discover ──────────────────────────────────────────────────────────────────

describe("envModule.discover", () => {
  it("surfaces both managed items and import candidates", async () => {
    saveEnvData(tmpRepo, sampleData());
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "alias gs='git status'\n");
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });
    const candidates = await envModule.discover(ctx);

    const ids = candidates.map((c) => c.id);
    expect(ids).toContain("alias:ll"); // managed
    expect(ids).toContain("import:alias:gs"); // imported from rc
  });

  it("does not write anything during discover", async () => {
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "alias gs='git status'\n");
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });
    await envModule.discover(ctx);
    expect(fs.existsSync(path.join(tmpRepo, "roost", "env.yaml"))).toBe(false);
    expect(fs.existsSync(envShPath(tmpHome))).toBe(false);
  });
});

// ── capture ───────────────────────────────────────────────────────────────────

describe("envModule.capture", () => {
  it("blocks a plaintext secret in a non-secret field (warn, no plaintext in repo)", async () => {
    const leaked = "AKIAIOSFODNN7EXAMPLE";
    saveEnvData(tmpRepo, sampleData({
      env: [{ kind: "env", name: "AWS_ACCESS_KEY_ID", value: leaked, secret: false, enabled: true }],
    }));
    const { exec } = makeAgeExec();
    const { log, warns } = makeLog();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, log });

    const cs = await envModule.capture(ctx, { modules: {} });
    expect(cs.blocked).toContain("secret-in-plaintext");
    expect(warns.length).toBeGreaterThan(0);
    // the plaintext value must never appear in a warning
    expect(warns.join("\n")).not.toContain(leaked);
    // yaml on disk still holds the user-supplied value (capture did not overwrite),
    // but no ciphertext was produced
    expect(fs.existsSync(path.join(tmpRepo, "roost", "env-secrets"))).toBe(false);
  });

  it("encrypts a secret env value: ciphertext written, yaml value blanked", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{ kind: "env", name: "TOKEN", value: "supersecretvalue", secret: true, enabled: true }],
    }));
    writeFakeKey(tmpHome);
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });

    const cs = await envModule.capture(ctx, { modules: {} });
    const cipher = envSecretPath(tmpRepo, "TOKEN");
    expect(cs.encrypted).toContain(cipher);
    expect(fs.existsSync(cipher)).toBe(true);
    // plaintext must NOT be in the committed yaml
    const onDisk = loadEnvData(tmpRepo);
    const tokenEntry = onDisk.env.find((e) => e.name === "TOKEN")!;
    expect(tokenEntry.value).toBe("");
    expect(tokenEntry.secret).toBe(true);
    const yamlRaw = fs.readFileSync(path.join(tmpRepo, "roost", "env.yaml"), "utf8");
    expect(yamlRaw).not.toContain("supersecretvalue");
  });

  it("dry-run writes nothing", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{ kind: "env", name: "TOKEN", value: "v", secret: true, enabled: true }],
    }));
    // overwrite the file then snapshot it to detect any mutation
    const before = fs.readFileSync(path.join(tmpRepo, "roost", "env.yaml"), "utf8");
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, dryRun: true });

    await envModule.capture(ctx, { modules: {} });
    expect(fs.existsSync(envSecretPath(tmpRepo, "TOKEN"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpRepo, "roost", "env.yaml"), "utf8")).toBe(before);
  });

  it("fails a secret item gracefully when no age key is available", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{ kind: "env", name: "TOKEN", value: "v", secret: true, enabled: true }],
    }));
    const { exec } = makeAgeExec({ hasKey: false });
    const { log, warns } = makeLog();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, log });

    const cs = await envModule.capture(ctx, { modules: {} });
    expect(cs.blocked).toContain("TOKEN");
    expect(warns.join("\n")).toMatch(/age key/i);
    // value still blanked in yaml
    expect(loadEnvData(tmpRepo).env.find((e) => e.name === "TOKEN")?.value).toBe("");
  });
});

// ── ADR-0004: ref-source secret env (op / rbw) ─────────────────────────────────

/**
 * Fake Exec for a secret backend: `op read <ref>` / `rbw get <ref>` resolve to a
 * fixed value; backend availability is toggled. Records calls so tests can assert
 * the value never appears anywhere it shouldn't.
 */
function makeRefExec(opts: {
  op?: Map<string, string>;
  rbw?: Map<string, string>;
  opAvailable?: boolean;
  rbwAvailable?: boolean;
}): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const opAvailable = opts.opAvailable ?? true;
  const rbwAvailable = opts.rbwAvailable ?? true;
  const exec: Exec = {
    async run(cmd: string, args: string[]): Promise<ExecResult> {
      calls.push({ cmd, args });
      // age-keygen path used by recipientFromKey in doctor / unrelated flows
      if (cmd === "age-keygen") return { code: 0, stdout: "age1faketestrecipient\n", stderr: "" };
      if (cmd === "op") {
        if (!opAvailable) return { code: 127, stdout: "", stderr: "op: command not found" };
        if (args[0] === "read") {
          const v = opts.op?.get(args[1]!);
          if (v === undefined) return { code: 1, stdout: "", stderr: "item not found" };
          return { code: 0, stdout: v + "\n", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }
      if (cmd === "rbw") {
        if (!rbwAvailable) return { code: 127, stdout: "", stderr: "rbw: command not found" };
        if (args[0] === "get") {
          const v = opts.rbw?.get(args[1]!);
          if (v === undefined) return { code: 1, stdout: "", stderr: "no entry" };
          return { code: 0, stdout: v + "\n", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { exec, calls };
}

describe("envModule capture — ref source (ADR-0004)", () => {
  it("does not encrypt and writes no ciphertext, but persists the ref and blanks the value", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{
        kind: "env",
        name: "TOKEN",
        value: "should-be-ignored",
        secret: true,
        source: { kind: "ref", backend: "op", ref: "op://Vault/Item/field" },
        enabled: true,
      }],
    }));
    const { exec, calls } = makeRefExec({ op: new Map([["op://Vault/Item/field", "resolved"]]) });
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });

    const cs = await envModule.capture(ctx, { modules: {} });

    // No ciphertext written for the ref item.
    expect(cs.encrypted).not.toContain(envSecretPath(tmpRepo, "TOKEN"));
    expect(fs.existsSync(envSecretPath(tmpRepo, "TOKEN"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRepo, "roost", "env-secrets"))).toBe(false);
    // No backend resolution happens at capture time.
    expect(calls.some((c) => c.cmd === "op")).toBe(false);
    // Ref persisted, value blanked.
    const onDisk = loadEnvData(tmpRepo).env.find((e) => e.name === "TOKEN")!;
    expect(onDisk.value).toBe("");
    expect(onDisk.source).toEqual({ kind: "ref", backend: "op", ref: "op://Vault/Item/field" });
    const yamlRaw = fs.readFileSync(path.join(tmpRepo, "roost", "env.yaml"), "utf8");
    expect(yamlRaw).not.toContain("should-be-ignored");
  });
});

describe("envModule apply — ref source (ADR-0004)", () => {
  it("resolves an op ref and inlines the value into env.sh (chmod 600), value not in repo/logs", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{
        kind: "env",
        name: "TOKEN",
        value: "",
        secret: true,
        source: { kind: "ref", backend: "op", ref: "op://Vault/Item/field" },
        enabled: true,
      }],
    }));
    const { exec } = makeRefExec({ op: new Map([["op://Vault/Item/field", "op-secret-value"]]) });
    const { log, warns, infos } = makeLog();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, log });

    await envModule.apply(ctx, { module: "env", actions: [] });

    const live = envShPath(tmpHome);
    expect(fs.readFileSync(live, "utf8")).toContain("export TOKEN='op-secret-value'");
    expect(fs.statSync(live).mode & 0o777).toBe(0o600);
    // never in the repo
    expect(fs.existsSync(path.join(tmpRepo, "roost", "env-secrets"))).toBe(false);
    const yamlRaw = fs.readFileSync(path.join(tmpRepo, "roost", "env.yaml"), "utf8");
    expect(yamlRaw).not.toContain("op-secret-value");
    // never in logs
    expect(warns.join("\n")).not.toContain("op-secret-value");
    expect(infos.join("\n")).not.toContain("op-secret-value");
  });

  it("resolves an rbw ref and inlines it", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{
        kind: "env",
        name: "TOKEN",
        value: "",
        secret: true,
        source: { kind: "ref", backend: "rbw", ref: "my-entry" },
        enabled: true,
      }],
    }));
    const { exec } = makeRefExec({ rbw: new Map([["my-entry", "rbw-secret"]]) });
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });
    await envModule.apply(ctx, { module: "env", actions: [] });
    expect(fs.readFileSync(envShPath(tmpHome), "utf8")).toContain("export TOKEN='rbw-secret'");
  });

  it("failure-safe: backend unavailable → warn (name+backend only), no half-write, no value leak", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{
        kind: "env",
        name: "TOKEN",
        value: "",
        secret: true,
        source: { kind: "ref", backend: "op", ref: "op://Vault/Item/secret" },
        enabled: true,
      }],
    }));
    // op present in the map but the backend is unavailable (command not found).
    const { exec } = makeRefExec({ op: new Map([["op://Vault/Item/secret", "never-resolved"]]), opAvailable: false });
    const { log, warns } = makeLog();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, log });

    await envModule.apply(ctx, { module: "env", actions: [] });

    const live = fs.readFileSync(envShPath(tmpHome), "utf8");
    // No half/blank value: it falls back to the explicit placeholder, never an empty assignment.
    expect(live).toContain("export TOKEN='<roost-secret:unset>'");
    expect(live).not.toContain("never-resolved");
    // Warned about the name + backend, but never leaked a value or raw stderr containing it.
    expect(warns.join("\n")).toMatch(/TOKEN/);
    expect(warns.join("\n")).toMatch(/op/);
    expect(warns.join("\n")).not.toContain("never-resolved");
  });

  it("dry-run resolves nothing and writes nothing for a ref item", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{
        kind: "env",
        name: "TOKEN",
        value: "",
        secret: true,
        source: { kind: "ref", backend: "op", ref: "op://Vault/Item/field" },
        enabled: true,
      }],
    }));
    const { exec, calls } = makeRefExec({ op: new Map([["op://Vault/Item/field", "secret"]]) });
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, dryRun: true });

    await envModule.apply(ctx, { module: "env", actions: [] });
    expect(fs.existsSync(envShPath(tmpHome))).toBe(false);
    expect(calls.some((c) => c.cmd === "op")).toBe(false);
  });

  it("idempotent re-apply of a ref item yields identical env.sh", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{
        kind: "env",
        name: "TOKEN",
        value: "",
        secret: true,
        source: { kind: "ref", backend: "op", ref: "op://Vault/Item/field" },
        enabled: true,
      }],
    }));
    const { exec } = makeRefExec({ op: new Map([["op://Vault/Item/field", "v1"]]) });
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });
    await envModule.apply(ctx, { module: "env", actions: [] });
    const first = fs.readFileSync(envShPath(tmpHome), "utf8");
    await envModule.apply(ctx, { module: "env", actions: [] });
    const second = fs.readFileSync(envShPath(tmpHome), "utf8");
    expect(second).toBe(first);
  });
});

describe("envModule doctor — op/rbw availability (ADR-0004)", () => {
  it("reports op and rbw availability", async () => {
    const { exec } = makeRefExec({ opAvailable: true, rbwAvailable: false });
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });
    const health = await envModule.doctor(ctx);
    const byName = Object.fromEntries(health.map((h) => [h.name, h]));
    expect(byName["op"]?.ok).toBe(true);
    expect(byName["rbw"]?.ok).toBe(false);
  });
});

// ── apply ─────────────────────────────────────────────────────────────────────

describe("envModule.apply", () => {
  it("dry-run writes nothing and reports intended targets", async () => {
    saveEnvData(tmpRepo, sampleData());
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "export FOO=bar\n");
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, dryRun: true });

    const res = await envModule.apply(ctx, { module: "env", actions: [] });
    expect(res.applied).toHaveLength(0);
    expect(res.skipped).toContain(envShPath(tmpHome));
    expect(fs.existsSync(envShPath(tmpHome))).toBe(false);
    // rc not modified
    expect(fs.readFileSync(path.join(tmpHome, ".zshrc"), "utf8")).toBe("export FOO=bar\n");
  });

  it("writes env.sh chmod 600, adds rc source line, and is idempotent", async () => {
    saveEnvData(tmpRepo, sampleData());
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "export FOO=bar\n");
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });

    const res1 = await envModule.apply(ctx, { module: "env", actions: [] });
    const live = envShPath(tmpHome);
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.statSync(live).mode & 0o777).toBe(0o600);
    expect(res1.applied).toContain(live);
    const rc1 = fs.readFileSync(path.join(tmpHome, ".zshrc"), "utf8");
    expect(rcHasMarker(rc1)).toBe(true);

    // Re-apply: no diffs, no duplicate source line.
    const res2 = await envModule.apply(ctx, { module: "env", actions: [] });
    const rc2 = fs.readFileSync(path.join(tmpHome, ".zshrc"), "utf8");
    expect(rc2).toBe(rc1); // rc unchanged
    expect((rc2.match(/# >>> roost env >>>/g) ?? []).length).toBe(1); // single block
    // env.sh applied each time (overwrite) but content identical → no drift
    expect(res2.applied).toContain(live);
    expect(fs.readFileSync(live, "utf8")).toBe(fs.readFileSync(live, "utf8"));
  });

  it("inlines decrypted secret values into env.sh", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{ kind: "env", name: "TOKEN", value: "plain123", secret: true, enabled: true }],
    }));
    writeFakeKey(tmpHome);
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });

    // First encrypt the secret via capture so a ciphertext exists.
    await envModule.capture(ctx, { modules: {} });
    await envModule.apply(ctx, { module: "env", actions: [] });

    const live = fs.readFileSync(envShPath(tmpHome), "utf8");
    expect(live).toContain("export TOKEN='plain123'");
  });

  // M1: if env.sh already exists 0644, the decrypted secret must NOT be written
  // world-readable before a later chmod. Writing via temp-then-rename guarantees
  // the final file (and every intermediate) is 0600.
  it("M1: re-writing a pre-existing 0644 env.sh ends at 0600 with no world-readable window", async () => {
    saveEnvData(tmpRepo, sampleData({
      env: [{ kind: "env", name: "TOKEN", value: "plain123", secret: true, enabled: true }],
    }));
    writeFakeKey(tmpHome);
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });
    await envModule.capture(ctx, { modules: {} });

    // Pre-create env.sh world-readable, as a prior run / umask might.
    const live = envShPath(tmpHome);
    fs.mkdirSync(path.dirname(live), { recursive: true });
    fs.writeFileSync(live, "# stale-world-readable\n");
    fs.chmodSync(live, 0o644);
    expect(fs.statSync(live).mode & 0o777).toBe(0o644);

    // Hard-link the original (0644) inode aside. A safe atomic write replaces the
    // directory entry with a BRAND-NEW 0600 inode via rename, so this link keeps
    // the stale content. A direct in-place writeFileSync would instead truncate
    // the SAME world-readable inode and the link would show the decrypted secret.
    const sameInodeProbe = path.join(path.dirname(live), "probe-hardlink");
    fs.linkSync(live, sameInodeProbe);
    const originalIno = fs.statSync(live).ino;

    await envModule.apply(ctx, { module: "env", actions: [] });

    // Final state: secret inlined, mode 0600.
    expect(fs.readFileSync(live, "utf8")).toContain("export TOKEN='plain123'");
    expect(fs.statSync(live).mode & 0o777).toBe(0o600);

    // The live path is now a NEW inode (rename), and the old world-readable inode
    // never received the decrypted secret.
    expect(fs.statSync(live).ino).not.toBe(originalIno);
    const probe = fs.readFileSync(sameInodeProbe, "utf8");
    expect(probe).toBe("# stale-world-readable\n");
    expect(probe).not.toContain("plain123");

    // No temp file left behind in the dir.
    const leftovers = fs
      .readdirSync(path.dirname(live))
      .filter((f) => f !== "env.sh" && f !== "probe-hardlink");
    expect(leftovers).toHaveLength(0);
  });
});

// ── unmanage ──────────────────────────────────────────────────────────────────

describe("envModule.unmanage", () => {
  it("removes items, regenerates, and logs the git-history warning", async () => {
    saveEnvData(tmpRepo, sampleData());
    const { exec } = makeAgeExec();
    const { log, warns } = makeLog();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, log });

    const sel: Selection = { modules: { env: ["alias:ll"] } };
    const res = await envModule.unmanage(ctx, sel);
    expect(res.applied).toContain("alias:ll");
    expect(warns.join("\n")).toMatch(/git history is NOT purged/);
    // alias removed from yaml
    expect(loadEnvData(tmpRepo).aliases.find((a) => a.name === "ll")).toBeUndefined();
  });

  it("removes the rc marker block when no items remain", async () => {
    // single alias only
    saveEnvData(tmpRepo, {
      schemaVersion: 1,
      aliases: [{ kind: "alias", name: "ll", value: "ls -la", enabled: true }],
      env: [],
      path: [],
      functions: [],
    });
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), ensureRcSourced("export FOO=bar\n").content);
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });

    await envModule.unmanage(ctx, { modules: { env: ["alias:ll"] } });
    const rc = fs.readFileSync(path.join(tmpHome, ".zshrc"), "utf8");
    expect(rcHasMarker(rc)).toBe(false);
  });

  it("dry-run reports removals without writing", async () => {
    saveEnvData(tmpRepo, sampleData());
    const before = fs.readFileSync(path.join(tmpRepo, "roost", "env.yaml"), "utf8");
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec, dryRun: true });

    const res = await envModule.unmanage(ctx, { modules: { env: ["alias:ll"] } });
    expect(res.skipped).toContain("alias:ll");
    expect(fs.readFileSync(path.join(tmpRepo, "roost", "env.yaml"), "utf8")).toBe(before);
  });

  // L2: regenerating env.sh on unmanage must re-inline the REMAINING secrets
  // (decrypt them like apply does), not blank them to the placeholder until the
  // next apply.
  it("L2: keeps unrelated secrets inlined when unmanaging an alias", async () => {
    saveEnvData(tmpRepo, sampleData({
      aliases: [
        { kind: "alias", name: "ll", value: "ls -la", enabled: true },
        { kind: "alias", name: "drop", value: "echo bye", enabled: true },
      ],
      env: [
        { kind: "env", name: "TOKEN_A", value: "secretA", secret: true, enabled: true },
        { kind: "env", name: "TOKEN_B", value: "secretB", secret: true, enabled: true },
      ],
    }));
    writeFakeKey(tmpHome);
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });

    // Encrypt + materialize env.sh so both secrets are inlined to start.
    await envModule.capture(ctx, { modules: {} });
    await envModule.apply(ctx, { module: "env", actions: [] });

    // Unmanage an UNRELATED alias.
    await envModule.unmanage(ctx, { modules: { env: ["alias:drop"] } });

    const live = fs.readFileSync(envShPath(tmpHome), "utf8");
    expect(live).toContain("export TOKEN_A='secretA'");
    expect(live).toContain("export TOKEN_B='secretB'");
    expect(live).not.toContain("<roost-secret:unset>");
    expect(live).not.toContain("alias drop=");
  });
});

// ── doctor ────────────────────────────────────────────────────────────────────

describe("envModule.doctor", () => {
  it("reports rc presence, wiring, age key, and env.sh mode", async () => {
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), ensureRcSourced("").content);
    fs.mkdirSync(path.dirname(envShPath(tmpHome)), { recursive: true });
    fs.writeFileSync(envShPath(tmpHome), "# x", { mode: 0o600 });
    fs.chmodSync(envShPath(tmpHome), 0o600);
    writeFakeKey(tmpHome);
    const { exec } = makeAgeExec();
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });

    const health = await envModule.doctor(ctx);
    const byName = Object.fromEntries(health.map((h) => [h.name, h]));
    expect(byName["rc-files"]?.ok).toBe(true);
    expect(byName["rc-sourced"]?.ok).toBe(true);
    expect(byName["age-key"]?.ok).toBe(true);
    expect(byName["env.sh"]?.ok).toBe(true);
  });
});

// ── dotfiles de-confliction ────────────────────────────────────────────────────

describe("dotfiles excludes ~/.config/roost", () => {
  it("does not discover ~/.config/roost/env.sh nor the roost dir", async () => {
    const roostDir = path.join(tmpHome, ".config", "roost");
    fs.mkdirSync(roostDir, { recursive: true });
    fs.writeFileSync(path.join(roostDir, "env.sh"), "# generated");
    // a normal sibling to prove discover still works
    fs.mkdirSync(path.join(tmpHome, ".config", "nvim"), { recursive: true });

    const exec: Exec = { async run(): Promise<ExecResult> { return { code: 0, stdout: "", stderr: "" }; } };
    const ctx = makeCtx({ repoDir: tmpRepo, home: tmpHome, exec });
    const candidates = await dotfilesModule.discover(ctx);

    expect(candidates.some((c) => c.path.includes("/.config/roost"))).toBe(false);
    expect(candidates.some((c) => c.path.endsWith("env.sh"))).toBe(false);
    // sibling still discovered
    expect(candidates.some((c) => c.path.endsWith("nvim"))).toBe(true);
  });
});
