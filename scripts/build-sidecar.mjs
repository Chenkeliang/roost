#!/usr/bin/env node
// Build the self-contained engine binary (Node SEA: embedded Node + bundled cli)
// and place it where Tauri expects its sidecar: src-tauri/binaries/roost-server-<triple>.
// Dual-arch. Reuses the proven SEA pipeline (esbuild → blob → postject → ad-hoc sign).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "dist-app");
const BIN_DIR = path.join(ROOT, "packages", "web", "src-tauri", "binaries");
const FUSE = "fce680ab2cc467b6e072b8b5df1996b2"; // Node SEA standard fuse
const NODE_VER = process.versions.node;
const TRIPLES = { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" };
const ARCHES = (process.env.ROOST_ARCHES || "arm64,x64").split(",");

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });

function bundleCli() {
  fs.mkdirSync(OUT, { recursive: true });
  sh("node_modules/.bin/esbuild", [
    "packages/cli/src/index.ts",
    "--bundle", "--platform=node", "--target=node24",
    "--format=cjs", `--outfile=${path.join(OUT, "cli.cjs")}`,
  ]);
}

function genBlob() {
  sh(process.execPath, ["--experimental-sea-config", "scripts/sea-config.json"]);
}

function nodeBaseFor(arch) {
  if (arch === process.arch) return process.execPath;
  const tgz = path.join(OUT, `node-${arch}.tar.gz`);
  const url = `https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-darwin-${arch}.tar.gz`;
  sh("curl", ["-sL", "-o", tgz, url]);
  sh("tar", ["xzf", tgz, "-C", OUT]);
  return path.join(OUT, `node-v${NODE_VER}-darwin-${arch}`, "bin", "node");
}

function buildSidecar(arch) {
  const triple = TRIPLES[arch];
  if (!triple) throw new Error(`unknown arch ${arch}`);
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const bin = path.join(BIN_DIR, `roost-server-${triple}`);
  fs.rmSync(bin, { force: true });
  fs.copyFileSync(nodeBaseFor(arch), bin);
  fs.chmodSync(bin, 0o755);
  sh("codesign", ["--remove-signature", bin]);
  sh("npx", ["--yes", "postject", bin, "NODE_SEA_BLOB", path.join(OUT, "sea-prep.blob"),
    "--sentinel-fuse", `NODE_SEA_FUSE_${FUSE}`, "--macho-segment-name", "NODE_SEA"]);
  sh("codesign", ["--sign", "-", "--force", bin]);
  sh("xattr", ["-cr", bin]);
  console.log("built sidecar", bin);
}

bundleCli();
genBlob();
for (const a of ARCHES) buildSidecar(a);
console.log("done:", ARCHES.join(", "));
