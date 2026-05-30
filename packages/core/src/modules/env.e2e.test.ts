import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import type { ModuleContext, EnvData } from "@roost/shared";
import { envModule, envShPath } from "./env.js";
import { saveEnvData } from "../env-data.js";
import { createExec } from "../exec.js";
import { createLogger } from "../logger.js";
import { createT } from "../i18n/index.js";

// ── REAL end-to-end round-trip ──────────────────────────────────────────────────
//
// Unlike env.test.ts (which fakes the `age` toolchain via a stub Exec), this test
// uses the REAL module, the REAL filesystem in temp dirs, the REAL `createExec`
// adapter, and — crucially — invokes a REAL `sh` to source the generated env.sh and
// assert it is valid, sourceable, working shell. It uses ONLY non-secret items so
// no `age` key/binary is required, making it deterministic and CI-safe (`sh` is
// always present). No network, no mocks for the shell-sourcing assertions.

/** The single-quote-containing alias value that must survive real shell sourcing. */
const ALIAS_VALUE = "echo 'hi there'";
const ENV_VALUE = "nvim";
/**
 * A value carrying BOTH a single and a double quote. Asserting its round-trip via
 * `printf "%s" "$VAR"` is shell-agnostic — the generated file uses standard POSIX
 * `'\''` escaping which both bash and dash parse identically. (We deliberately do
 * NOT assert on `alias` *listing* format, which bash renders as `'\''` and dash as
 * `'"'"'` — same value, different display — which would make the test shell-specific.)
 */
const QUOTED_VALUE = "a'b c\"d";

function makeRealCtx(repoDir: string, home: string): ModuleContext {
  return {
    repoDir,
    home,
    profile: "base",
    dryRun: false,
    exec: createExec(), // REAL exec adapter (execa) — not a stub
    log: createLogger(() => {}), // real logger, silenced sink
    t: createT("en"),
  };
}

function sampleEnvData(): EnvData {
  return {
    schemaVersion: 1,
    aliases: [
      // value carries a single quote → proves POSIX escaping survives real sourcing
      { kind: "alias", name: "say", value: ALIAS_VALUE, enabled: true },
      { kind: "alias", name: "ll", value: "ls -la", enabled: true },
    ],
    env: [
      // non-secret → no age key needed; printed back verbatim by the shell
      { kind: "env", name: "ROOST_E2E_EDITOR", value: ENV_VALUE, secret: false, enabled: true },
      // carries single + double quotes → portable proof POSIX escaping round-trips
      { kind: "env", name: "ROOST_E2E_QUOTED", value: QUOTED_VALUE, secret: false, enabled: true },
    ],
    path: [
      // $HOME must expand at source time (env.sh emits it double-quoted)
      { kind: "path", value: "$HOME/roost-e2e-bin", position: "prepend", enabled: true },
    ],
    functions: [],
  };
}

/**
 * Source the generated env.sh in a REAL `sh` with a controlled HOME, then run the
 * given inline script. Returns stdout. `execFileSync` (not the module's exec) keeps
 * this a genuinely independent verification of the artifact.
 */
function sourceAndRun(home: string, script: string): string {
  return execFileSync(
    "sh",
    ["-c", `. "$HOME/.config/roost/env.sh"; ${script}`],
    { env: { HOME: home }, encoding: "utf8" },
  );
}

let dirs: string[] = [];
function mkTemp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("env module — real-shell e2e round-trip", () => {
  it("apply → source in real sh → escaping/expansion/idempotency all hold", async () => {
    const home = mkTemp("roost-env-e2e-home-");
    const repoDir = mkTemp("roost-env-e2e-repo-");

    // 1. Author the data via the module's real save path (roost/env.yaml).
    saveEnvData(repoDir, sampleEnvData());
    expect(fs.existsSync(path.join(repoDir, "roost", "env.yaml"))).toBe(true);

    // Seed a real ~/.zshrc so apply has an rc to wire.
    const zshrc = path.join(home, ".zshrc");
    fs.writeFileSync(zshrc, "# seeded zshrc\nexport SEED=1\n");

    // 2. Run the REAL apply (real ctx, real fs, dryRun:false).
    const ctx = makeRealCtx(repoDir, home);
    const res1 = await envModule.apply(ctx, { module: "env", actions: [] });

    // env.sh exists and is exactly mode 0600.
    const live = envShPath(home);
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.statSync(live).mode & 0o777).toBe(0o600);
    expect(res1.applied).toContain(live);

    // Exactly ONE source block appended to the seeded rc.
    const rc1 = fs.readFileSync(zshrc, "utf8");
    expect((rc1.match(/# >>> roost env >>>/g) ?? []).length).toBe(1);
    expect(rc1).toContain("# seeded zshrc"); // original content preserved
    expect(res1.applied).toContain(zshrc);

    // 3. SOURCE IT IN A REAL SHELL and assert it works.

    // (a) The quote-containing alias: sourcing must succeed (exit 0 — proves no
    //     syntax break from the embedded single quote; execFileSync throws on a
    //     non-zero exit) and the payload must appear in the listing. We do NOT
    //     assert the exact escape rendering — bash and dash display it differently
    //     (`'\''` vs `'"'"'`) for the same value; that proof lives in (b) instead.
    const aliasOut = sourceAndRun(home, "alias say");
    expect(aliasOut.startsWith("say=")).toBe(true);
    expect(aliasOut).toContain("hi there"); // the value payload survived
    // The plain alias is intact too.
    expect(sourceAndRun(home, "alias ll")).toContain("ls -la");

    // (b) The non-secret env vars print their EXACT values — the portable proof
    //     that POSIX single-quote escaping round-trips through real `sh` (identical
    //     on bash and dash), including a value carrying single + double quotes.
    expect(sourceAndRun(home, 'printf "%s" "$ROOST_E2E_EDITOR"')).toBe(ENV_VALUE);
    expect(sourceAndRun(home, 'printf "%s" "$ROOST_E2E_QUOTED"')).toBe(QUOTED_VALUE);

    // (c) $PATH contains the EXPANDED $HOME/... entry (not the literal "$HOME").
    const pathOut = sourceAndRun(home, 'printf "%s" "$PATH"');
    expect(pathOut).toContain(`${home}/roost-e2e-bin`);
    expect(pathOut).not.toContain("$HOME/roost-e2e-bin");

    // 4. Idempotency: a second apply yields a byte-identical env.sh and still
    //    exactly ONE source block (no duplicate).
    const bytesBefore = fs.readFileSync(live);
    await envModule.apply(ctx, { module: "env", actions: [] });
    const bytesAfter = fs.readFileSync(live);
    expect(bytesAfter.equals(bytesBefore)).toBe(true);

    const rc2 = fs.readFileSync(zshrc, "utf8");
    expect(rc2).toBe(rc1); // rc unchanged on re-apply
    expect((rc2.match(/# >>> roost env >>>/g) ?? []).length).toBe(1);
  });
});
