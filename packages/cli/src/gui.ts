import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { createExec, createLogger, createT, defaultRegistry } from "@roost/core";
import type { ModuleContext } from "@roost/shared";
import { buildServer } from "./server.js";

/** In a .app, web assets live at Contents/Resources/web, sibling of MacOS/. */
export function resolveWebDir(execPath: string): string {
  return path.join(path.dirname(execPath), "..", "Resources", "web");
}

/** True when the executable sits at *.app/Contents/MacOS/<bin>. */
export function isInsideAppBundle(execPath: string): boolean {
  return /\.app\/Contents\/MacOS\/[^/]+$/.test(execPath);
}

/** Append-only log file under ~/Library/Logs/Roost (GUI launch has no terminal). */
function openLog(): fs.WriteStream {
  const dir = path.join(os.homedir(), "Library", "Logs", "Roost");
  fs.mkdirSync(dir, { recursive: true });
  return fs.createWriteStream(path.join(dir, "roost.log"), { flags: "a" });
}

/**
 * GUI launch: pick a free port, start the server, open the default browser.
 */
export async function runGui(opts: {
  repoDir: string;
  webDir?: string;
}): Promise<void> {
  const log = openLog();
  const write = (m: string) => log.write(`[${m}]\n`);

  const home = os.homedir();
  const makeCtx = (dryRun: boolean): ModuleContext => ({
    repoDir: opts.repoDir,
    home,
    profile: "base",
    dryRun,
    exec: createExec(),
    log: createLogger(),
    t: createT(process.env["ROOST_LOCALE"] ?? "en"),
  });

  const webDir = opts.webDir ?? resolveWebDir(process.execPath);
  const registry = defaultRegistry();

  let server: ReturnType<typeof buildServer>;
  const quit = () => {
    write("quit requested");
    void server.close().finally(() => process.exit(0));
  };

  server = buildServer({
    repoDir: opts.repoDir,
    registry,
    makeCtx,
    webDir,
    appMode: true,
    onQuit: quit,
  });

  // port 0 -> kernel assigns a free port (no hard-coded 4317 clash).
  await server.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;
  write(`listening ${url} webDir=${webDir}`);

  spawn("open", [url], { stdio: "ignore", detached: true }).unref();

  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}
