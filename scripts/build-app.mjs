#!/usr/bin/env node
// Build self-contained Roost.app for one or both arches. Uses repo esbuild +
// system node/codesign/ditto/curl/tar + npx postject. No new deps.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "dist-app");
const VERSION = process.env.ROOST_VERSION || "0.0.0";
const FUSE = "fce680ab2cc467b6e072b8b5df1996b2"; // Node SEA standard fuse
const NODE_VER = process.versions.node; // bundle the same node we build with
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

function buildApp(arch) {
  const appDir = path.join(OUT, `arch-${arch}`, "Roost.app");
  const macos = path.join(appDir, "Contents", "MacOS");
  const res = path.join(appDir, "Contents", "Resources");
  fs.rmSync(path.join(OUT, `arch-${arch}`), { recursive: true, force: true });
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(path.join(res, "web"), { recursive: true });

  const bin = path.join(macos, "Roost");
  fs.copyFileSync(nodeBaseFor(arch), bin);
  fs.chmodSync(bin, 0o755);
  sh("codesign", ["--remove-signature", bin]);
  sh("npx", ["--yes", "postject", bin, "NODE_SEA_BLOB",
    path.join(OUT, "sea-prep.blob"),
    "--sentinel-fuse", `NODE_SEA_FUSE_${FUSE}`,
    "--macho-segment-name", "NODE_SEA"]);
  sh("codesign", ["--sign", "-", "--force", bin]);

  sh("cp", ["-R", "packages/web/dist/.", path.join(res, "web")]);
  const plist = fs.readFileSync("scripts/Info.plist.template", "utf8")
    .replaceAll("__VERSION__", VERSION);
  fs.writeFileSync(path.join(appDir, "Contents", "Info.plist"), plist);
  const icon = path.join(ROOT, "scripts", "AppIcon.icns");
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(res, "AppIcon.icns"));

  sh("codesign", ["--force", "--deep", "--sign", "-", appDir]);
  const zip = path.join(OUT, `Roost-${VERSION}-macos-${arch}.zip`);
  fs.rmSync(zip, { force: true });
  sh("ditto", ["-c", "-k", "--keepParent", appDir, zip]);
  console.log("built", zip);
  return appDir;
}

bundleCli();
genBlob();
for (const a of ARCHES) buildApp(a);
console.log("done:", ARCHES.join(", "));
