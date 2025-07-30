use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::env;
use std::path::PathBuf;
use std::fs;
use std::io::{BufRead, BufReader};
use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonInfo {
    pub port: u16,
    pub pid: u32,
    pub database_path: String,
    pub socket_path: String,
    pub branch_id: String,
    pub is_running: bool,
}

#[derive(Clone)]
pub struct DaemonManager {
    process: Arc<Mutex<Option<Child>>>,
    info: Arc<Mutex<Option<DaemonInfo>>>,
}

impl DaemonManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            info: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start_daemon(
        &self,
        app_handle: &AppHandle,
        is_dev: bool,
        branch_override: Option<String>
    ) -> Result<DaemonInfo, String> {
        let mut process = self.process.lock().unwrap();

        // Check if already running
        if process.is_some() {
            if let Some(info) = self.info.lock().unwrap().as_ref() {
                return Ok(info.clone());
            }
        }

        // Check if daemon is already running on a specific port
        if let Ok(port_str) = env::var("HUMANLAYER_DAEMON_HTTP_PORT") {
            if let Ok(port) = port_str.parse::<u16>() {
                // Try to connect to existing daemon
                if check_daemon_health(port).is_ok() {
                    let info = DaemonInfo {
                        port,
                        pid: 0, // Unknown PID for external daemon
                        database_path: "external".to_string(),
                        socket_path: "external".to_string(),
                        branch_id: "external".to_string(),
                        is_running: true,
                    };
                    *self.info.lock().unwrap() = Some(info.clone());
                    return Ok(info);
                }
            }
        }

        // Determine branch identifier
        let branch_id = if is_dev {
            branch_override.or_else(get_git_branch)
                .unwrap_or_else(|| "dev".to_string())
        } else {
            "production".to_string()
        };

        // Extract ticket ID if present (e.g., "eng-1234" from "eng-1234-some-feature")
        let branch_id = extract_ticket_id(&branch_id).unwrap_or(branch_id);

        // Set up paths
        let home_dir = dirs::home_dir()
            .ok_or("Failed to get home directory")?;
        let humanlayer_dir = home_dir.join(".humanlayer");
        fs::create_dir_all(&humanlayer_dir)
            .map_err(|e| format!("Failed to create .humanlayer directory: {e}"))?;

        // Database path
        let database_path = if is_dev {
            // Copy dev database if it doesn't exist
            let dev_db = humanlayer_dir.join(format!("daemon-{branch_id}.db"));
            if !dev_db.exists() {
                let source_db = humanlayer_dir.join("daemon-dev.db");
                if source_db.exists() {
                    fs::copy(&source_db, &dev_db)
                        .map_err(|e| format!("Failed to copy dev database: {e}"))?;
                }
            }
            dev_db
        } else {
            humanlayer_dir.join("daemon.db")
        };

        // Socket path
        let socket_path = if is_dev {
            humanlayer_dir.join(format!("daemon-{branch_id}.sock"))
        } else {
            humanlayer_dir.join("daemon.sock")
        };

        // Get daemon binary path (macOS only)
        let daemon_path = get_daemon_path(app_handle, is_dev)?;

        // Build environment with port 0 for dynamic allocation
        let mut env_vars = env::vars().collect::<Vec<_>>();
        env_vars.push(("HUMANLAYER_DATABASE_PATH".to_string(), database_path.to_str().unwrap().to_string()));
        env_vars.push(("HUMANLAYER_DAEMON_SOCKET".to_string(), socket_path.to_str().unwrap().to_string()));
        env_vars.push(("HUMANLAYER_DAEMON_HTTP_PORT".to_string(), "0".to_string()));
        env_vars.push(("HUMANLAYER_DAEMON_HTTP_HOST".to_string(), "127.0.0.1".to_string()));

        if is_dev {
            env_vars.push(("HUMANLAYER_DAEMON_VERSION_OVERRIDE".to_string(), branch_id.clone()));
        }

        // Start daemon with stdout capture
        let mut cmd = Command::new(&daemon_path);
        cmd.envs(env_vars)
           .stdout(Stdio::piped())
           .stderr(Stdio::inherit()); // Let stderr go to console for debugging

        let mut child = cmd.spawn()
            .map_err(|e| format!("Failed to start daemon: {e}"))?;

        // Parse stdout to get the actual port
        let stdout = child.stdout.take()
            .ok_or("Failed to capture daemon stdout")?;

        let reader = BufReader::new(stdout);
        let mut actual_port = None;

        for line in reader.lines().map_while(Result::ok) {
            if line.starts_with("HTTP_PORT=") {
                actual_port = line.replace("HTTP_PORT=", "")
                    .parse::<u16>()
                    .ok();
                break;
            }
        }

        let port = actual_port.ok_or("Daemon failed to report port")?;

        let daemon_info = DaemonInfo {
            port,
            pid: child.id(),
            database_path: database_path.to_str().unwrap().to_string(),
            socket_path: socket_path.to_str().unwrap().to_string(),
            branch_id: branch_id.clone(),
            is_running: true,
        };

        *process = Some(child);
        *self.info.lock().unwrap() = Some(daemon_info.clone());

        // Wait for daemon to be ready
        wait_for_daemon(port)?;

        Ok(daemon_info)
    }

    pub fn stop_daemon(&self) -> Result<(), String> {
        let mut process = self.process.lock().unwrap();

        if let Some(mut child) = process.take() {
            child.kill()
                .map_err(|e| format!("Failed to stop daemon: {e}"))?;

            // Wait for process to exit
            let _ = child.wait();

            // Update store to mark daemon as not running
            if let Some(info) = self.info.lock().unwrap().as_mut() {
                info.is_running = false;
            }
        }

        Ok(())
    }

    pub fn get_info(&self) -> Option<DaemonInfo> {
        self.info.lock().unwrap().clone()
    }

    pub fn is_running(&self) -> bool {
        let mut process = self.process.lock().unwrap();
        if let Some(child) = process.as_mut() {
            // Check if process is still alive
            match child.try_wait() {
                Ok(None) => true,  // Still running
                _ => false,        // Exited or error
            }
        } else {
            false
        }
    }
}

fn get_daemon_path(app_handle: &AppHandle, is_dev: bool) -> Result<PathBuf, String> {
    if is_dev {
        // In dev mode, look for hld-dev in the project
        let dev_path = env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?
            .parent()  // Go up from humanlayer-wui to humanlayer
            .ok_or("Failed to get parent directory")?
            .join("hld")
            .join("hld-dev");

        if dev_path.exists() {
            Ok(dev_path)
        } else {
            Err("Development daemon not found. Run 'make daemon-dev-build' first.".to_string())
        }
    } else {
        // In production, use bundled binary
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {e}"))?;

        Ok(resource_dir.join("bin").join("hld"))
    }
}

fn get_git_branch() -> Option<String> {
    Command::new("git")
        .args(["branch", "--show-current"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

fn extract_ticket_id(branch: &str) -> Option<String> {
    // Extract patterns like "eng-1234" from branch names
    let re = regex::Regex::new(r"(eng-\d+)").ok()?;
    re.captures(branch)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
}

fn check_daemon_health(port: u16) -> Result<(), String> {
    match reqwest::blocking::get(format!("http://127.0.0.1:{port}/api/v1/health")) {
        Ok(response) if response.status().is_success() => Ok(()),
        Ok(_) => Err("Daemon health check failed".to_string()),
        Err(e) => Err(format!("Failed to connect to daemon: {e}")),
    }
}

fn wait_for_daemon(port: u16) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(10);

    while start.elapsed() < timeout {
        if check_daemon_health(port).is_ok() {
            return Ok(());
        }

        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    Err("Daemon failed to start within 10 seconds".to_string())
}
