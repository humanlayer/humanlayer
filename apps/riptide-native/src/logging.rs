use std::path::PathBuf;

/// Get the base log directory path
pub fn get_log_base_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Failed to get home directory");
    let base = home.join(".humanlayer").join("riptide").join("logs");
    match std::env::var("DEVSTACK_ID").ok().filter(|value| !value.is_empty()) {
        Some(stack_id) => base.join(stack_id),
        None => base,
    }
}

/// Generate a timestamp string for log filenames (matches riptided format)
pub fn get_boot_timestamp() -> String {
    let now = chrono::Local::now();
    now.format("%Y-%m-%d_%H-%M-%S").to_string()
}
