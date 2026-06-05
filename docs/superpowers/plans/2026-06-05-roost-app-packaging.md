# Roost.app Desktop Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing `@roost/cli` (fastify server + embedded React dashboard) into a double-clickable, self-contained macOS `.app` distributed as a GitHub Release asset (arm64 + x64), with no Node install required by the user.

**Architecture:** Pure outer-shell packaging — `core`/`adapters`/`modules` are untouched. A Node SEA (Single Executable Application) binary embeds Node 24 + the bundled cli; the web build rides alongside in `Resources/web/` and is served by the existing fastify static handler. A new `roost gui` mode (also auto-entered when the binary runs with no args from inside a `.app`) picks a free port, starts the server, opens the default browser, and logs to `~/Library/Logs/Roost/`. A `/api/quit` endpoint + a Settings-page button cleanly exit the GUI-launched process.

**Tech Stack:** Node 24 SEA, esbuild (CJS bundling), postject, codesign (ad-hoc), fastify 5, `@fastify/static` 9, React/Vite (existing web), vitest.

**Phase 0 (feasibility spike): already completed and PASSED** on both arm64 and x64 (Rosetta) on 2026-06-05 / Node 24.8.0. esbuild inlines fastify into a single 1.5MB CJS (0 errors); SEA blob injects + ad-hoc resigns; the binary serves `/ping` 200 and a static file 200. This plan implements the real thing.

---

## File Structure

**Create:**
- `docs/adr/0011-desktop-app-packaging.md` — ADR governing this scope addition.
- `packages/cli/src/gui.ts` — `runGui()` + free-port/web-dir/app-mode helpers (the GUI launch path, kept out of `index.ts` and `server.ts` so it has one clear responsibility).
- `packages/cli/src/gui.test.ts` — unit tests for the pure helpers in `gui.ts`.
- `scripts/build-app.mjs` — dual-arch build pipeline (esbuild → SEA blob → per-arch node base → postject → ad-hoc sign → assemble `.app` → zip).
- `scripts/sea-config.json` — SEA config consumed by `node --experimental-sea-config`.
- `scripts/Info.plist.template` — Info.plist with `__VERSION__` placeholder.
- `scripts/smoke-app.mjs` — packaging smoke test: launch built `.app`, poll until 200, assert dashboard HTML, hit `/api/quit`, assert exit.

**Modify:**
- `packages/cli/src/server.ts` — add optional `onQuit` to `ServerDeps`; add `POST /api/quit`; add `appMode` to `/api/health` payload.
- `packages/cli/src/server.test.ts` — tests for `/api/quit` + `appMode` in health.
- `packages/cli/src/index.ts` — register `roost gui` command; add app-mode auto-detect before `program.parseAsync()`.
- `packages/web/src/api.ts` — `quitApp()` + extend `Health` type with `appMode`.
- `packages/web/src/views/Settings.tsx` — "退出 Roost / Quit Roost" panel shown only when `appMode`.
- `packages/web/src/i18n/strings.ts` — `settings.quit.*` keys (en + zh-cn).
- `package.json` (root) — `build:app` script.
- `README.md` — "Download the app" + first-open (right-click / xattr) instructions.

---

## Task 1: ADR-0011 (governance gate)

**Files:**
- Create: `docs/adr/0011-desktop-app-packaging.md`

- [ ] **Step 1: Read the ADR template and an existing ADR for format**

Run: `sed -n '1,80p' docs/adr/0010-*.md` (mirror its heading structure exactly).

- [ ] **Step 2: Write the ADR**

Create `docs/adr/0011-desktop-app-packaging.md`:

```markdown
# ADR-0011: Desktop .app packaging & distribution

- Status: ACCEPTED
- Date: 2026-06-05
- Spec: docs/superpowers/specs/2026-06-05-roost-app-packaging-design.md

## Context
Roost ships as a Node CLI + web dashboard. Non-technical users want a
double-clickable macOS app and cannot be assumed to have Node installed.

## Decision
Package the existing cli+web into a self-contained Node SEA `.app`, distributed
unsigned (ad-hoc) as a GitHub Release asset for arm64 and x64.

- This is PACKAGING ONLY. It does NOT introduce a native UI shell (Tauri/Electron),
  does NOT change the layered architecture (I1/I3), module contracts, or the
  selection.yaml schema, and remains macOS-only (I9).
- The only new code is a `roost gui` launch mode and a `/api/quit` endpoint, both
  in the UI layer (cli/web).
- Distribution is unsigned initially; users right-click→Open or run
  `xattr -dr com.apple.quarantine`. Apple signing/notarization may be added later
  without changing the bundle structure.

## Consequences
- New build artifact + GitHub Release distribution channel to maintain.
- No change to invariants I1–I9 or any module.
- Bundle size ~120MB/arch (embedded Node).
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0011-desktop-app-packaging.md
git commit -m "docs(adr): ADR-0011 desktop .app packaging & distribution"
```

---

## Task 2: Server — `/api/quit` + `appMode` in health

**Files:**
- Modify: `packages/cli/src/server.ts:41-46` (ServerDeps), `:58-64` (health route), and add the quit route near other POST routes.
- Test: `packages/cli/src/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/cli/src/server.test.ts` (use the existing `buildServer` + `server.inject` pattern already in that file; if no `inject` example exists, fastify's `server.inject` is available without listening):

```ts
describe("quit + appMode", () => {
  it("POST /api/quit calls onQuit and returns ok", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-quit-"));
    let quit = false;
    const server = buildServer({
      repoDir: tmp,
      registry: defaultRegistry(),
      makeCtx: (dry) => makeCtx(tmp, dry),
      onQuit: () => { quit = true; },
    });
    const res = await server.inject({ method: "POST", url: "/api/quit" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(quit).toBe(true);
    await server.close();
  });

  it("GET /api/health reports appMode=false by default", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-health-"));
    const server = buildServer({
      repoDir: tmp,
      registry: defaultRegistry(),
      makeCtx: (dry) => makeCtx(tmp, dry),
    });
    const res = await server.inject({ method: "GET", url: "/api/health" });
    expect(JSON.parse(res.body).appMode).toBe(false);
    await server.close();
  });

  it("GET /api/health reports appMode=true when set", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-health2-"));
    const server = buildServer({
      repoDir: tmp,
      registry: defaultRegistry(),
      makeCtx: (dry) => makeCtx(tmp, dry),
      appMode: true,
    });
    const res = await server.inject({ method: "GET", url: "/api/health" });
    expect(JSON.parse(res.body).appMode).toBe(true);
    await server.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @roost/cli test -- server.test`
Expected: FAIL (onQuit/appMode not in ServerDeps; `/api/quit` 404).

- [ ] **Step 3: Implement**

In `packages/cli/src/server.ts`, extend `ServerDeps` (around line 41):

```ts
export interface ServerDeps {
  repoDir: string;
  registry: ModuleRegistry;
  makeCtx: (dryRun: boolean) => ModuleContext;
  webDir?: string;
  appMode?: boolean;
  onQuit?: () => void;
}
```

Destructure them (line ~49):

```ts
  const { repoDir, registry, makeCtx, webDir, appMode = false, onQuit } = deps;
```

Add `appMode` to the health payload (line ~64):

```ts
    return reply.send({ ok: true, name: os.hostname(), repoDir, ageKey, appMode });
```

Add the quit route (place it next to the other `server.post(...)` routes, e.g. after `/api/git/pull`):

```ts
  // ── /api/quit ────────────────────────────────────────────────────────────────
  // GUI-launched process has no terminal/Dock quit; the dashboard calls this to exit.
  server.post("/api/quit", async (_req, reply) => {
    reply.send({ ok: true });
    if (onQuit) setTimeout(onQuit, 50); // let the response flush first
    return reply;
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @roost/cli test -- server.test`
Expected: PASS (all three new tests + existing ones).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/server.test.ts
git commit -m "feat(cli): add /api/quit + appMode flag to server"
```

---

## Task 3: `gui.ts` — pure helpers (TDD)

**Files:**
- Create: `packages/cli/src/gui.ts`
- Test: `packages/cli/src/gui.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/gui.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { resolveWebDir, isInsideAppBundle } from "./gui.js";

describe("gui helpers", () => {
  it("resolveWebDir points to ../Resources/web relative to the executable", () => {
    const exec = "/Applications/Roost.app/Contents/MacOS/Roost";
    expect(resolveWebDir(exec)).toBe(
      "/Applications/Roost.app/Contents/Resources/web",
    );
  });

  it("isInsideAppBundle is true for a MacOS dir inside a .app", () => {
    expect(isInsideAppBundle("/Applications/Roost.app/Contents/MacOS/Roost")).toBe(true);
  });

  it("isInsideAppBundle is false for a normal node path", () => {
    expect(isInsideAppBundle("/usr/local/bin/node")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @roost/cli test -- gui.test`
Expected: FAIL (`./gui.js` does not exist).

- [ ] **Step 3: Implement `gui.ts`**

Create `packages/cli/src/gui.ts`:

```ts
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
 * `repoDir` defaults to the same resolution serve uses (caller passes it in).
 */
export async function runGui(opts: { repoDir: string; webDir?: string }): Promise<void> {
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
    server.close().finally(() => process.exit(0));
  };

  server = buildServer({
    repoDir: opts.repoDir,
    registry,
    makeCtx,
    webDir,
    appMode: true,
    onQuit: quit,
  });

  // port 0 → kernel assigns a free port (no hard-coded 4317 clash).
  await server.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;
  write(`listening ${url} webDir=${webDir}`);

  spawn("open", [url], { stdio: "ignore", detached: true }).unref();

  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @roost/cli test -- gui.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/gui.ts packages/cli/src/gui.test.ts
git commit -m "feat(cli): add gui launch mode helpers + runGui"
```

---

## Task 4: Wire `roost gui` command + app-mode auto-detect

**Files:**
- Modify: `packages/cli/src/index.ts` (import runGui near other imports; add command after the `serve` command at line ~365; add auto-detect before `program.parseAsync()` at line ~380).

- [ ] **Step 1: Add the import**

Near the other `./server.js` import (line ~28):

```ts
import { runServe } from "./server.js";
import { runGui, isInsideAppBundle } from "./gui.js";
```

- [ ] **Step 2: Add the `gui` command**

After the `serve` command block (around line 377, before `program.parseAsync()`):

```ts
program
  .command("gui")
  .description("Launch the dashboard in your browser (used by Roost.app)")
  .option("--repo <dir>", "Path to the config repo directory")
  .option("--web <dir>", "Path to the web build directory")
  .action(async (opts: { repo?: string; web?: string }) => {
    const { repoDir } = buildCtx();
    await runGui({ repoDir: opts.repo ?? repoDir, webDir: opts.web });
  });
```

- [ ] **Step 3: Add auto-detect**

Replace the final `program.parseAsync();` (line ~380) with:

```ts
// Double-clicking the .app launches the binary with no extra args and no terminal.
// Detect that case and enter GUI mode instead of printing help.
if (process.argv.length <= 2 && isInsideAppBundle(process.execPath)) {
  const { repoDir } = buildCtx();
  runGui({ repoDir });
} else {
  program.parseAsync();
}
```

(Confirm `buildCtx` is in scope at the bottom of `index.ts`; if it is defined later or scoped, hoist the detect block below its definition. Check with `grep -n "buildCtx" packages/cli/src/index.ts`.)

- [ ] **Step 4: Build + manual smoke (dev mode, not packaged yet)**

Run:
```bash
pnpm --filter @roost/core build && pnpm --filter @roost/cli build && pnpm --filter @roost/web build
node packages/cli/dist/index.js gui --web packages/web/dist &
sleep 2
# read the log to find the assigned port
tail -1 ~/Library/Logs/Roost/roost.log
```
Expected: log line `[listening http://127.0.0.1:<port> ...]` and the browser opens.
Then quit: `curl -s -X POST http://127.0.0.1:<port>/api/quit` → `{"ok":true}` and the node process exits.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add 'roost gui' command + .app auto-launch detection"
```

---

## Task 5: Web — Quit button in Settings (only in app mode)

**Files:**
- Modify: `packages/web/src/api.ts` (add `appMode` to `Health`, add `quitApp()`).
- Modify: `packages/web/src/views/Settings.tsx` (Quit panel gated on `appMode`).
- Modify: `packages/web/src/i18n/strings.ts` (`settings.quit.*`, en + zh-cn).
- Test: `packages/web/src/views/Settings.test.tsx` (update existing api mock).

- [ ] **Step 1: Find the existing Health type + Settings test mock**

Run:
```bash
grep -n "interface Health\|getHealth\|appMode" packages/web/src/api.ts
grep -n "vi.mock(\"../api\"\|vi.mock(\"./api\"\|getHealth" packages/web/src/views/Settings.test.tsx
```

- [ ] **Step 2: Write/extend the failing test**

In `packages/web/src/views/Settings.test.tsx`, add a case asserting the Quit button shows only when `appMode` is true. Use the file's existing render + mock pattern (mirror how it already mocks `getKey`/`getHealth`):

```tsx
it("shows Quit Roost only in app mode", async () => {
  // arrange mock: getHealth resolves { appMode: true, ... }
  // (set in the test's vi.mock factory or mockResolvedValue)
  render(<Settings />);
  expect(await screen.findByRole("button", { name: /quit roost/i })).toBeInTheDocument();
});
```

(Match the exact mock mechanism already in this test file — if it uses `vi.mocked(getHealth).mockResolvedValue(...)`, set `appMode: true` there; add a sibling test with `appMode: false` asserting the button is absent via `queryByRole`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @roost/web test -- Settings`
Expected: FAIL (no Quit button / `quitApp` undefined).

- [ ] **Step 4: Implement api.ts**

In `packages/web/src/api.ts`, extend the `Health` interface (find it via Step 1) to include `appMode: boolean;`, and append:

```ts
export function quitApp(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/quit", { method: "POST" });
}
```

- [ ] **Step 5: Implement strings**

In `packages/web/src/i18n/strings.ts`, add under both `en` and `zh-cn` (match existing nesting style):

```ts
// en
"settings.quit.title": "Quit Roost",
"settings.quit.desc": "Stop the local Roost app and its server.",
"settings.quit.button": "Quit Roost",
// zh-cn
"settings.quit.title": "退出 Roost",
"settings.quit.desc": "停止本地 Roost 应用及其服务。",
"settings.quit.button": "退出 Roost",
```

(If `strings.ts` uses nested objects rather than dotted keys, follow that shape instead.)

- [ ] **Step 6: Implement Settings.tsx panel**

In `packages/web/src/views/Settings.tsx`, read `appMode` from the health fetch already used there (or add a `getHealth()` call if absent), and render at the bottom:

```tsx
{health?.appMode && (
  <section className="panel">
    <h2>{t("settings.quit.title")}</h2>
    <p>{t("settings.quit.desc")}</p>
    <button
      onClick={async () => { await quitApp(); }}
      aria-label="Quit Roost"
    >
      {t("settings.quit.button")}
    </button>
  </section>
)}
```

(Import `quitApp` and reuse the page's existing className/panel conventions and `t()` helper.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @roost/web test -- Settings`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/views/Settings.tsx packages/web/src/views/Settings.test.tsx packages/web/src/i18n/strings.ts
git commit -m "feat(web): add Quit Roost button in Settings (app mode only)"
```

---

## Task 6: SEA config + esbuild bundle step

**Files:**
- Create: `scripts/sea-config.json`

- [ ] **Step 1: Write sea-config.json**

Create `scripts/sea-config.json`:

```json
{
  "main": "dist-app/cli.cjs",
  "output": "dist-app/sea-prep.blob",
  "disableExperimentalSEAWarning": true
}
```

- [ ] **Step 2: Verify the esbuild bundle of the real cli works**

Run (from repo root, after `pnpm -r build`):
```bash
mkdir -p dist-app
node_modules/.bin/esbuild packages/cli/src/index.ts \
  --bundle --platform=node --target=node24 --format=cjs \
  --outfile=dist-app/cli.cjs --banner:js='' 2>&1 | tail -5
node -e "require('node:fs').accessSync('dist-app/cli.cjs'); console.log('bundle ok', require('node:fs').statSync('dist-app/cli.cjs').size)"
```
Expected: esbuild completes (warnings about dynamic require are acceptable); file exists. If esbuild errors on the `#!/usr/bin/env node` shebang, add `--legal-comments=none` and confirm esbuild strips the shebang (it does for `--format=cjs`); if a dependency fails to bundle, capture the exact module name — that is the signal to switch to fallback B' (documented in spec §6).

- [ ] **Step 3: Verify the bundled cli runs under plain node**

Run:
```bash
node dist-app/cli.cjs gui --web packages/web/dist &
sleep 2
tail -1 ~/Library/Logs/Roost/roost.log
PORT_LINE=$(tail -1 ~/Library/Logs/Roost/roost.log)
# extract port, curl health, then quit
```
Expected: server starts from the bundle; `/api/health` returns `appMode:true`. Quit via `/api/quit`.

- [ ] **Step 4: Commit**

```bash
git add scripts/sea-config.json
git commit -m "build: add SEA config for cli single-file bundle"
```

---

## Task 7: `build-app.mjs` — dual-arch packaging pipeline

**Files:**
- Create: `scripts/build-app.mjs`
- Create: `scripts/Info.plist.template`

- [ ] **Step 1: Write Info.plist.template**

Create `scripts/Info.plist.template`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Roost</string>
  <key>CFBundleDisplayName</key><string>Roost</string>
  <key>CFBundleIdentifier</key><string>dev.roost.app</string>
  <key>CFBundleVersion</key><string>__VERSION__</string>
  <key>CFBundleShortVersionString</key><string>__VERSION__</string>
  <key>CFBundleExecutable</key><string>Roost</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
```

- [ ] **Step 2: Write build-app.mjs**

Create `scripts/build-app.mjs`:

```js
#!/usr/bin/env node
// Build self-contained Roost.app for one or both arches. No external deps beyond
// what the repo already has (esbuild) + system node/codesign/postject(npx).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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
  // arm64: reuse the running node. x64: download the matching release.
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

  // Executable: copy node base, strip sig, inject blob, ad-hoc resign.
  const bin = path.join(macos, "Roost");
  fs.copyFileSync(nodeBaseFor(arch), bin);
  fs.chmodSync(bin, 0o755);
  sh("codesign", ["--remove-signature", bin]);
  sh("npx", ["--yes", "postject", bin, "NODE_SEA_BLOB",
    path.join(OUT, "sea-prep.blob"),
    "--sentinel-fuse", `NODE_SEA_FUSE_${FUSE}`,
    "--macho-segment-name", "NODE_SEA"]);
  sh("codesign", ["--sign", "-", "--force", bin]);

  // Resources: web build + Info.plist (+ icon if present).
  sh("cp", ["-R", "packages/web/dist/.", path.join(res, "web")]);
  const plist = fs.readFileSync("scripts/Info.plist.template", "utf8")
    .replaceAll("__VERSION__", VERSION);
  fs.writeFileSync(path.join(appDir, "Contents", "Info.plist"), plist);
  const icon = path.join(ROOT, "scripts", "AppIcon.icns");
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(res, "AppIcon.icns"));

  // Whole-bundle ad-hoc sign, then zip.
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
```

- [ ] **Step 3: Run the build (arm64 only first for speed)**

Run: `ROOST_ARCHES=arm64 ROOST_VERSION=0.0.0 node scripts/build-app.mjs`
Expected: ends with `built .../Roost-0.0.0-macos-arm64.zip` and `done: arm64`. No codesign/postject errors.

- [ ] **Step 4: Run the full dual-arch build**

Run: `node scripts/build-app.mjs`
Expected: builds both `Roost-0.0.0-macos-arm64.zip` and `Roost-0.0.0-macos-x64.zip`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-app.mjs scripts/Info.plist.template
git commit -m "build: dual-arch Roost.app packaging pipeline (Node SEA)"
```

---

## Task 8: Packaging smoke test (the "must actually work" gate)

**Files:**
- Create: `scripts/smoke-app.mjs`

- [ ] **Step 1: Write smoke-app.mjs**

Create `scripts/smoke-app.mjs`:

```js
#!/usr/bin/env node
// Launch a built Roost.app, prove the dashboard serves, then quit it.
// Usage: node scripts/smoke-app.mjs dist-app/arch-arm64/Roost.app [--rosetta]
import { spawn, execFileSync } from "node:child_process";
import * as path from "node:path";

const appDir = process.argv[2];
const rosetta = process.argv.includes("--rosetta");
if (!appDir) { console.error("usage: smoke-app.mjs <Roost.app> [--rosetta]"); process.exit(2); }

const bin = path.join(appDir, "Contents", "MacOS", "Roost");
const cmd = rosetta ? "arch" : bin;
const args = rosetta ? ["-x86_64", bin, "gui"] : ["gui"];

// strip quarantine so a freshly-built bundle launches without prompt
try { execFileSync("xattr", ["-dr", "com.apple.quarantine", appDir]); } catch {}

const child = spawn(cmd, args, { stdio: "ignore", detached: false });

async function findPort(timeoutMs) {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const log = path.join(os.homedir(), "Library", "Logs", "Roost", "roost.log");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const lines = fs.readFileSync(log, "utf8").trim().split("\n");
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
  await new Promise((r) => setTimeout(r, 1000));
  if (child.exitCode === null && !child.killed) child.kill();
  console.log("SMOKE OK", appDir, rosetta ? "(rosetta)" : "");
  process.exit(0);
} catch (e) {
  child.kill();
  console.error("SMOKE FAIL:", e.message);
  process.exit(1);
}
```

- [ ] **Step 2: Run smoke on the arm64 bundle**

Run: `node scripts/smoke-app.mjs dist-app/arch-arm64/Roost.app`
Expected: `SMOKE OK dist-app/arch-arm64/Roost.app`.

- [ ] **Step 3: Run smoke on the x64 bundle under Rosetta**

Run: `node scripts/smoke-app.mjs dist-app/arch-x64/Roost.app --rosetta`
Expected: `SMOKE OK ... (rosetta)`. (Requires Rosetta installed: `pgrep oahd`. If absent, skip and note it.)

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-app.mjs
git commit -m "test: add packaged Roost.app smoke test (dual-arch)"
```

---

## Task 9: Wire `pnpm build:app` + docs

**Files:**
- Modify: `package.json` (root)
- Modify: `README.md`

- [ ] **Step 1: Add the npm script**

In root `package.json` `scripts`, add:

```json
"build:app": "pnpm -r build && node scripts/build-app.mjs",
"smoke:app": "node scripts/smoke-app.mjs dist-app/arch-arm64/Roost.app"
```

- [ ] **Step 2: Add README section**

Append to `README.md` a "Download the macOS app" section:

```markdown
## Download the macOS app

Grab `Roost-<version>-macos-<arch>.zip` from [Releases](../../releases),
unzip, and move `Roost.app` to `/Applications`.

**First launch** (the app is not yet Apple-signed): right-click `Roost.app`
→ **Open** → click **Open** in the dialog. Or run once:

\`\`\`bash
xattr -dr com.apple.quarantine /Applications/Roost.app
\`\`\`

Roost opens the dashboard in your default browser. Quit it from the dashboard's
**Settings → Quit Roost**.

**Build it yourself:** `pnpm build:app` (produces arm64 + x64 zips in `dist-app/`).
```

- [ ] **Step 3: Verify the wired script end-to-end**

Run: `pnpm build:app && pnpm smoke:app`
Expected: builds both zips, then `SMOKE OK`.

- [ ] **Step 4: Add dist-app to .gitignore**

Append `dist-app/` to `.gitignore` (build output, not committed).

- [ ] **Step 5: Commit**

```bash
git add package.json README.md .gitignore
git commit -m "build: wire pnpm build:app + document macOS app download"
```

---

## Self-Review Notes

- **Spec coverage:** §3 bundle layout → Task 7; §4 launch/quit → Tasks 2–4; §5 pipeline → Tasks 6–7; §6 risk/fallback → Task 6 Step 2 (fallback trigger documented); §7 distribution/signing → Tasks 7 & 9; §8 testing → Tasks 2,3,5,8; §9 ADR → Task 1. All covered.
- **Icon:** intentionally optional/deferred — `build-app.mjs` copies `scripts/AppIcon.icns` only `if (fs.existsSync(...))`; bundle works with the generic icon until a real `.icns` is added (a follow-up, not a blocker).
- **Symbol consistency:** `runGui`/`resolveWebDir`/`isInsideAppBundle` (gui.ts) and `onQuit`/`appMode` (ServerDeps) are referenced identically across Tasks 2–4. `quitApp`/`Health.appMode` consistent across Task 5.
- **CI:** out of scope per spec (Phase 3 "optional"); `build:app` is runnable locally. A GitHub Actions release job can be added later without changing these scripts.
