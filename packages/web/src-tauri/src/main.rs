// Prevents an extra console window from appearing on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::Command;

fn main() {
    tauri::Builder::default()
        // The shell plugin gives us sidecar + open capabilities.
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // ── Engine: spawn the Node CLI (`roost serve`) ────────────────────
            //
            // For local dev (no code-signing), we spawn the system Node process
            // directly instead of using a compiled sidecar binary.
            //
            // Path resolution order:
            //   1. ROOST_ENGINE_ENTRY env var (absolute path to cli entry point)
            //   2. Default: <repo-root>/packages/cli/dist/index.js
            //      where <repo-root> is assumed to be three levels above the
            //      Cargo workspace (src-tauri/ → web/ → packages/ → repo root).
            //
            // If spawn fails the app still opens; the user can run `roost serve`
            // manually and the UI will reach the API at http://127.0.0.1:4317.

            let entry: PathBuf = if let Ok(env_path) = std::env::var("ROOST_ENGINE_ENTRY") {
                PathBuf::from(env_path)
            } else {
                // Resolve relative to the Cargo manifest directory baked in at
                // compile time so it works regardless of cwd at launch.
                let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                // src-tauri/ → web/ → packages/ → repo-root
                manifest_dir
                    .join("../../..") // repo root
                    .join("packages/cli/dist/index.js")
            };

            match Command::new("node")
                .arg(&entry)
                .arg("serve")
                .spawn()
            {
                Ok(_child) => {
                    eprintln!("[roost-desktop] engine spawned: node {}", entry.display());
                    // _child is intentionally not stored; the OS will reap it
                    // when the Tauri process exits (macOS behaviour).
                }
                Err(e) => {
                    eprintln!(
                        "[roost-desktop] WARNING: could not spawn engine at {}: {}. \
                         Start `roost serve` manually if the API is needed.",
                        entry.display(),
                        e
                    );
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Roost desktop application");
}
