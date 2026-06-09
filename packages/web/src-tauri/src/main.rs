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
        .plugin(tauri_plugin_opener::init())
        .manage(EngineState::default())
        .setup(|app| {
            spawn_engine(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Roost desktop application")
        .run(|app_handle, event| {
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
    match Command::new("node")
        .arg(&entry)
        .arg("serve")
        .arg("--port")
        .arg("4317")
        .spawn()
    {
        Ok(_) => eprintln!(
            "[roost-desktop] dev engine: node {} serve --port 4317",
            entry.display()
        ),
        Err(e) => eprintln!("[roost-desktop] WARNING engine spawn failed: {e}"),
    }
    Ok(())
}
