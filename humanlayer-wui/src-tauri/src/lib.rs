mod daemon;

use daemon::{DaemonInfo, DaemonManager};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

// Helper function to set macOS window background color with RGB values
#[cfg(target_os = "macos")]
#[allow(deprecated)] // Using cocoa for compatibility with Tauri's ns_window() API
fn set_macos_window_background_color_rgb(window: &tauri::WebviewWindow, r: f64, g: f64, b: f64) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil};

    let ns_window = window.ns_window().unwrap() as id;
    unsafe {
        let bg_color = NSColor::colorWithRed_green_blue_alpha_(
            nil,
            r / 255.0,
            g / 255.0,
            b / 255.0,
            1.0,
        );
        ns_window.setBackgroundColor_(bg_color);
    }
}

// Helper function to set macOS window appearance based on theme brightness
#[cfg(target_os = "macos")]
#[allow(deprecated)] // Using cocoa for compatibility with Tauri's ns_window() API
#[allow(unexpected_cfgs)] // Clippy false positive with objc macros
fn set_macos_window_appearance(window: &tauri::WebviewWindow, is_dark: bool) {
    #[link(name = "AppKit", kind = "framework")]
    extern "C" {
        static NSAppearanceNameAqua: id;
        static NSAppearanceNameDarkAqua: id;
    }

    use cocoa::base::id;
    use objc::{msg_send, sel, sel_impl, class};

    let ns_window = window.ns_window().unwrap() as id;
    unsafe {
        let appearance: id = msg_send![class!(NSAppearance), appearanceNamed: if is_dark { NSAppearanceNameDarkAqua } else { NSAppearanceNameAqua }];
        let _: () = msg_send![ns_window, setAppearance: appearance];
    }
}


#[cfg(not(target_os = "macos"))]
fn set_macos_window_background_color_rgb(_window: &tauri::WebviewWindow, _r: f64, _g: f64, _b: f64) {
    // No-op on non-macOS platforms
}

#[cfg(not(target_os = "macos"))]
fn set_macos_window_appearance(_window: &tauri::WebviewWindow, _is_dark: bool) {
    // No-op on non-macOS platforms
}

// Tauri command to set window background color from JavaScript
#[tauri::command]
fn set_window_background_color(
    app: tauri::AppHandle,
    window_label: String,
    hex_color: String,
) -> Result<(), String> {
    // Parse hex color
    let hex = hex_color.trim_start_matches('#');
    if hex.len() != 6 {
        return Err("Invalid hex color format".to_string());
    }

    let r = u8::from_str_radix(&hex[0..2], 16).map_err(|e| e.to_string())? as f64;
    let g = u8::from_str_radix(&hex[2..4], 16).map_err(|e| e.to_string())? as f64;
    let b = u8::from_str_radix(&hex[4..6], 16).map_err(|e| e.to_string())? as f64;

    // Get the window and set its background color
    if let Some(window) = app.get_webview_window(&window_label) {
        set_macos_window_background_color_rgb(&window, r, g, b);
        Ok(())
    } else {
        Err(format!("Window '{window_label}' not found"))
    }
}

// Tauri command to set window theme colors (background and text) from JavaScript
#[tauri::command]
fn set_window_theme_colors(
    app: tauri::AppHandle,
    window_label: String,
    bg_hex: String,
    fg_hex: String,
) -> Result<(), String> {
    // Parse background color
    let bg = bg_hex.trim_start_matches('#');
    if bg.len() != 6 {
        return Err("Invalid background hex color format".to_string());
    }

    let bg_r = u8::from_str_radix(&bg[0..2], 16).map_err(|e| e.to_string())? as f64;
    let bg_g = u8::from_str_radix(&bg[2..4], 16).map_err(|e| e.to_string())? as f64;
    let bg_b = u8::from_str_radix(&bg[4..6], 16).map_err(|e| e.to_string())? as f64;

    // Parse foreground color
    let fg = fg_hex.trim_start_matches('#');
    if fg.len() != 6 {
        return Err("Invalid foreground hex color format".to_string());
    }

    let fg_r = u8::from_str_radix(&fg[0..2], 16).map_err(|e| e.to_string())? as f64;
    let fg_g = u8::from_str_radix(&fg[2..4], 16).map_err(|e| e.to_string())? as f64;
    let fg_b = u8::from_str_radix(&fg[4..6], 16).map_err(|e| e.to_string())? as f64;

    // Get the window and set its colors
    if let Some(window) = app.get_webview_window(&window_label) {
        set_macos_window_background_color_rgb(&window, bg_r, bg_g, bg_b);

        // Determine if theme is dark based on foreground brightness
        // If foreground is bright (high RGB values), it's likely a dark theme
        #[cfg(target_os = "macos")]
        {
            let brightness = (fg_r + fg_g + fg_b) / 3.0;
            let is_dark = brightness > 128.0;
            set_macos_window_appearance(&window, is_dark);
        }

        Ok(())
    } else {
        Err(format!("Window '{window_label}' not found"))
    }
}

// Branch detection utilities
pub fn get_git_branch() -> Option<String> {
    Command::new("git")
        .args(["branch", "--show-current"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

pub fn extract_ticket_id(branch: &str) -> Option<String> {
    // Extract patterns like "eng-1234" from branch names
    let re = regex::Regex::new(r"(eng-\d+)").ok()?;
    re.captures(branch)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
}

pub fn get_branch_id(is_dev: bool, branch_override: Option<String>) -> String {
    if is_dev {
        let branch = branch_override
            .or_else(get_git_branch)
            .unwrap_or_else(|| "dev".to_string());
        extract_ticket_id(&branch).unwrap_or(branch)
    } else {
        "production".to_string()
    }
}

// Helper to get store path based on dev mode and branch
fn get_store_path(is_dev: bool, branch_id: Option<&str>) -> PathBuf {
    let home = dirs::home_dir().expect("Failed to get home directory");
    let humanlayer_dir = home.join(".humanlayer");

    if is_dev {
        // Use branch-specific store in dev mode
        if let Some(branch) = branch_id {
            humanlayer_dir.join(format!("codelayer-{branch}.json"))
        } else {
            humanlayer_dir.join("codelayer-dev.json")
        }
    } else {
        humanlayer_dir.join("codelayer.json")
    }
}

#[tauri::command]
async fn start_daemon(
    app_handle: tauri::AppHandle,
    daemon_manager: State<'_, DaemonManager>,
    is_dev: bool,
    branch_override: Option<String>,
) -> Result<DaemonInfo, String> {
    let info = daemon_manager
        .start_daemon(&app_handle, is_dev, branch_override)
        .await?;

    // Save to store using branch-specific path in dev mode
    let store_path = get_store_path(is_dev, Some(&info.branch_id));
    let store = app_handle
        .store(&store_path)
        .map_err(|e| format!("Failed to access store: {e}"))?;

    store.set("current_daemon", serde_json::to_value(&info).unwrap());
    store
        .save()
        .map_err(|e| format!("Failed to save store: {e}"))?;

    Ok(info)
}

#[tauri::command]
async fn stop_daemon(
    app_handle: tauri::AppHandle,
    daemon_manager: State<'_, DaemonManager>,
) -> Result<(), String> {
    // Get daemon info before stopping to know which store to update
    if let Some(info) = daemon_manager.get_info() {
        let is_dev = info.branch_id != "production";
        let store_path = get_store_path(is_dev, Some(&info.branch_id));

        // Stop the daemon
        daemon_manager.stop_daemon()?;

        // Update store to mark as not running
        let store = app_handle
            .store(&store_path)
            .map_err(|e| format!("Failed to access store: {e}"))?;

        // Get the stored daemon info and update is_running
        if let Some(mut stored_info) = store
            .get("current_daemon")
            .and_then(|v| serde_json::from_value::<DaemonInfo>(v).ok())
        {
            stored_info.is_running = false;
            store.set(
                "current_daemon",
                serde_json::to_value(&stored_info).unwrap(),
            );
            store
                .save()
                .map_err(|e| format!("Failed to save store: {e}"))?;
        }
    } else {
        daemon_manager.stop_daemon()?;
    }

    Ok(())
}

#[tauri::command]
async fn get_daemon_info(
    app_handle: tauri::AppHandle,
    daemon_manager: State<'_, DaemonManager>,
    is_dev: bool,
) -> Result<Option<DaemonInfo>, String> {
    // First check if daemon manager has info
    if let Some(info) = daemon_manager.get_info() {
        return Ok(Some(info));
    }

    // Otherwise check store for last known daemon
    let store_path = get_store_path(is_dev, None);
    let store = app_handle
        .store(&store_path)
        .map_err(|e| format!("Failed to access store: {e}"))?;

    let stored_info = store
        .get("current_daemon")
        .and_then(|v| serde_json::from_value::<DaemonInfo>(v).ok());

    Ok(stored_info)
}

#[tauri::command]
async fn is_daemon_running(daemon_manager: State<'_, DaemonManager>) -> Result<bool, String> {
    Ok(daemon_manager.is_running())
}

#[tauri::command]
async fn get_log_directory() -> Result<String, String> {
    let is_dev = cfg!(debug_assertions);

    if is_dev {
        // Dev mode: return branch-based folder
        let branch_id = get_branch_id(is_dev, None);
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        let log_dir = home.join(".humanlayer").join("logs").join(format!("wui-{branch_id}"));
        Ok(log_dir.to_string_lossy().to_string())
    } else {
        // Production: use tauri API to get platform-specific log directory
        // This will be handled by the frontend using appLogDir()
        Err("Use appLogDir() for production".to_string())
    }
}

#[tauri::command]
fn show_quick_launcher(app: tauri::AppHandle) -> Result<(), String> {
    // Check if quick launcher window already exists
    if let Some(window) = app.get_webview_window("quick-launcher") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.center();
        return Ok(());
    }

    // Create new floating window without title bar
    let _window = WebviewWindowBuilder::new(
        &app,
        "quick-launcher",
        WebviewUrl::App("index.html#/quick-launcher".into())
    )
    .title("")
    .inner_size(500.0, 185.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .decorations(false)  // Remove all window decorations including title bar
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create daemon manager outside of builder
    let daemon_manager = DaemonManager::new();
    let exit_daemon_manager = daemon_manager.clone();

    // Build the app
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin({
            let is_dev = cfg!(debug_assertions);
            let branch_id = get_branch_id(is_dev, None);

            // Determine log directory based on dev/prod mode
            let log_targets = if is_dev {
                // Dev mode: use branch-based folder in ~/.humanlayer/logs/
                let home = dirs::home_dir().expect("Failed to get home directory");
                let log_dir = home.join(".humanlayer").join("logs").join(format!("wui-{branch_id}"));

                // Create the directory if it doesn't exist
                std::fs::create_dir_all(&log_dir).ok();

                // Store the log directory path in app state for frontend access
                println!("[WUI] Logs will be written to: {}", log_dir.display());

                vec![
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: log_dir,
                        file_name: Some("codelayer".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ]
            } else {
                // Production: use default platform-specific log directory
                vec![
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
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
                .max_file_size(50_000_000) // 50MB before rotation
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build()
        })
        .setup(move |app| {
            // Register the daemon manager as managed state
            app.manage(daemon_manager.clone());

            // Register global hotkey for quick launcher
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                let app_handle = app.handle().clone();
                let shortcut = app.handle().global_shortcut();

                // Register the shortcut with a callback
                shortcut.on_shortcut("cmd+shift+h", move |_app, _shortcut, _event| {
                    // Show quick launcher window
                    let _ = show_quick_launcher(app_handle.clone());
                })?;
            }

            // Check if auto-launch is disabled
            let should_autolaunch = env::var("HUMANLAYER_WUI_AUTOLAUNCH_DAEMON")
                .map(|v| v.to_lowercase() != "false")
                .unwrap_or(true);

            if should_autolaunch {
                // Start daemon automatically
                let app_handle_clone = app.app_handle().clone();
                let daemon_manager_for_autolaunch = daemon_manager.clone();
                tauri::async_runtime::spawn(async move {
                    let is_dev = cfg!(debug_assertions);

                    // Small delay to ensure UI is ready
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                    // Try to start daemon, but don't show errors in UI
                    match daemon_manager_for_autolaunch
                        .start_daemon(&app_handle_clone, is_dev, None)
                        .await
                    {
                        Ok(info) => {
                            log::info!("[Tauri] Daemon started automatically on port {}", info.port);
                        }
                        Err(e) => {
                            // Log error but don't interrupt user experience
                            log::error!("[Tauri] Failed to auto-start daemon: {e}");
                        }
                    }
                });
            } else {
                log::info!("[Tauri] Daemon auto-launch disabled by environment variable");
            }

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("[Tauri] Window event: {event:?}");
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_daemon,
            stop_daemon,
            get_daemon_info,
            is_daemon_running,
            get_log_directory,
            show_quick_launcher,
            set_window_background_color,
            set_window_theme_colors,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    // Run the app with access to exit_daemon_manager
    app.run(move |_app, event| {
        match event {
            tauri::RunEvent::ExitRequested {code: _, api: _, ..} => {
                log::info!("[Tauri] ExitRequested");
                // Note: This doesn't fire on macOS due to Tauri bug
            }
            tauri::RunEvent::Exit => {
                log::info!("[Tauri] Exit - stopping daemon");

                // Get daemon info to update store
                if let Some(info) = exit_daemon_manager.get_info() {
                    log::info!("[Tauri] Found daemon on port {} with PID {:?}",
                              info.port, info.pid);

                    // Determine store path
                    let is_dev = info.branch_id != "production";
                    let store_path = get_store_path(is_dev, Some(&info.branch_id));

                    // Update store to mark daemon as not running
                    // Note: We can't access app_handle here, so we update store directly
                    if let Some(home) = dirs::home_dir() {
                        let full_store_path = home.join(".humanlayer").join(&store_path);

                        // Read, update, and write store manually
                        if let Ok(store_content) = fs::read_to_string(&full_store_path) {
                            if let Ok(mut store_json) = serde_json::from_str::<serde_json::Value>(&store_content) {
                                if let Some(current_daemon) = store_json.get_mut("current_daemon") {
                                    if let Some(daemon_obj) = current_daemon.as_object_mut() {
                                        daemon_obj.insert("is_running".to_string(), serde_json::json!(false));

                                        // Write updated store back
                                        if let Ok(updated_content) = serde_json::to_string_pretty(&store_json) {
                                            let _ = fs::write(&full_store_path, updated_content);
                                            log::info!("[Tauri] Updated store to mark daemon as stopped");
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Stop the daemon process
                    if let Err(e) = exit_daemon_manager.stop_daemon() {
                        log::error!("[Tauri] Failed to stop daemon on exit: {e}");
                    } else {
                        log::info!("[Tauri] Successfully stopped daemon on exit");
                    }
                } else {
                    log::info!("[Tauri] No daemon to stop on exit");
                }
            }
            _ => {}
        }
    });
}
