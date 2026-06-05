#!/usr/bin/env node
// Launch a built Roost.app, prove the dashboard serves, then quit it.
// Usage: node scripts/smoke-app.mjs dist-app/arch-arm64/Roost.app [--rosetta]
import { spawn, execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const appDir = process.argv[2];
const rosetta = process.argv.includes("--rosetta");
if (!appDir) { console.error("usage: smoke-app.mjs <Roost.app> [--rosetta]"); process.exit(2); }

const bin = path.join(appDir, "Contents", "MacOS", "Roost");
const cmd = rosetta ? "arch" : bin;
const args = rosetta ? ["-x86_64", bin, "gui"] : ["gui"];

// strip quarantine so a freshly-built bundle launches without prompt
try { execFileSync("xattr", ["-dr", "com.apple.quarantine", appDir]); } catch {}

// Record current log size so we only read NEW lines this run produces.
const logPath = path.join(os.homedir(), "Library", "Logs", "Roost", "roost.log");
let startOffset = 0;
try { startOffset = fs.statSync(logPath).size; } catch {}

const child = spawn(cmd, args, { stdio: "ignore", detached: false });

async function findPort(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const buf = fs.readFileSync(logPath, "utf8").slice(startOffset);
      const lines = buf.trim().split("\n");
      const last = [...lines].reverse().find((l) => l.includes("listening http"));
      const m = last && last.match(/127\.0\.0\.1:(\d+)/);
      if (m) return Number(m[1]);
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not report a port in time");
}

async function get(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

try {
  // rosetta cold start can exceed 5s (AOT translation) — allow 30s.
  const port = await findPort(30_000);
  const base = `http://127.0.0.1:${port}`;
  const health = await get(`${base}/api/health`);
  if (health.status !== 200) throw new Error(`health ${health.status}`);
  if (!JSON.parse(health.body).appMode) throw new Error("appMode not set");
  const index = await get(`${base}/`);
  if (index.status !== 200 || !/<div id="root"|<title/i.test(index.body))
    throw new Error("dashboard html not served");
  await fetch(`${base}/api/quit`, { method: "POST" });
  await new Promise((r) => setTimeout(r, 1500));
  if (child.exitCode === null && !child.killed) child.kill();
  console.log("SMOKE OK", appDir, rosetta ? "(rosetta)" : "");
  process.exit(0);
} catch (e) {
  try { child.kill(); } catch {}
  console.error("SMOKE FAIL:", e.message);
  process.exit(1);
}
