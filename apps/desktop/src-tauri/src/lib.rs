//! Tauri shell — thin by design. Its only real job is spawning and
//! supervising the Potato Core (Python/FastAPI) child process; the UI talks
//! to that process over loopback HTTP, never through Tauri IPC commands.
//!
//! Dev builds spawn `core/.venv/Scripts/python.exe -m potato_core.main`
//! directly. Release builds spawn the PyInstaller-built `potato-core.exe`
//! sidecar bundled as a Tauri resource (see core/packaging/potato-core.spec
//! and tauri.conf.json's bundle.resources) — no Python install required on
//! the end user's machine. Both paths return a plain `std::process::Child`
//! so the rest of this module (readiness polling, Job Object lifecycle,
//! shutdown) is identical either way.

use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};

#[cfg(windows)]
mod job_object;

const CORE_PORT: u16 = 47823;
const READY_POLL_ATTEMPTS: u32 = 150; // ~30s at 200ms each
const READY_POLL_INTERVAL: Duration = Duration::from_millis(200);

struct CoreProcess(Mutex<Option<Child>>);

fn core_dir() -> PathBuf {
    // apps/desktop/src-tauri -> src-tauri -> desktop -> apps -> repo root -> core.
    // Uses PathBuf::pop (real parent-component removal) rather than
    // `.join("..")`, which leaves literal ".." segments in the path —
    // CreateProcessW's current-dir/executable resolution on Windows doesn't
    // reliably resolve those.
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dir.pop(); // src-tauri -> apps/desktop
    dir.pop(); // apps/desktop -> apps
    dir.pop(); // apps -> repo root
    dir.push("core");
    dir
}

fn core_python_executable() -> PathBuf {
    let dir = core_dir();
    if cfg!(windows) {
        dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        dir.join(".venv").join("bin").join("python")
    }
}

/// Where the bundled `potato-core.exe` sidecar and its data (alembic.ini,
/// db/migrations/, vendor/llama-cpu/, tiktoken-cache/) land inside the
/// installed app — see tauri.conf.json's `bundle.resources`.
fn packaged_core_dir(app: &tauri::App) -> std::io::Result<PathBuf> {
    app.path()
        .resource_dir()
        .map(|dir| dir.join("potato-core"))
        .map_err(|err| std::io::Error::other(format!("couldn't resolve resource dir: {err}")))
}

fn spawn_core(app: &tauri::App) -> std::io::Result<Child> {
    let (program, dir) = if cfg!(debug_assertions) {
        (core_python_executable(), core_dir())
    } else {
        let dir = packaged_core_dir(app)?;
        (dir.join("potato-core.exe"), dir)
    };

    let mut cmd = Command::new(&program);
    if cfg!(debug_assertions) {
        cmd.args(["-m", "potato_core.main"]);
    }
    cmd.current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

fn stream_child_output(child: &mut Child) {
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                println!("[potato-core] {line}");
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[potato-core] {line}");
            }
        });
    }
}

/// Polls the core's port until it accepts connections, then emits
/// `potato-core-ready` so the frontend can stop treating the core as
/// possibly-not-started. A future phase can gate the splash screen on this.
fn wait_for_core_ready(app: AppHandle) {
    let addr = format!("127.0.0.1:{CORE_PORT}");
    for _ in 0..READY_POLL_ATTEMPTS {
        if TcpStream::connect(&addr).is_ok() {
            let _ = app.emit("potato-core-ready", ());
            return;
        }
        std::thread::sleep(READY_POLL_INTERVAL);
    }
    eprintln!("Potato Core did not become ready within the expected startup window");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CoreProcess(Mutex::new(None)))
        .setup(|app| {
            match spawn_core(app) {
                Ok(mut child) => {
                    stream_child_output(&mut child);

                    #[cfg(windows)]
                    if let Err(err) = job_object::assign_kill_on_close(&child) {
                        eprintln!(
                            "Warning: couldn't tie Potato Core to a kill-on-close job object ({err:?}) \
                             — it may survive a hard kill of this app"
                        );
                    }

                    let state = app.state::<CoreProcess>();
                    *state.0.lock().unwrap() = Some(child);

                    let handle = app.handle().clone();
                    std::thread::spawn(move || wait_for_core_ready(handle));
                }
                Err(err) => {
                    let looked_for = if cfg!(debug_assertions) {
                        core_python_executable()
                    } else {
                        packaged_core_dir(app)
                            .map(|dir| dir.join("potato-core.exe"))
                            .unwrap_or_default()
                    };
                    eprintln!("Failed to spawn Potato Core (looked for {looked_for:?}): {err}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            let state = app_handle.state::<CoreProcess>();
            let mut guard = state.0.lock().unwrap();
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    });
}
