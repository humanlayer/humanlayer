// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix PATH on macOS/Linux when launched from GUI (not terminal)
    // This ensures we inherit the user's shell PATH for finding binaries like `claude`
    let _ = fix_path_env::fix();

    riptide_native_lib::run()
}
