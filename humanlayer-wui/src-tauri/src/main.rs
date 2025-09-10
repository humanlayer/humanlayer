// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Log PATH before fix
    if let Ok(path) = std::env::var("PATH") {
        eprintln!("[Tauri Main] PATH before fix: {}", path);
    }

    let _ = fix_path_env::fix();

    // Log PATH after fix
    if let Ok(path) = std::env::var("PATH") {
        eprintln!("[Tauri Main] PATH after fix: {}", path);
    }

    humanlayer_wui_lib::run()
}
