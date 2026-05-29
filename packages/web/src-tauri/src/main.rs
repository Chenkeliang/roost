// Prevents an extra console window from appearing on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// These imports are used in the sidecar-spawn block below.
// Uncomment them when the TODO is resolved.
// use tauri::Manager;
// use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        // The shell plugin gives us sidecar + open capabilities.
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // ── Sidecar: roost-server ──────────────────────────────────────────
            //
            // The `roost-server` sidecar is the Node CLI (`@roost/cli`) compiled
            // to a self-contained binary (see docs/desktop.md § Sidecar).
            // It must exist at `src-tauri/binaries/roost-server-<target-triple>`
            // before `tauri build` is invoked.
            //
            // At runtime Tauri extracts it to a temp dir and provides the path
            // via the shell plugin's sidecar API.
            //
            // TODO(sidecar): uncomment once the binary is present in binaries/:
            //
            //   let sidecar_cmd = app.shell().sidecar("roost-server")
            //       .expect("roost-server sidecar not found — run `make sidecar`");
            //   let (_rx, _child) = sidecar_cmd.spawn()
            //       .expect("failed to spawn roost-server sidecar");
            //
            // In the meantime the app can run against a manually started
            // `roost serve` on 127.0.0.1:4317 (browser-mode fallback).

            let _ = app; // suppress unused warning until the TODO is resolved
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Roost desktop application");
}
