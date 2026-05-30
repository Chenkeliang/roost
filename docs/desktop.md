# Roost Desktop — Build, Sign & Distribute

Roost ships as a **Tauri v2 macOS desktop application** (`packages/web/src-tauri`)
that wraps the existing `@roost/web` React UI inside the system WebView and
bundles the Node engine (`roost serve`) as a compiled sidecar binary.

Browser-mode fallback (no Tauri/Rust required) is documented at the bottom.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Rust toolchain | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Xcode Command Line Tools | `xcode-select --install` |
| pnpm ≥ 9 | Already required by the repo |

After installing Rust, make sure `~/.cargo/bin` is on your `PATH`:

```sh
source "$HOME/.cargo/env"
rustc --version   # expect 1.77+
```

Tauri CLI and API are already listed in `packages/web`'s devDependencies.
Install them with the rest of the workspace:

```sh
pnpm install
```

Or, if adding to a fresh clone before they appear in the lockfile:

```sh
pnpm add -D --filter @roost/web @tauri-apps/cli @tauri-apps/api
```

---

## Sidecar: shipping the Node engine

The Tauri app needs the `@roost/cli` Node engine (`roost serve`) bundled as a
**self-contained native binary** named `roost-server`. Tauri extracts it at
runtime and the app spawns it on startup; the React UI then talks to its JSON
API at `http://127.0.0.1:4317`.

### 1. Compile to a single binary

Use **Bun's compile** command (produces a fully self-contained executable, no
Node.js required on the user's machine):

```sh
# from repo root
pnpm --filter @roost/cli build        # tsc → packages/cli/dist/index.js
bun build --compile --outfile packages/web/src-tauri/binaries/roost-server \
    packages/cli/dist/index.js
```

Alternatively use **pkg** (maintained Node.js packager):

```sh
npx pkg packages/cli/dist/index.js \
    --targets node20-macos-arm64,node20-macos-x64 \
    --out-path packages/web/src-tauri/binaries/
```

### 2. Rename for the target triple

Tauri requires the sidecar binary to be named with the Rust target triple:

```sh
# detect the host triple
TARGET=$(rustc -vV | grep '^host:' | cut -d ' ' -f2)
# e.g. aarch64-apple-darwin  or  x86_64-apple-darwin

mv packages/web/src-tauri/binaries/roost-server \
   packages/web/src-tauri/binaries/roost-server-${TARGET}
```

For a universal (fat) binary covering both Intel and Apple Silicon, build with
`bun build --compile --target=bun-macos-x64` and
`--target=bun-macos-arm64`, then `lipo -create -output roost-server ...`.
Rename the result to `roost-server-universal-apple-darwin`.

### 3. Generate icons

Run once before the first build and again whenever `docs/design/roost-icon.svg`
changes:

```sh
pnpm --filter @roost/web tauri icon ../../docs/design/roost-icon.svg
```

This writes `icons/32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico` into `packages/web/src-tauri/icons/`.

---

## Run locally (no signing)

For local development you do **not** need a compiled sidecar binary or an
Apple Developer certificate.  The Tauri app auto-spawns the system Node process
to start the engine.

### Prerequisites

```sh
# Build the CLI (produces packages/cli/dist/index.js)
pnpm --filter @roost/cli build

# Build the web UI
pnpm --filter @roost/web build
```

Or build everything at once:

```sh
pnpm -r build
```

### Launch

```sh
# Start Tauri in dev mode (hot-reload via Vite at :5173)
# The app auto-spawns: node packages/cli/dist/index.js serve
pnpm --filter @roost/web tauri dev
```

Tauri resolves the engine entry point in this order:
1. `ROOST_ENGINE_ENTRY` env var (absolute path) — override for custom setups.
2. Default: `<repo-root>/packages/cli/dist/index.js` (relative to the compiled
   Rust binary's source directory, so it works from any cwd).

If spawn fails a warning is printed to stderr and the app still opens.

### Manual fallback

If you prefer to control the engine yourself (or `node` is not on the PATH
Tauri sees):

```sh
node packages/cli/dist/index.js serve   # → http://127.0.0.1:4317
pnpm --filter @roost/web tauri dev      # open Tauri window
```

Or without Tauri at all — open any browser at `http://localhost:5173` while
the Vite dev server and engine are both running:

```sh
node packages/cli/dist/index.js serve
pnpm --filter @roost/web dev
```

### About `binaries/roost-server-*`

The stub file at `src-tauri/binaries/roost-server-aarch64-apple-darwin` is a
placeholder for the **signed-release sidecar path** only.  For local dev the
`std::process::Command`-based spawn above is used instead — no compiled
sidecar binary is required.

---

## Development build

```sh
# Build the React UI once (or use beforeDevCommand in tauri.conf.json)
pnpm --filter @roost/web build

# Launch Tauri in dev mode (hot-reload via vite dev server at :5173)
pnpm --filter @roost/web tauri dev
```

---

## Release build

```sh
# 1. Build the web UI
pnpm --filter @roost/web build

# 2. Compile + place the sidecar (see § Sidecar above)

# 3. Generate icons (if not already done)
pnpm --filter @roost/web tauri icon ../../docs/design/roost-icon.svg

# 4. Build the desktop app
pnpm --filter @roost/web tauri build
```

Artifacts land in `packages/web/src-tauri/target/release/bundle/`:
- `macos/Roost.app` — the application bundle
- `dmg/Roost_<version>_aarch64.dmg` — distributable disk image

---

## Code signing & notarization (REQUIRED for distribution)

Without signing, macOS Gatekeeper will quarantine the app and users will see
"Roost cannot be opened because the developer cannot be verified."

### What you need (hard prerequisites the maintainer must provide)

1. **Apple Developer Program membership** — $99/year at
   [developer.apple.com](https://developer.apple.com).
2. **Apple Developer ID Application certificate** — created in Xcode →
   Settings → Accounts → Manage Certificates. Export as a `.p12` file with a
   passphrase.
3. **App-specific password** — generate at
   [appleid.apple.com](https://appleid.apple.com) (used for notarization via
   `notarytool`).
4. **An App Store Connect API key** (optional but recommended for CI) —
   created in App Store Connect → Users → Integrations → API Keys.

### Environment variables for `tauri build`

```sh
export APPLE_CERTIFICATE="$(base64 -i /path/to/certificate.p12)"
export APPLE_CERTIFICATE_PASSWORD="<p12-passphrase>"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="<app-specific-password>"   # or use APPLE_API_KEY / APPLE_API_ISSUER
export APPLE_TEAM_ID="<10-char-team-id>"
```

Then run the release build as usual:

```sh
pnpm --filter @roost/web tauri build
```

Tauri calls `codesign` and `xcrun notarytool` automatically when these
variables are set.  The final `.dmg` will be signed, notarized, and stapled —
ready for direct distribution outside the App Store.

### CI (GitHub Actions)

Store the environment variables as GitHub repository secrets and inject them
in your workflow:

```yaml
- name: Build and sign Roost Desktop
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: pnpm --filter @roost/web tauri build
```

---

## Browser-mode fallback (no Tauri/Rust required)

If you only need to run the UI without the desktop shell:

```sh
pnpm --filter @roost/cli build
node packages/cli/dist/index.js serve   # or: npx roost serve
# → API listening on http://127.0.0.1:4317

pnpm --filter @roost/web dev            # Vite dev server at http://localhost:5173
# open http://localhost:5173 in any browser
```

For a production-like setup without Tauri:

```sh
pnpm --filter @roost/web build
node packages/cli/dist/index.js serve --static packages/web/dist
# open http://127.0.0.1:4317
```

---

## Tauri project layout

```
packages/web/
├── dist/                  ← Vite build output (frontendDist)
├── src-tauri/
│   ├── tauri.conf.json    ← Tauri v2 configuration
│   ├── Cargo.toml         ← Rust crate (roost-desktop)
│   ├── build.rs           ← tauri-build call
│   ├── src/
│   │   └── main.rs        ← Tauri app entry point + sidecar spawn
│   ├── binaries/
│   │   └── roost-server-<triple>   ← compiled Node engine (NOT committed)
│   └── icons/             ← generated icon set (NOT committed; see icons/README.md)
└── package.json           ← includes @tauri-apps/cli, @tauri-apps/api devDeps
```

## Architecture notes

- The Tauri window loads `dist/index.html` (in release) or proxies to the
  Vite dev server at `http://localhost:5173` (in dev).
- The React UI makes API calls to `http://127.0.0.1:4317`, which the
  `roost-server` sidecar handles. The CSP in `tauri.conf.json` explicitly
  allows `connect-src http://127.0.0.1:4317`.
- The sidecar is declared in `bundle.externalBin` and spawned in `src/main.rs`
  via `tauri_plugin_shell`. See the TODO comment in `main.rs` for the exact
  call to uncomment once the binary is placed.
- `src-tauri/` is intentionally **not** a pnpm workspace package (no
  `package.json` in it) so it does not interfere with `pnpm -r build`.
