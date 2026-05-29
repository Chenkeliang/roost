#!/usr/bin/env node
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { ModuleRegistry, exampleModule, createExec, createLogger, createT } from "@roost/core";
import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";

const program = new Command();
program.name("roost").description("Back up and migrate your Mac setup").version("0.0.0");

program.command("doctor").description("Check dependencies and module health").action(async () => {
  const reg = new ModuleRegistry();
  reg.register(exampleModule);
  const ctx = { repoDir: process.cwd(), home: process.env.HOME ?? "", profile: "base", dryRun: true, exec: createExec(), log: createLogger(), t: createT(process.env.ROOST_LOCALE ?? "en") };
  for (const h of await runDoctor(reg, ctx)) console.log(`${h.ok ? "ok " : "FAIL"} ${h.name}${h.detail ? " — " + h.detail : ""}`);
});

program
  .command("init")
  .description("Scaffold the config repo with roost/ and chezmoi stubs")
  .option("--repo <dir>", "Path to the config repo directory")
  .action(async (opts: { repo?: string }) => {
    const defaultRepo =
      process.env["ROOST_REPO"] ?? path.join(os.homedir(), ".local", "share", "chezmoi");
    const repoDir = opts.repo ?? defaultRepo;
    const log = createLogger();
    const { created } = await runInit({ repoDir });
    if (created.length === 0) {
      log.info("roost init: already initialized, nothing to do");
    } else {
      for (const f of created) log.info(`created: ${f}`);
    }
  });

program.parseAsync();
