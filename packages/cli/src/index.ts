#!/usr/bin/env node
import { Command } from "commander";
import { ModuleRegistry, exampleModule, createExec, createLogger, createT } from "@roost/core";
import { runDoctor } from "./doctor.js";

const program = new Command();
program.name("roost").description("Back up and migrate your Mac setup").version("0.0.0");
program.command("doctor").description("Check dependencies and module health").action(async () => {
  const reg = new ModuleRegistry();
  reg.register(exampleModule);
  const ctx = { repoDir: process.cwd(), home: process.env.HOME ?? "", profile: "base", dryRun: true, exec: createExec(), log: createLogger(), t: createT(process.env.ROOST_LOCALE ?? "en") };
  for (const h of await runDoctor(reg, ctx)) console.log(`${h.ok ? "ok " : "FAIL"} ${h.name}${h.detail ? " — " + h.detail : ""}`);
});
program.parseAsync();
