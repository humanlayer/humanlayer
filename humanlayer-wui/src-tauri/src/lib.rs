mod daemon;

use daemon::{DaemonInfo, DaemonManager};
use std::env;
use std::path::PathBuf;
use tauri::{Manager, State};
use tauri_plugin_store::StoreExt;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let daemon_manager = DaemonManager::new();
            app.manage(daemon_manager.clone());

            // Check if auto-launch is disabled
            let should_autolaunch = env::var("HUMANLAYER_WUI_AUTOLAUNCH_DAEMON")
                .map(|v| v.to_lowercase() != "false")
                .unwrap_or(true);

            if should_autolaunch {
                // Start daemon automatically
                let app_handle_clone = app.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let is_dev = cfg!(debug_assertions);

                    // Small delay to ensure UI is ready
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                    // Try to start daemon, but don't show errors in UI
                    match daemon_manager
                        .start_daemon(&app_handle_clone, is_dev, None)
                        .await
                    {
                        Ok(info) => {
                            tracing::info!("Daemon started automatically on port {}", info.port);
                        }
                        Err(e) => {
                            // Log error but don't interrupt user experience
                            tracing::error!("Failed to auto-start daemon: {}", e);

                            // Common edge cases that shouldn't interrupt the user
                            if e.contains("port") || e.contains("already in use") {
                                tracing::info!("Port conflict detected, user can connect manually");
                            } else if e.contains("binary not found")
                                || e.contains("daemon not found")
                            {
                                tracing::warn!(
                                    "Daemon binary missing, this is expected in some dev scenarios"
                                );
                            } else if e.contains("permission") {
                                tracing::error!(
                                    "Permission issue starting daemon, user intervention required"
                                );
                            }
                        }
                    }
                });
            } else {
                tracing::info!("Daemon auto-launch disabled by environment variable");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let daemon_manager = window.state::<DaemonManager>();

                // Always stop daemon when window closes
                if let Some(info) = daemon_manager.get_info() {
                    let is_dev = info.branch_id != "production";
                    let store_path = get_store_path(is_dev, Some(&info.branch_id));

                    if let Ok(store) = window.app_handle().store(&store_path) {
                        // Update store to mark daemon as not running
                        if let Some(mut stored_info) = store
                            .get("current_daemon")
                            .and_then(|v| serde_json::from_value::<DaemonInfo>(v).ok())
                        {
                            stored_info.is_running = false;
                            store.set(
                                "current_daemon",
                                serde_json::to_value(&stored_info).unwrap(),
                            );
                            let _ = store.save();
                        }
                    }

                    // Stop the daemon
                    let _ = daemon_manager.stop_daemon();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_daemon,
            stop_daemon,
            get_daemon_info,
            is_daemon_running,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
