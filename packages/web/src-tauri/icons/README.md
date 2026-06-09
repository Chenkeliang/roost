# Icon generation

Icon files are generated from the SVG source and are **not committed** to the
repository (they are binary and large).

## Generating icons

Run the following command from the repo root **after** installing the Tauri CLI:

```sh
pnpm --filter @roost/web tauri icon ../../docs/design/roost-icon.svg
```

This writes the full icon set (`32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.icns`, `icon.ico`) into this directory, exactly matching the paths
declared in `src-tauri/tauri.conf.json`.

The SVG source lives at `docs/design/roost-icon.svg`.

> **Note:** `icon.icns` is required for macOS App Store / Gatekeeper validation.
> Run the command above before every release build.
