//! Shell environment loading for GUI applications.
//!
//! When a Tauri app is launched from Finder/Dock (not from a terminal), it doesn't
//! inherit the user's shell environment (.zshrc, .bash_profile, etc.). This module
//! provides functionality to capture the user's shell environment by spawning a
//! login shell, similar to how VS Code handles this.

use std::collections::HashMap;
use std::env;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// Cached shell environment loaded at startup.
/// Some(env) = successfully loaded, None inside Some = load attempted but failed
static SHELL_ENV: OnceLock<Option<HashMap<String, String>>> = OnceLock::new();

/// Get the cached shell environment, loading it on first call.
/// Returns None if loading failed (caller should fall back to process environment).
pub fn get() -> Option<&'static HashMap<String, String>> {
    SHELL_ENV
        .get_or_init(|| match load() {
            Ok(env) => {
                log::info!(
                    "Successfully loaded shell environment ({} variables)",
                    env.len()
                );
                if let Some(path) = env.get("PATH") {
                    log::info!("Shell PATH: {}", path);
                }
                Some(env)
            }
            Err(e) => {
                log::warn!(
                    "Failed to load shell environment: {}. Will use process environment.",
                    e
                );
                None
            }
        })
        .as_ref()
}

/// Load the user's shell environment by spawning a login shell.
/// This captures PATH and other environment variables from .zshrc, .bash_profile, etc.
fn load() -> Result<HashMap<String, String>, String> {
    // Get user's default shell
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    log::info!("Loading shell environment from: {}", shell);

    // Spawn login shell with `env` command to capture all environment variables
    // Using `-l -c` (login shell, command) rather than `-i -l -c` to avoid
    // interactive features that could hang (like oh-my-zsh prompts)
    let output = Command::new(&shell)
        .args(["-l", "-c", "env"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Shell exited with status {:?}: {}",
            output.status.code(),
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut env_map = HashMap::new();

    for line in stdout.lines() {
        // Skip empty lines
        if line.is_empty() {
            continue;
        }
        // Parse KEY=VALUE format (value may contain = signs)
        if let Some((key, value)) = line.split_once('=') {
            // Skip ANSI escape sequences that some shells output
            if !key.starts_with('\x1b') && !key.contains('\x1b') {
                env_map.insert(key.to_string(), value.to_string());
            }
        }
    }

    if env_map.is_empty() {
        return Err("No environment variables captured from shell".to_string());
    }

    Ok(env_map)
}
