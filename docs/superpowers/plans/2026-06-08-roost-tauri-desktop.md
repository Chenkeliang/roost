# Roost Native Desktop (Tauri) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Roost as a real native macOS desktop app — a Tauri window that loads the existing React UI, with the existing self-contained SEA binary running as the Tauri sidecar engine (`serve --port 4317`), producing `Roost.app` + `Roost.dmg` (arm64 + x64, unsigned).

**Architecture:** Tauri v2 is a new UI shell only — `core`/`cli` logic and the React UI are reused unchanged. The Tauri native window loads `packages/web/dist`; `api.ts` already points the API base at `http://127.0.0.1:4317` under Tauri. The engine is the SEA binary repurposed as a Tauri sidecar (`binaries/roost-server-<triple>`), spawned in release via `tauri-plugin-shell` and terminated on app exit; in dev it falls back to system `node … serve`. The old SEA+browser packaging (approach B) is retired.

**Tech Stack:** Tauri v2 (Rust), `tauri-plugin-shell`, Node SEA (existing), esbuild, vitest, React, `@tauri-apps/cli`.

**Spec:** `docs/superpowers/specs/2026-06-08-roost-tauri-desktop-design.md`. Supersedes ADR-0011 approach B.

**Context the implementer needs:**
- `packages/web/src-tauri/` is already scaffolded & git-tracked: `tauri.conf.json` (window 1100×720, bundle targets `["app","dmg"]`, `externalBin: ["binaries/roost-server"]`, CSP allows `connect-src http://127.0.0.1:4317`), `Cargo.toml` (tauri v2 + `tauri-plugin-shell`), `src/main.rs` (currently dev-only: spawns system `node`), `icons/` (full set), `binaries/roost-server-aarch64-apple-darwin` (107-byte PLACEHOLDER), `.gitignore` (ignores `target/`, `gen/`).
- Rust toolchain (cargo/rustc) is installed. The `tauri` CLI is NOT on PATH; invoke via `pnpm --filter @roost/web exec tauri …`.
- The existing SEA build is `scripts/build-app.mjs` (esbuild→SEA blob→postject→ad-hoc sign). It currently emits a browser `.app`. We repurpose its core into `scripts/build-sidecar.mjs` that emits the sidecar binary instead.
- Tests run from repo root: `cd /Users/keliang/MacMove && pnpm test` (core/cli vitest) and `pnpm --filter @roost/web test` (web). Lint: `pnpm lint`.

---

## File Structure

**Create:**
- `docs/adr/0013-tauri-desktop-shell.md` — ADR for the native shell (supersedes ADR-0011 approach B).
- `scripts/build-sidecar.mjs` — build the SEA engine binary into `src-tauri/binaries/roost-server-<triple>` (dual-arch).

**Modify:**
- `docs/adr/0011-desktop-app-packaging.md` — status → Superseded by ADR-0013.
- `packages/web/src-tauri/src/main.rs` — release sidecar via shell plugin / dev node fallback / port 4317 / kill engine on exit.
- `packages/cli/src/index.ts` — remove `roost gui` command + the `.app` auto-detect block + the `runGui`/`isInsideAppBundle` import.
- `packages/cli/src/server.ts` — remove `/api/quit` route + `appMode`/`onQuit` from `ServerDeps` and `/api/health`.
- `packages/cli/src/server.test.ts` — remove the `quit + appMode` tests.
- `packages/web/src/api.ts` — remove `quitApp` + `appMode` from `HealthResponse`.
- `packages/web/src/views/Settings.tsx` — remove the "Quit Roost" panel + `appMode` state.
- `packages/web/src/Settings.test.tsx` — remove the Quit-button tests.
- `packages/web/src/i18n/strings.ts` — remove `settings.quit.*` keys.
- `package.json` (root) — replace `build:app`/`smoke:app` with `tauri`/`build:desktop`/`build:sidecar`.
- `README.md` — replace the SEA download section with the native .dmg instructions.

**Delete:**
- `packages/cli/src/gui.ts`, `packages/cli/src/gui.test.ts`
- `scripts/build-app.mjs`, `scripts/smoke-app.mjs`
- `.claude/launch.json` (browser preview for the retired .app — only if it references the SEA app; confirm first)

---

## Task 1: ADR-0013 + supersede ADR-0011

**Files:**
- Create: `docs/adr/0013-tauri-desktop-shell.md`
- Modify: `docs/adr/0011-desktop-app-packaging.md`

- [ ] **Step 1: Write ADR-0013** (mirror the house style of `docs/adr/0012-skills-module.md`):

```markdown
# ADR-0013: Tauri native desktop shell (SEA engine as sidecar)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Supersedes: ADR-0011 approach B (SEA + system browser)

## Context
ADR-0011 packaged Roost as a Node SEA binary that opened the dashboard in the
user's browser (LSUIElement, no window). In practice this reads as a "web app",
not a desktop app (double-click shows no window). The repo was already scaffolded
for Tauri (packages/web/src-tauri). Users want a real native window.

## Decision
Ship a Tauri v2 native window that loads the existing React UI (packages/web/dist).
The engine is the SAME self-contained SEA binary from ADR-0011, repurposed as a
Tauri sidecar (`binaries/roost-server-<triple>`) running `serve --port 4317`.

- Tauri is a UI shell only: core/cli logic and the React UI are unchanged
  (I1/I3). No new domain logic. macOS-only (I9).
- Release spawns the sidecar via tauri-plugin-shell and terminates it on app
  exit (no orphan). Dev falls back to system `node … serve`.
- `tauri build` produces Roost.app + Roost.dmg, arm64 + x64, unsigned (ad-hoc);
  signing/notarization may be added later without structural change.
- The SEA+browser entry points (`roost gui`, build-app.mjs, smoke-app.mjs,
  /api/quit, appMode) are retired.

## Consequences
- New UI shell layer (Rust/Tauri) to maintain; Rust toolchain required to build.
- The SEA binary is reused (not wasted) as the sidecar engine.
- No change to invariants I1–I9, module contracts, or selection schema.
```

- [ ] **Step 2: Mark ADR-0011 superseded.** In `docs/adr/0011-desktop-app-packaging.md`, change the Status line to:
```markdown
- **Status**: Superseded by ADR-0013 · 2026-06-08 (was ACCEPTED)
```
Add one line under the heading: `> Superseded by ADR-0013 — the SEA binary is now the Tauri sidecar engine, not a browser launcher.` Leave the rest as historical record.

- [ ] **Step 3: Commit**
```bash
git add docs/adr/0013-tauri-desktop-shell.md docs/adr/0011-desktop-app-packaging.md
git commit -m "docs(adr): ADR-0013 Tauri desktop shell; supersede ADR-0011 approach B"
```

---

## Task 2: Retire approach B — CLI launch + build scripts

**Files:**
- Delete: `packages/cli/src/gui.ts`, `packages/cli/src/gui.test.ts`, `scripts/build-app.mjs`, `scripts/smoke-app.mjs`
- Modify: `packages/cli/src/index.ts`, `package.json` (root)

- [ ] **Step 1: Remove the `roost gui` wiring from `packages/cli/src/index.ts`.**
  - Delete the import line: `import { runGui, isInsideAppBundle } from "./gui.js";`
  - Delete the entire `program.command("gui")…` block.
  - Replace the bottom auto-detect block:
    ```ts
    if (process.argv.length <= 2 && isInsideAppBundle(process.execPath)) {
      const { repoDir } = buildCtx();
      runGui({ repoDir }).catch(() => process.exit(1));
    } else {
      program.parseAsync();
    }
    ```
    back to a plain:
    ```ts
    program.parseAsync();
    ```

- [ ] **Step 2: Delete the files**
```bash
git rm packages/cli/src/gui.ts packages/cli/src/gui.test.ts scripts/build-app.mjs scripts/smoke-app.mjs
```

- [ ] **Step 3: Remove npm scripts.** In root `package.json` `scripts`, delete `"build:app"` and `"smoke:app"` (they reference the deleted scripts). Leave a placeholder for the new `tauri`/`build:desktop` scripts added in Task 6 (don't add them here).

- [ ] **Step 4: Build + verify nothing references the removed symbols**
```bash
cd /Users/keliang/MacMove
pnpm --filter @roost/core build && pnpm --filter @roost/cli build && pnpm --filter @roost/cli typecheck
pnpm test            # core/cli suite still green (gui.test.ts gone; no other refs)
pnpm lint
grep -rn "runGui\|isInsideAppBundle\|build-app\|smoke-app" packages/ scripts/ 2>/dev/null || echo "no dangling refs"
```
Expected: typecheck clean, suite green, no dangling refs. If anything still imports `./gui.js`, fix it.

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/index.ts package.json
git commit -m "refactor(cli): retire 'roost gui' + SEA browser-app build scripts (ADR-0013)"
```

---

## Task 3: Retire approach B — /api/quit, appMode, Settings Quit panel

**Files:**
- Modify: `packages/cli/src/server.ts`, `packages/cli/src/server.test.ts`, `packages/web/src/api.ts`, `packages/web/src/views/Settings.tsx`, `packages/web/src/Settings.test.tsx`, `packages/web/src/i18n/strings.ts`

- [ ] **Step 1: server.ts** — remove the `/api/quit` route entirely; remove `appMode` and `onQuit` from the `ServerDeps` interface and its destructuring; remove `appMode` from the `/api/health` `reply.send({...})` payload. (Search `grep -n "appMode\|onQuit\|/api/quit" packages/cli/src/server.ts` to find all sites.)

- [ ] **Step 2: server.test.ts** — delete the entire `describe("quit + appMode", …)` block. Confirm no other test references `appMode`/`onQuit` (the skills tests do not).

- [ ] **Step 3: web api.ts** — remove `quitApp` function and the `appMode?: boolean;` field from `HealthResponse`.

- [ ] **Step 4: Settings.tsx** — remove the `{appMode && (…Quit Roost…)}` panel, the `appMode` state + its assignment from the health fetch, and the `quitApp` import.

- [ ] **Step 5: Settings.test.tsx** — remove the two Quit-button tests; remove `appMode` from the mocked health object and `quitApp` from the api mock.

- [ ] **Step 6: strings.ts** — remove the `settings.quit.title/desc/button` keys (both en + zh).

- [ ] **Step 7: Verify**
```bash
cd /Users/keliang/MacMove
pnpm --filter @roost/cli build && pnpm --filter @roost/cli typecheck
pnpm --filter @roost/web typecheck
pnpm test                        # core/cli green
pnpm --filter @roost/web test    # web green
pnpm lint
grep -rn "appMode\|quitApp\|/api/quit\|settings.quit" packages/ 2>/dev/null || echo "no dangling refs"
```
Expected: both suites green, no dangling refs.

- [ ] **Step 8: Commit**
```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts packages/web/src/api.ts packages/web/src/views/Settings.tsx packages/web/src/Settings.test.tsx packages/web/src/i18n/strings.ts
git commit -m "refactor: remove /api/quit + appMode + Settings Quit panel (Tauri uses native close, ADR-0013)"
```

---

## Task 4: `build-sidecar.mjs` — SEA engine → Tauri sidecar (dual-arch)

**Files:**
- Create: `scripts/build-sidecar.mjs`

The retired `build-app.mjs` (deleted in Task 2) contained the proven SEA pipeline. This task re-creates JUST the binary-producing core, writing to the Tauri sidecar location with the required triple suffix, for both arches.

- [ ] **Step 1: Create `scripts/build-sidecar.mjs`:**
```js
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
// Tauri target triples (macOS).
const TRIPLES = {
  arm64: "aarch64-apple-darwin",
  x64: "x86_64-apple-darwin",
};
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
  // scripts/sea-config.json already exists (main: dist-app/cli.cjs, output: dist-app/sea-prep.blob).
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
  // Strip xattrs so Tauri's bundler/zip never carries AppleDouble junk.
  sh("xattr", ["-cr", bin]);
  console.log("built sidecar", bin);
}

bundleCli();
genBlob();
for (const a of ARCHES) buildSidecar(a);
console.log("done:", ARCHES.join(", "));
```

- [ ] **Step 2: Build the sidecar(s) and smoke-test the binary independently**
```bash
cd /Users/keliang/MacMove
pnpm -r build
node scripts/build-sidecar.mjs
ls -la packages/web/src-tauri/binaries/
file packages/web/src-tauri/binaries/roost-server-aarch64-apple-darwin   # Mach-O arm64
# smoke: the sidecar binary serves the API by itself
packages/web/src-tauri/binaries/roost-server-aarch64-apple-darwin serve --port 4317 &
SVPID=$!
sleep 2
echo "health: $(curl -s -m3 http://127.0.0.1:4317/api/health)"
kill $SVPID 2>/dev/null
```
Expected: both `roost-server-aarch64-apple-darwin` and `roost-server-x86_64-apple-darwin` exist (~110MB each, correct arch via `file`); the arm64 one serves `/api/health` 200. (The placeholder 107-byte file is now overwritten with a real binary.)

- [ ] **Step 3: Commit.** The real sidecar binaries are large (~110MB) — do NOT commit them. Add `packages/web/src-tauri/binaries/roost-server-*` to `.gitignore` (keep only the `.gitkeep`), so `tauri build` consumes locally-built sidecars without bloating git. Commit only the script + gitignore:
```bash
# ensure binaries aren't staged
git rm --cached packages/web/src-tauri/binaries/roost-server-aarch64-apple-darwin 2>/dev/null || true
printf 'roost-server-*\n!.gitkeep\n' >> packages/web/src-tauri/binaries/.gitignore   # create if absent
git add scripts/build-sidecar.mjs packages/web/src-tauri/binaries/.gitignore
git commit -m "build: build-sidecar.mjs — SEA engine as Tauri sidecar (dual-arch)"
```
(If `binaries/.gitignore` doesn't exist, create it with the two lines above. Confirm `git status` shows no large binary staged.)

---

## Task 5: `main.rs` — sidecar engine (release) + dev fallback + lifecycle

**Files:**
- Modify: `packages/web/src-tauri/src/main.rs`

This is Rust; verification is `cargo check` + the manual launch in Task 7 (no unit test). The implementer MUST make `cargo check` pass and may adjust the exact tauri v2 / tauri-plugin-shell API calls to match the installed crate versions (consult the tauri v2 shell sidecar docs). The code below is the intended behavior and a strong starting point.

- [ ] **Step 1: Rewrite `packages/web/src-tauri/src/main.rs`:**
```rust
// Prevents an extra console window from appearing on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, RunEvent};

// Holds the running engine child so we can terminate it on app exit (no orphan).
#[derive(Default)]
struct EngineState(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(EngineState::default())
        .setup(|app| {
            spawn_engine(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Roost desktop application")
        .run(|app_handle, event| {
            // Terminate the engine when the app is exiting.
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<EngineState>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

// Release: run the bundled self-contained sidecar (no Node needed by the user).
#[cfg(not(debug_assertions))]
fn spawn_engine(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_shell::ShellExt;
    let (_rx, child) = app
        .shell()
        .sidecar("roost-server")?
        .args(["serve", "--port", "4317"])
        .spawn()?;
    eprintln!("[roost-desktop] sidecar roost-server spawned on :4317");
    app.state::<EngineState>().0.lock().unwrap().replace(child);
    Ok(())
}

// Dev: spawn system `node <repo>/packages/cli/dist/index.js serve` (no sidecar built).
#[cfg(debug_assertions)]
fn spawn_engine(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use std::path::PathBuf;
    use std::process::Command;
    let entry: PathBuf = if let Ok(p) = std::env::var("ROOST_ENGINE_ENTRY") {
        PathBuf::from(p)
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("packages/cli/dist/index.js")
    };
    match Command::new("node").arg(&entry).arg("serve").arg("--port").arg("4317").spawn() {
        Ok(_) => eprintln!("[roost-desktop] dev engine: node {} serve --port 4317", entry.display()),
        Err(e) => eprintln!("[roost-desktop] WARNING engine spawn failed: {e}"),
    }
    Ok(())
}
```
Notes for the implementer:
- The dev `spawn_engine` returns `Ok` even on failure (app still opens; existing behavior).
- If the `.build(…).run(…)` two-step API or `CommandChild` path differs in the installed tauri v2 version, adjust to match — the REQUIRED outcomes are: (a) release spawns the `roost-server` sidecar with `serve --port 4317`, (b) the child is killed on `RunEvent::Exit`, (c) dev falls back to system node. `cargo check` must pass.
- Capabilities: tauri v2 requires a capability granting shell sidecar/execute permission. Check `packages/web/src-tauri/capabilities/` (or `gen/`). If a capability file is needed for `shell:allow-execute`/`shell:allow-spawn` on `roost-server`, add it per tauri v2 docs so the sidecar is permitted. Report what you added.

- [ ] **Step 2: `cargo check`**
```bash
cd /Users/keliang/MacMove/packages/web/src-tauri
cargo check 2>&1 | tail -20
```
Expected: compiles (warnings OK, no errors). Fix API mismatches until clean.

- [ ] **Step 3: Commit**
```bash
cd /Users/keliang/MacMove
git add packages/web/src-tauri/src/main.rs packages/web/src-tauri/capabilities 2>/dev/null
git commit -m "feat(desktop): main.rs spawns SEA sidecar (release) / node (dev), kills engine on exit"
```

---

## Task 6: `tauri build` wiring + dual-arch + docs

**Files:**
- Modify: `package.json` (root), `README.md`

- [ ] **Step 1: Add root npm scripts.** In root `package.json` `scripts`, add:
```json
"tauri": "pnpm --filter @roost/web exec tauri",
"build:sidecar": "pnpm -r build && node scripts/build-sidecar.mjs",
"build:desktop": "pnpm build:sidecar && pnpm --filter @roost/web exec tauri build"
```

- [ ] **Step 2: Build the desktop app (arm64 first)** — sidecar must exist before `tauri build`:
```bash
cd /Users/keliang/MacMove
ROOST_ARCHES=arm64 pnpm build:sidecar
pnpm --filter @roost/web exec tauri build 2>&1 | tail -25
```
Expected: produces `packages/web/src-tauri/target/release/bundle/macos/Roost.app` and `…/dmg/Roost_0.1.0_aarch64.dmg` (paths per tauri v2). Note the exact output paths it prints.

- [ ] **Step 3: Dual-arch (x64 via rustup target).**
```bash
rustup target add x86_64-apple-darwin
ROOST_ARCHES=arm64,x64 pnpm build:sidecar
pnpm --filter @roost/web exec tauri build --target aarch64-apple-darwin 2>&1 | tail -8
pnpm --filter @roost/web exec tauri build --target x86_64-apple-darwin 2>&1 | tail -8
```
Expected: a `.dmg` + `.app` for each target under `target/<triple>/release/bundle/`. If the x64 cross-build fails for a reason outside this plan's scope (e.g. a native dep), report it and proceed with arm64 as the primary deliverable (note the gap).

- [ ] **Step 4: README.** Replace the "Download the macOS app" section with native instructions:
```markdown
## Download the macOS app

Download `Roost_<version>_<arch>.dmg` from [Releases](../../releases), open it,
and drag **Roost** into Applications.

**First launch** (not yet Apple-signed): right-click `Roost.app` → **Open** →
**Open**, or run `xattr -dr com.apple.quarantine /Applications/Roost.app`.

Roost opens in a native window. Quit it normally (⌘Q / close the window).

**Build it yourself:** `pnpm build:desktop` (builds the engine sidecar, then the
Tauri app). Requires the Rust toolchain.
```

- [ ] **Step 5: Verify scripts + suites**
```bash
cd /Users/keliang/MacMove
pnpm test && pnpm --filter @roost/web test && pnpm lint
```
Expected: all green (no logic changed since Task 3).

- [ ] **Step 6: Commit**
```bash
git add package.json README.md
git commit -m "build: wire pnpm build:desktop (Tauri) + document native .dmg"
```

---

## Task 7: Real-machine smoke (manual verification — the "must actually work" gate)

**Files:** none (verification only)

- [ ] **Step 1: Install + launch the built arm64 app**
```bash
APP="packages/web/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Roost.app"
# (or target/release/bundle/macos/Roost.app if you built without --target)
rm -rf /Applications/Roost.app
cp -R "$APP" /Applications/
xattr -dr com.apple.quarantine /Applications/Roost.app
open /Applications/Roost.app
```

- [ ] **Step 2: Verify the native window + engine.** Confirm:
  - A **native Roost window** appears (not a browser tab) showing the dashboard.
  - The sidecar is running: `pgrep -fl roost-server` shows a process; `curl -s http://127.0.0.1:4317/api/health` returns 200 JSON.
  - Navigate the UI (Skills/Dotfiles pages render, data loads from the API).

- [ ] **Step 3: Verify no orphan on quit.** Quit the app (⌘Q or close window), then:
```bash
sleep 2
pgrep -fl roost-server && echo "ORPHAN — engine not killed (BUG)" || echo "engine terminated OK"
```
Expected: `engine terminated OK`. If an orphan remains, the `RunEvent::Exit` kill in main.rs (Task 5) needs fixing — return to Task 5.

- [ ] **Step 4: Report** the results (window OK? api OK? orphan-free?) with the exact bundle paths produced. No commit (verification only). If all pass, the feature is done.

---

## Self-Review Notes

- **Spec coverage:** §1/§3 Tauri shell + reused UI → Tasks 5–6; §4 sidecar wiring → Task 4; §5 main.rs lifecycle → Task 5; §6 build/dist dual-arch + unsigned + dmg → Task 6; §7 retirement → Tasks 2–3; §8 ADR-0013 + supersede 0011 → Task 1; §9 testing (cargo check, tauri build, real-machine smoke, suites green) → Tasks 4–7. All covered.
- **No-logic-regression:** Tasks 2–3 only DELETE retired surface; Tasks 4–6 add build/shell. core/cli/web business logic and the skills feature are untouched — suites must stay green at every commit (verified in each task's Step).
- **Symbol consistency:** sidecar name `roost-server` is consistent across `tauri.conf.json` (externalBin), `build-sidecar.mjs` (output filename `roost-server-<triple>`), and `main.rs` (`.sidecar("roost-server")`). Port `4317` consistent across `main.rs`, `tauri.conf.json` CSP, and `api.ts`. Triples `aarch64-apple-darwin`/`x86_64-apple-darwin` consistent between build-sidecar.mjs and the tauri `--target` flags.
- **Rust risk flagged:** Task 5 explicitly tells the implementer the tauri v2 API (`.build().run()`, `CommandChild`, capability for shell sidecar) may need version-specific adjustment, with `cargo check` as the gate and the required outcomes spelled out — not left as a placeholder.
- **Binary size:** Task 4 Step 3 gitignores the ~110MB sidecars (not committed); `dist-app/` already gitignored.
```
