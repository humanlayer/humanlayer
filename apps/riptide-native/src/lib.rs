mod artifact_trace;
mod claude_diagnostics;
mod config_migration;
mod daemon;
mod filescan;
mod logging;
mod pty;
mod sentry;
mod shell_env;
mod workspace_setup;

use daemon::DaemonManager;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
fn set_devstack_dock_icon() -> Result<(), String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{MainThreadMarker, NSString};

    if !cfg!(debug_assertions) {
        return Ok(());
    }

    let icon_path = match std::env::var("DEVSTACK_NATIVE_ICON") {
        Ok(path) if !path.trim().is_empty() => path,
        _ => return Ok(()),
    };
    if !std::path::Path::new(&icon_path).is_file() {
        return Err(format!("Devstack Dock icon does not exist: {icon_path}"));
    }

    let main_thread = MainThreadMarker::new()
        .ok_or_else(|| "Devstack Dock icon must be set on the main thread".to_string())?;
    let path = NSString::from_str(&icon_path);
    let image = NSImage::initWithContentsOfFile(NSImage::alloc(), &path)
        .ok_or_else(|| format!("Failed to load devstack Dock icon: {icon_path}"))?;
    let app = NSApplication::sharedApplication(main_thread);
    unsafe { app.setApplicationIconImage(Some(&image)) };

    log::info!("Using devstack Dock icon: {}", icon_path);
    Ok(())
}

const CLI_SELF_UPDATE_TIMEOUT: Duration = Duration::from_secs(30);
static CLI_SELF_UPDATE_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowState {
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
    maximized: bool,
}

#[derive(Default)]
struct PendingDeepLink(Mutex<Option<String>>);

fn get_window_store_path(is_local: bool, is_dev: bool) -> PathBuf {
    let home = dirs::home_dir().expect("Failed to get home directory");
    let riptide_dir = home.join(".humanlayer").join("riptide");

    // Ensure directory exists
    std::fs::create_dir_all(&riptide_dir).ok();

    if let Ok(stack_id) = std::env::var("DEVSTACK_ID") {
        if !stack_id.is_empty() {
            return riptide_dir.join(format!("window-state-local-{}.json", stack_id));
        }
    }

    if is_local {
        riptide_dir.join("window-state-local.json")
    } else if is_dev {
        riptide_dir.join("window-state-dev.json")
    } else {
        riptide_dir.join("window-state.json")
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_host_id(daemon_manager: tauri::State<'_, DaemonManager>) -> Result<String, String> {
    daemon_manager.get_or_create_host_id()
}

#[tauri::command]
fn get_process_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map_err(|error| error.to_string())?
        .to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid working directory path".to_string())
}

#[tauri::command]
fn take_pending_deep_link(state: tauri::State<'_, PendingDeepLink>) -> Option<String> {
    state.0.lock().ok().and_then(|mut pending| pending.take())
}

// Sync commands run on the main thread, and a blocked main thread beach-balls
// the whole app on macOS. Anything that spawns, waits, or sleeps goes here.
async fn run_off_main_thread<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_daemon(
    app_handle: tauri::AppHandle,
    daemon_manager: tauri::State<'_, DaemonManager>,
    token: String,
    user_id: String,
    organization_id: String,
    sync_mode: String,
    verified_claude_path: Option<String>,
) -> Result<daemon::DaemonLaunchResult, String> {
    let daemon_manager = daemon_manager.inner().clone();
    run_off_main_thread(move || {
        daemon_manager.start_daemon(
            &app_handle,
            &token,
            &user_id,
            &organization_id,
            &sync_mode,
            verified_claude_path.as_deref(),
        )
    })
    .await?
}

#[tauri::command]
async fn stop_daemon(
    daemon_manager: tauri::State<'_, DaemonManager>,
    user_id: String,
    organization_id: String,
) -> Result<(), String> {
    let daemon_manager = daemon_manager.inner().clone();
    run_off_main_thread(move || daemon_manager.stop_daemon(&user_id, &organization_id)).await?
}

#[tauri::command]
async fn set_daemon_management(
    daemon_manager: tauri::State<'_, DaemonManager>,
    enabled: bool,
) -> Result<(), String> {
    let daemon_manager = daemon_manager.inner().clone();
    run_off_main_thread(move || daemon_manager.set_management_enabled(enabled)).await?
}

#[tauri::command]
async fn is_daemon_running(
    daemon_manager: tauri::State<'_, DaemonManager>,
    user_id: String,
    organization_id: String,
) -> Result<bool, String> {
    let daemon_manager = daemon_manager.inner().clone();
    run_off_main_thread(move || daemon_manager.is_daemon_running(&user_id, &organization_id)).await
}

#[tauri::command]
fn get_log_directory() -> Result<String, String> {
    let log_dir = logging::get_log_base_dir();
    log_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid log directory path".to_string())
}

#[tauri::command]
fn get_current_log_files() -> Result<Vec<String>, String> {
    let log_dir = logging::get_log_base_dir();

    if !log_dir.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    for entry in std::fs::read_dir(&log_dir).map_err(|e| e.to_string())? {
        if let Ok(entry) = entry {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".log") || name.ends_with(".jsonl") {
                    files.push(name.to_string());
                }
            }
        }
    }

    files.sort();
    files.reverse(); // Most recent first
    Ok(files)
}

#[tauri::command]
async fn get_editor_env() -> Result<Option<String>, String> {
    run_off_main_thread(|| {
        non_empty_env_value(std::env::var("EDITOR").ok()).or_else(|| {
            shell_env::get().and_then(|env| non_empty_env_value(env.get("EDITOR").cloned()))
        })
    })
    .await
}

fn non_empty_env_value(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Open a directory in the specified editor using tauri-plugin-opener
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `path` - The directory path to open
/// * `editor` - Optional editor command (cursor, code, zed). If None, uses system default.
#[tauri::command]
async fn open_in_editor(
    app: tauri::AppHandle,
    path: String,
    editor: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let path_expanded = shellexpand::tilde(&path).to_string();

    // Check if path exists before trying to open
    use std::path::Path;
    if !Path::new(&path_expanded).exists() {
        return Err(format!("Directory does not exist: {}", path_expanded));
    }

    let opener = app.opener();

    // Check if file has an image extension (excluding SVG which can be edited as text)
    let lowercase_path = path_expanded.to_lowercase();
    let is_image = lowercase_path.ends_with(".png")
        || lowercase_path.ends_with(".jpg")
        || lowercase_path.ends_with(".jpeg")
        || lowercase_path.ends_with(".gif")
        || lowercase_path.ends_with(".webp")
        || lowercase_path.ends_with(".bmp")
        || lowercase_path.ends_with(".ico")
        || lowercase_path.ends_with(".tiff")
        || lowercase_path.ends_with(".tif");

    // For image files, always use system default opener
    if is_image {
        opener
            .open_path(&path_expanded, None::<&str>)
            .map_err(|e| format!("Failed to open with system default: {}", e))?;
    } else if let Some(editor_cmd) = editor {
        // Map editor preference to platform-specific app names
        let app_name = match editor_cmd.as_str() {
            "cursor" => get_cursor_app_name(),
            "code" => get_vscode_app_name(),
            "zed" => get_zed_app_name(),
            _ => return Err(format!("Unsupported editor: {}", editor_cmd)),
        };

        // Check if the editor exists before trying to open
        // This is necessary because tauri-plugin-opener uses fire-and-forget spawning
        // and won't report errors if the application doesn't exist
        check_editor_exists(app_name)?;

        opener
            .open_path(&path_expanded, app_name)
            .map_err(|e| format!("Failed to open editor: {}", e))?;
    } else {
        // Use system default
        opener
            .open_path(&path_expanded, None::<&str>)
            .map_err(|e| format!("Failed to open with system default: {}", e))?;
    }

    Ok(())
}

/// Check if an editor application exists on the system before trying to open it
fn check_editor_exists(app_name: Option<&str>) -> Result<(), String> {
    let Some(name) = app_name else {
        // System default, always available
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    {
        // On macOS, check if the app bundle exists in common locations
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        let home_path = home.display();
        let locations = vec![
            format!("/Applications/{}.app", name),
            format!("{}/Applications/{}.app", home_path, name),
            format!("/System/Applications/{}.app", name),
        ];

        for location in locations {
            if std::path::Path::new(&location).exists() {
                return Ok(());
            }
        }

        return Err(format!(
            "{} is not installed. Please install it from https://{}",
            name,
            match name {
                "Cursor" => "cursor.sh",
                "Visual Studio Code" => "code.visualstudio.com",
                "Zed" => "zed.dev",
                _ => "the editor's website",
            }
        ));
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        // On Linux, check if the binary is in PATH using `which`
        let output = Command::new("which")
            .arg(name)
            .output()
            .map_err(|e| format!("Failed to check if {} exists: {}", name, e))?;

        if !output.status.success() {
            return Err(format!(
                "{} is not installed or not in PATH. Please install it first.",
                name
            ));
        }

        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // On Windows, use `where` command to check if app exists
        let output = Command::new("where")
            .arg(name)
            .output()
            .map_err(|e| format!("Failed to check if {} exists: {}", name, e))?;

        if !output.status.success() {
            return Err(format!(
                "{} is not installed. Please install it first.",
                name
            ));
        }

        Ok(())
    }
}

fn get_cursor_app_name() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    return Some("Cursor");
    #[cfg(target_os = "windows")]
    return Some("Cursor");
    #[cfg(target_os = "linux")]
    return Some("cursor");
}

fn get_vscode_app_name() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    return Some("Visual Studio Code");
    #[cfg(target_os = "windows")]
    return Some("Code");
    #[cfg(target_os = "linux")]
    return Some("code");
}

fn get_zed_app_name() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    return Some("Zed");
    #[cfg(target_os = "windows")]
    return Some("Zed");
    #[cfg(target_os = "linux")]
    return Some("zed");
}

#[tauri::command]
async fn save_window_state(app: tauri::AppHandle, state: WindowState) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let is_local = cfg!(debug_assertions) || app.config().identifier.contains("local");
    let is_dev = app.config().identifier.contains("dev");
    let store_path = get_window_store_path(is_local, is_dev);

    let store = app
        .store(&store_path)
        .map_err(|e| format!("Failed to access store: {e}"))?;

    let state_value = serde_json::to_value(&state)
        .map_err(|e| format!("Failed to serialize window state: {e}"))?;
    store.set("window_state", state_value);
    store
        .save()
        .map_err(|e| format!("Failed to save window state: {e}"))?;

    Ok(())
}

#[tauri::command]
fn set_window_theme(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    let tauri_theme = match theme.as_str() {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => return Err(format!("Unknown theme: {}", theme)),
    };
    window
        .set_theme(tauri_theme)
        .map_err(|e| format!("Failed to set window theme: {}", e))
}

#[tauri::command]
fn terminal_cli_self_update() -> Result<(), String> {
    queue_terminal_cli_self_update();
    Ok(())
}

fn queue_terminal_cli_self_update() {
    if cfg!(debug_assertions) {
        log::debug!("Skipping HumanLayer CLI self-update in local source build");
        return;
    }

    if CLI_SELF_UPDATE_STARTED.swap(true, Ordering::AcqRel) {
        log::debug!("HumanLayer CLI self-update already queued; skipping duplicate request");
        return;
    }

    tauri::async_runtime::spawn(async {
        run_terminal_cli_self_update().await;
    });
}

async fn run_terminal_cli_self_update() {
    let child = tokio::process::Command::new("npm")
        .args(["install", "-g", "@humanlayer/cli@latest"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    let mut child = match child {
        Ok(child) => child,
        Err(error) => {
            log::warn!("Best-effort HumanLayer CLI self-update failed: {}", error);
            return;
        }
    };

    match tokio::time::timeout(CLI_SELF_UPDATE_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) if status.success() => {}
        Ok(Ok(status)) => log::warn!(
            "Best-effort HumanLayer CLI self-update exited with {}",
            status
        ),
        Ok(Err(error)) => log::warn!("Best-effort HumanLayer CLI self-update failed: {}", error),
        Err(_) => {
            if let Err(error) = child.start_kill() {
                log::warn!(
                    "Best-effort HumanLayer CLI self-update timed out after {:?} and failed to kill child process: {}",
                    CLI_SELF_UPDATE_TIMEOUT,
                    error
                );
                return;
            }

            if let Err(error) = child.wait().await {
                log::warn!(
                    "Best-effort HumanLayer CLI self-update timed out after {:?} and failed while waiting for child process shutdown: {}",
                    CLI_SELF_UPDATE_TIMEOUT,
                    error
                );
                return;
            }

            log::warn!(
                "Best-effort HumanLayer CLI self-update timed out after {:?}; child process killed",
                CLI_SELF_UPDATE_TIMEOUT
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK (the Linux webview) enables a DMABUF-based renderer by default
    // that fails to initialize on many real GPU/driver setups (notably NVIDIA
    // and some virtualized GPUs), bringing the window up blank or corrupted.
    // Opt out of just that path so the webview stays on a compatible renderer
    // while keeping GPU compositing where it works. Must run before any webview
    // is created, and we only set a default so a user can still override — e.g.
    // WEBKIT_DISABLE_COMPOSITING_MODE=1 or LIBGL_ALWAYS_SOFTWARE=1 on a host
    // with no usable GPU (those silence unrelated Mesa GL probe warnings this
    // flag does not touch).
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // Initialize Sentry first - keep guard alive for application lifetime
    let _sentry_guard = sentry::init();

    let daemon_manager = DaemonManager::new();
    let exit_daemon_manager = daemon_manager.clone();

    let builder = tauri::Builder::default();

    // On Linux/Windows a deep link launches a second process with the URL in
    // argv. single-instance (which must be the first plugin registered)
    // forwards it to the running app, where the deep-link plugin surfaces it
    // via on_open_url; without it every riptide:// open boots another app.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        log::info!("[Tauri] Second instance launch forwarded: {:?}", argv);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin({
            let is_dev = cfg!(debug_assertions);
            let log_dir = logging::get_log_base_dir();
            let timestamp = logging::get_boot_timestamp();

            // Create log directory if it doesn't exist
            std::fs::create_dir_all(&log_dir).ok();

            let log_targets = if is_dev {
                println!(
                    "[HumanLayer] Logs will be written to: {}",
                    log_dir.display()
                );
                vec![
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: log_dir,
                        file_name: Some(format!("riptide-native-{}", timestamp)),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ]
            } else {
                vec![
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: log_dir,
                        file_name: Some(format!("riptide-native-{}", timestamp)),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ]
            };

            tauri_plugin_log::Builder::new()
                .targets(log_targets)
                .level(if is_dev {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build()
        })
        .manage(daemon_manager)
        .manage(pty::PtyManager::new())
        .manage(PendingDeepLink::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_host_id,
            get_process_cwd,
            take_pending_deep_link,
            start_daemon,
            stop_daemon,
            is_daemon_running,
            set_daemon_management,
            get_log_directory,
            get_current_log_files,
            get_editor_env,
            open_in_editor,
            save_window_state,
            set_window_theme,
            terminal_cli_self_update,
            artifact_trace::save_artifact_trace,
            // Claude Code diagnostics
            claude_diagnostics::check_claude_installed,
            claude_diagnostics::probe_coding_agent,
            claude_diagnostics::update_claude_code,
            // Workspace config commands
            workspace_setup::workspace_config_read,
            workspace_setup::workspace_config_write,
            workspace_setup::workspace_config_ensure_gitignore,
            workspace_setup::workspace_config_open_in_editor,
            workspace_setup::discover_git_repositories,
            // Workspace worktree-now commands
            workspace_setup::workspace_preflight,
            workspace_setup::workspace_create,
            workspace_setup::workspace_copy_globs,
            workspace_setup::workspace_run_setup,
            workspace_setup::workspace_remove_all,
            // PTY commands
            pty::pty_create,
            pty::pty_attach,
            pty::pty_detach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_list,
            // Filescan commands
            filescan::fuzzy_search_files,
        ])
        .setup(|app| {
            // Migrate config files to expand tilde paths (fixes CORE-330)
            config_migration::migrate_configs_on_boot();

            // Restore window state if it exists
            use tauri_plugin_store::StoreExt;

            if let Some(main_window) = app.get_webview_window("main") {
                let is_local = cfg!(debug_assertions) || app.config().identifier.contains("local");
                let is_dev = app.config().identifier.contains("dev");
                let store_path = get_window_store_path(is_local, is_dev);

                if let Ok(store) = app.store(&store_path) {
                    if let Some(window_state_value) = store.get("window_state") {
                        if let Ok(window_state) =
                            serde_json::from_value::<WindowState>(window_state_value)
                        {
                            // Restore window size
                            if window_state.width > 0.0 && window_state.height > 0.0 {
                                let _ = main_window.set_size(tauri::PhysicalSize::new(
                                    window_state.width as u32,
                                    window_state.height as u32,
                                ));
                            }

                            // Restore window position
                            if let (Some(x), Some(y)) = (window_state.x, window_state.y) {
                                if x >= 0.0 && y >= 0.0 {
                                    let _ = main_window.set_position(tauri::PhysicalPosition::new(
                                        x as i32, y as i32,
                                    ));
                                }
                            }

                            // Restore maximized state
                            if window_state.maximized {
                                let _ = main_window.maximize();
                            }
                        }
                    }
                }
            }

            // Handle deep links
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                // Handle URLs that launched the app (cold start)
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    log::info!("[Tauri] App launched with deep link URLs: {:?}", urls);
                    let pending_deep_link = app.state::<PendingDeepLink>();
                    for url in urls {
                        match pending_deep_link.0.lock() {
                            Ok(mut pending) => {
                                *pending = Some(url.to_string());
                            }
                            Err(e) => {
                                log::error!("[Tauri] Failed to buffer pending deep link: {}", e);
                            }
                        }
                    }
                }

                // Handle URLs received while app is running (warm start)
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    log::info!("[Tauri] Received deep link URLs: {:?}", urls);
                    for url in urls {
                        // Focus the main window
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }

                        if let Err(e) = app_handle.emit("deep-link", url.to_string()) {
                            log::error!("[Tauri] Failed to emit deep-link event: {}", e);
                        }
                    }
                });
            }

            // Initialize host_id at startup
            let dm = app.state::<DaemonManager>();
            match dm.get_or_create_host_id() {
                Ok(id) => log::info!("Host ID initialized: {}", id),
                Err(e) => log::error!("Failed to initialize host ID: {}", e),
            }

            // Start daemon health monitoring thread
            dm.start_health_monitor(app.handle().clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Ready = event {
                if let Err(error) = set_devstack_dock_icon() {
                    log::error!("Failed to set devstack Dock icon: {}", error);
                }
            }

            if let tauri::RunEvent::Exit = event {
                let killed_ptys = app.state::<pty::PtyManager>().kill_all();
                log::info!("App exiting, killed {} PTY sessions", killed_ptys);
                log::info!("App exiting, stopping all daemons");
                // Mark as shutting down to prevent health monitor from restarting daemons
                exit_daemon_manager.set_shutting_down();
                exit_daemon_manager.stop_all_daemons();
            }
        });
}
