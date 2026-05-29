#!/usr/bin/env node
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { ModuleRegistry, exampleModule, createExec, createLogger, createT } from "@roost/core";
import * as readline from "node:readline";
import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";
import { runSelect } from "./commands/select.js";
import { runCapture } from "./commands/capture.js";
import { runLoad } from "./commands/load.js";
import { runList } from "./commands/list.js";
import { runStatus } from "./commands/status.js";
import { runDiff } from "./commands/diff.js";
import { runLearn } from "./commands/learn.js";

const program = new Command();
program.name("roost").description("Back up and migrate your Mac setup").version("0.0.0");

function buildCtx(opts: { dryRun?: boolean } = {}) {
  const home = os.homedir();
  const repoDir = process.env["ROOST_REPO"] ?? path.join(home, ".local", "share", "chezmoi");
  return {
    repoDir,
    ctx: {
      repoDir,
      home,
      profile: "base" as const,
      dryRun: opts.dryRun ?? false,
      exec: createExec(),
      log: createLogger(),
      t: createT(process.env["ROOST_LOCALE"] ?? "en"),
    },
  };
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
  .action(async (opts: { repo?: string }) => {
    const { repoDir, ctx } = buildCtx();
    const resolvedRepo = opts.repo ?? repoDir;
    const { created } = await runInit({ repoDir: resolvedRepo });
    if (created.length === 0) {
      ctx.log.info("roost init: already initialized, nothing to do");
    } else {
      for (const f of created) ctx.log.info(`created: ${f}`);
    }
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

program.parseAsync();
