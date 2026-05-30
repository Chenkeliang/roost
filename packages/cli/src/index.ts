#!/usr/bin/env node
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import * as prompts from "@clack/prompts";
import { ModuleRegistry, exampleModule, createExec, createLogger, createT, defaultRegistry, loadProfiles, resolveProfile, defaultAgeKeyPath } from "@roost/core";
import * as readline from "node:readline";
import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";
import { runInitGithub } from "./initGithub.js";
import { runSelect } from "./commands/select.js";
import { runCapture } from "./commands/capture.js";
import { runLoad } from "./commands/load.js";
import { runList } from "./commands/list.js";
import { runUnmanage } from "./commands/unmanage.js";
import { runProfile } from "./commands/profile.js";
import { runStatus } from "./commands/status.js";
import { runDiff } from "./commands/diff.js";
import { runLearn } from "./commands/learn.js";
import { runImport } from "./commands/import.js";
import { runAudit } from "./commands/audit.js";
import { runKeyRotate } from "./commands/keyRotate.js";
import { runKeyBackup, remindOfflineBackup } from "./commands/keyBackup.js";
import { runPlugins } from "./commands/plugins.js";
import { runServe } from "./server.js";

const program = new Command();
program.name("roost").description("Back up and migrate your Mac setup").version("0.0.0");
program.option("--profile <name>", "Override the active machine profile");

function buildCtx(opts: { dryRun?: boolean } = {}) {
  const home = os.homedir();
  const repoDir = process.env["ROOST_REPO"] ?? path.join(home, ".local", "share", "chezmoi");
  // Profile resolution: --profile flag > ROOST_PROFILE env > hostname match > "base".
  // profiles.yaml is an OPTIONAL additive data file (not selection.yaml).
  let profiles: ReturnType<typeof loadProfiles> = [];
  try {
    profiles = loadProfiles(repoDir);
  } catch {
    // A malformed profiles.yaml must not break unrelated commands; fall back to base.
    profiles = [];
  }
  const flag = program.opts<{ profile?: string }>().profile;
  const { profile } = resolveProfile({
    flag,
    env: process.env["ROOST_PROFILE"],
    hostname: os.hostname(),
    profiles,
  });
  return {
    repoDir,
    ctx: {
      repoDir,
      home,
      profile,
      dryRun: opts.dryRun ?? false,
      exec: createExec(),
      log: createLogger(),
      t: createT(process.env["ROOST_LOCALE"] ?? "en"),
    },
  };
}

// Resolve a GitHub PAT: prefer GITHUB_TOKEN env (non-interactive), else a masked
// password prompt. The returned token is used once by the caller and discarded;
// it is never logged or persisted here.
async function promptGitHubToken(): Promise<string | null> {
  const fromEnv = process.env["GITHUB_TOKEN"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const entered = await prompts.password({
    message: "GitHub Personal Access Token (repo scope) — used once, never stored",
    validate: (v) => (!v || v.length === 0 ? "Token is required" : undefined),
  });
  if (prompts.isCancel(entered)) {
    prompts.cancel("Cancelled.");
    process.exit(0);
  }
  return entered;
}

async function promptRepoName(defaultName: string): Promise<string> {
  const entered = await prompts.text({
    message: "Name for the new private GitHub repo",
    defaultValue: defaultName,
    placeholder: defaultName,
  });
  if (prompts.isCancel(entered)) {
    prompts.cancel("Cancelled.");
    process.exit(0);
  }
  return entered.length > 0 ? entered : defaultName;
}

program.command("doctor").description("Check dependencies and module health").action(async () => {
  const reg = new ModuleRegistry();
  reg.register(exampleModule);
  const { ctx } = buildCtx({ dryRun: true });
  for (const h of await runDoctor(reg, ctx)) {
    console.log(`${h.ok ? "ok " : "FAIL"} ${h.name}${h.detail ? " — " + h.detail : ""}`);
  }
});

program
  .command("init")
  .description("Scaffold the config repo with roost/ and chezmoi stubs")
  .option("--repo <dir>", "Path to the config repo directory")
  .option("--github", "Also create a PRIVATE GitHub repo via the API, wire origin, and push")
  .option("--dry-run", "With --github: print intent and make no API calls or pushes")
  .action(async (opts: { repo?: string; github?: boolean; dryRun?: boolean }) => {
    const { repoDir, ctx } = buildCtx({ dryRun: opts.dryRun });
    const resolvedRepo = opts.repo ?? repoDir;

    if (opts.github) {
      await runInitGithub({
        repoDir: resolvedRepo,
        exec: ctx.exec,
        log: ctx.log,
        dryRun: opts.dryRun ?? false,
        getToken: promptGitHubToken,
        getRepoName: promptRepoName,
      });
      return;
    }

    const { created } = await runInit({ repoDir: resolvedRepo });
    if (created.length === 0) {
      ctx.log.info("roost init: already initialized, nothing to do");
    } else {
      for (const f of created) ctx.log.info(`created: ${f}`);
    }

    // If an age key is already present, remind the user (once) to back it up offline.
    remindOfflineBackup({ keyPath: defaultAgeKeyPath(ctx.home), log: (msg) => ctx.log.warn(msg) });
  });

program
  .command("select")
  .description("Discover and select candidates to track")
  .option("--all", "Select all non-excluded candidates")
  .option("--preset <name>", "Select candidates matching a preset (e.g. developer-essentials)")
  .action(async (opts: { all?: boolean; preset?: string }) => {
    const { repoDir, ctx } = buildCtx();
    const sel = await runSelect({ repoDir, ctx, all: opts.all, preset: opts.preset });
    const total = Object.values(sel.modules).flat().length;
    ctx.log.info(`selected ${total} items`);
  });

program
  .command("capture")
  .description("Capture selected files into the config repo")
  .action(async () => {
    const { repoDir, ctx } = buildCtx();
    const changeSets = await runCapture({ repoDir, ctx });
    for (const cs of changeSets) {
      ctx.log.info(`[${cs.module}] written: ${cs.written.length}, encrypted: ${cs.encrypted.length}`);
    }
  });

program
  .command("load")
  .description("Apply the config repo to the current machine (dry-run by default)")
  .option("--apply", "Actually apply changes (default is dry-run)")
  .action(async (opts: { apply?: boolean }) => {
    const { repoDir, ctx } = buildCtx({ dryRun: !opts.apply });
    await runLoad({ repoDir, ctx, apply: opts.apply });
  });

program
  .command("list")
  .description("List selected items and their drift state")
  .action(async () => {
    const { repoDir, ctx } = buildCtx();
    await runList({ repoDir, ctx });
  });

program
  .command("unmanage")
  .description("Stop managing a single item: forget it from the repo and drop it from selection.yaml")
  .argument("[module]", "Module that owns the item (e.g. dotfiles)")
  .argument("[id]", "Item id to unmanage")
  .option("--module <m>", "Module that owns the item")
  .option("--id <id>", "Item id to unmanage")
  .option("--dry-run", "Print intent and write nothing")
  .action(async (modArg: string | undefined, idArg: string | undefined, opts: { module?: string; id?: string; dryRun?: boolean }) => {
    const mod = modArg ?? opts.module;
    const id = idArg ?? opts.id;
    if (!mod || !id) {
      console.error("usage: roost unmanage <module> <id>   (or --module <m> --id <id>)");
      process.exit(1);
    }
    const { repoDir, ctx } = buildCtx({ dryRun: opts.dryRun });
    const reg = defaultRegistry();
    await runUnmanage({ repoDir, ctx, registry: reg, module: mod, id, dryRun: opts.dryRun });
  });

program
  .command("status")
  .description("Show drift status for all selected modules")
  .action(async () => {
    const { repoDir, ctx } = buildCtx();
    await runStatus({ repoDir, ctx });
  });

program
  .command("diff")
  .description("Show diff between repo state and current machine")
  .action(async () => {
    const { repoDir, ctx } = buildCtx();
    await runDiff({ repoDir, ctx });
  });

// ── app <sub-command group> ───────────────────────────────────────────────────

const appCmd = program.command("app").description("App-level commands");

appCmd
  .command("learn")
  .description("Record which app domains changed while you edit a setting in a GUI app")
  .action(async () => {
    const { repoDir, ctx } = buildCtx();
    const confirm = (): Promise<void> =>
      new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question("Change the setting in the app, then press Enter…", () => {
          rl.close();
          resolve();
        });
      });
    const { changedDomains } = await runLearn({ ctx, repoDir, confirm });
    if (changedDomains.length === 0) {
      ctx.log.info("No domains changed.");
    } else {
      ctx.log.info(`Captured ${changedDomains.length} changed domain(s): ${changedDomains.join(", ")}`);
    }
  });

program
  .command("import")
  .description("Import candidates from an existing dotfiles repo or mackup setup")
  .option("--source <source>", "Source to import from: auto, dotfiles, mackup", "auto")
  .option("--path <dir>", "Path to dotfiles repo (required when --source dotfiles)")
  .action(async (opts: { source: string; path?: string }) => {
    const { ctx } = buildCtx();
    const source = opts.source as "auto" | "dotfiles" | "mackup";
    const results = await runImport({ home: ctx.home, source, path: opts.path });
    if (results.length === 0) {
      ctx.log.info("No importers detected.");
      return;
    }
    for (const result of results) {
      ctx.log.info(`\n[${result.source}] ${result.candidates.length} candidate(s)`);
      for (const c of result.candidates) {
        ctx.log.info(`  ${c.recommendation}  ${c.path}`);
      }
      for (const note of result.notes) {
        ctx.log.warn(`  note: ${note}`);
      }
    }
  });

program
  .command("audit")
  .description("Audit the config repo for plaintext secrets")
  .option("--repo <dir>", "Path to the config repo directory")
  .action(async (opts: { repo?: string }) => {
    const { repoDir, ctx } = buildCtx();
    const resolvedRepo = opts.repo ?? repoDir;
    const report = await runAudit({ repoDir: resolvedRepo });
    ctx.log.info(`Encrypted files : ${report.encryptedFiles}`);
    ctx.log.info(`Scanned files   : ${report.scannedFiles}`);
    if (report.plaintextFindings.length > 0) {
      ctx.log.warn("Plaintext secret findings:");
      for (const f of report.plaintextFindings) {
        ctx.log.warn(`  ${f.path} (${f.rule})`);
      }
    }
    if (report.ok) {
      ctx.log.info("Audit passed — no plaintext secrets found.");
    } else {
      ctx.log.error(`Audit FAILED — ${report.plaintextFindings.length} finding(s).`);
      process.exit(1);
    }
  });

// ── key <sub-command group> ───────────────────────────────────────────────────

const keyCmd = program.command("key").description("Age key management commands");

keyCmd
  .command("rotate")
  .description("Re-encrypt all .age files in the repo to a new age recipient")
  .requiredOption("--new-recipient <age1...>", "New age recipient public key")
  .option("--old-key <path>", "Path to the existing age private key", path.join(os.homedir(), ".config", "age", "key.txt"))
  .option("--repo <dir>", "Path to the config repo directory")
  .action(async (opts: { newRecipient: string; oldKey: string; repo?: string }) => {
    const { repoDir, ctx } = buildCtx();
    const resolvedRepo = opts.repo ?? repoDir;
    await runKeyRotate({
      exec: ctx.exec,
      repoDir: resolvedRepo,
      oldKeyPath: opts.oldKey,
      newRecipient: opts.newRecipient,
      log: (msg) => ctx.log.info(msg),
    });
  });

keyCmd
  .command("backup")
  .description("Show where the age key lives and how to back it up offline (recovery material)")
  .option("--key <path>", "Path to the age private key", defaultAgeKeyPath(os.homedir()))
  .option("--show", "Also print the key contents (handle with care)")
  .action((opts: { key: string; show?: boolean }) => {
    const { ctx } = buildCtx();
    runKeyBackup({ keyPath: opts.key, show: opts.show, log: (msg) => ctx.log.info(msg) });
  });

// ── plugins ───────────────────────────────────────────────────────────────────

// ── profile ───────────────────────────────────────────────────────────────────

const profileCmd = program
  .command("profile")
  .description("Show the currently-resolved machine profile and how it was resolved")
  .action(() => {
    const { repoDir, ctx } = buildCtx();
    runProfile({
      repoDir,
      hostname: os.hostname(),
      flag: program.opts<{ profile?: string }>().profile,
      env: process.env["ROOST_PROFILE"],
      log: (msg) => ctx.log.info(msg),
    });
  });

profileCmd
  .command("list")
  .description("List defined profiles and mark the active one")
  .action(() => {
    const { repoDir, ctx } = buildCtx();
    runProfile({
      repoDir,
      hostname: os.hostname(),
      flag: program.opts<{ profile?: string }>().profile,
      env: process.env["ROOST_PROFILE"],
      log: (msg) => ctx.log.info(msg),
      list: true,
    });
  });

program
  .command("plugins")
  .description("List currently registered module names")
  .action(() => {
    const reg = defaultRegistry();
    const { ctx } = buildCtx();
    runPlugins({ registry: reg, log: (msg) => ctx.log.info(msg) });
  });

program
  .command("serve")
  .description("Start the local JSON API server (browser mode fallback)")
  .option("--port <n>", "Port to listen on (default 4317)", (v) => parseInt(v, 10))
  .option("--repo <dir>", "Path to the config repo directory")
  .option("--web <dir>", "Path to the web build directory (packages/web/dist)")
  .action(async (opts: { port?: number; repo?: string; web?: string }) => {
    const { repoDir } = buildCtx();
    await runServe({
      repoDir: opts.repo ?? repoDir,
      port: opts.port,
      webDir: opts.web,
    });
  });

program.parseAsync();
