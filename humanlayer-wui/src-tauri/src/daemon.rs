use crate::get_branch_id;
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

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

    pub async fn start_daemon(
        &self,
        app_handle: &AppHandle,
        is_dev: bool,
        branch_override: Option<String>,
    ) -> Result<DaemonInfo, String> {
        // Check if this is a nightly build based on app identifier
        let is_nightly = app_handle.config().identifier.contains("nightly");
        // Check if already running
        {
            let process = self.process.lock().unwrap();
            if process.is_some() {
                if let Some(info) = self.info.lock().unwrap().as_ref() {
                    return Ok(info.clone());
                }
            }
        }

        // Check if we should skip auto-launch
        if env::var("HUMANLAYER_WUI_AUTOLAUNCH_DAEMON").map(|v| v.trim().to_ascii_lowercase()) == Ok("false".to_string()) {
            // Don't auto-launch daemon, expect it to be managed externally
            log::info!("[Tauri] Auto-launch disabled via HUMANLAYER_WUI_AUTOLAUNCH_DAEMON=false");

            // Still need to return daemon info for external daemon
            if let Ok(port_str) = env::var("HUMANLAYER_DAEMON_HTTP_PORT") {
                if let Ok(port) = port_str.parse::<u16>() {
                    let socket_path = env::var("HUMANLAYER_DAEMON_SOCKET")
                        .unwrap_or_else(|_| format!("~/.humanlayer/daemon-{port}.sock"));
                    let database_path = env::var("HUMANLAYER_DATABASE_PATH")
                        .unwrap_or_else(|_| "~/.humanlayer/daemon.db".to_string());

                    // Get branch from environment or git
                    let branch_id = if let Ok(version) = env::var("HUMANLAYER_DAEMON_VERSION_OVERRIDE") {
                        version
                    } else {
                        get_branch_id(is_dev, branch_override)
                    };

                    let info = DaemonInfo {
                        port,
                        pid: 0, // Unknown PID for pre-existing daemon
                        database_path,
                        socket_path,
                        branch_id,
                        is_running: true,
                    };
                    *self.info.lock().unwrap() = Some(info.clone());
                    return Ok(info);
                }
            }
            return Err(
                "HUMANLAYER_WUI_AUTOLAUNCH_DAEMON=false but no HUMANLAYER_DAEMON_HTTP_PORT set"
                    .to_string(),
            );
        }

        // Check if daemon is already running on a specific port
        if let Ok(port_str) = env::var("HUMANLAYER_DAEMON_HTTP_PORT") {
            if let Ok(port) = port_str.parse::<u16>() {
                // Try to connect to existing daemon
                if check_daemon_health(port).await.is_ok() {
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

        // Determine branch identifier using shared function
        let branch_id = get_branch_id(is_dev, branch_override);

        // Set up paths
        let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
        let humanlayer_dir = home_dir.join(".humanlayer");
        fs::create_dir_all(&humanlayer_dir)
            .map_err(|e| format!("Failed to create .humanlayer directory: {e}"))?;

        // Database path - check environment variable first
        let database_path = if let Ok(db_path) = env::var("HUMANLAYER_DATABASE_PATH") {
            log::info!("[Tauri] Using database path from HUMANLAYER_DATABASE_PATH: {db_path}");
            PathBuf::from(db_path)
        } else if is_dev {
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
        } else if is_nightly {
            // Nightly build uses daemon-nightly.db
            humanlayer_dir.join("daemon-nightly.db")
        } else {
            humanlayer_dir.join("daemon.db")
        };

        // Socket path - check environment variable first
        let socket_path = if let Ok(sock_path) = env::var("HUMANLAYER_DAEMON_SOCKET") {
            log::info!("[Tauri] Using socket path from HUMANLAYER_DAEMON_SOCKET: {sock_path}");
            PathBuf::from(sock_path)
        } else if is_dev {
            humanlayer_dir.join(format!("daemon-{branch_id}.sock"))
        } else if is_nightly {
            // Nightly build uses daemon-nightly.sock
            humanlayer_dir.join("daemon-nightly.sock")
        } else {
            humanlayer_dir.join("daemon.sock")
        };

        // Get daemon binary path (macOS only)
        let daemon_path = get_daemon_path(app_handle, is_dev)?;

        // Build environment with port 0 for dynamic allocation
        let mut env_vars = env::vars().collect::<Vec<_>>();
        env_vars.push((
            "HUMANLAYER_DATABASE_PATH".to_string(),
            database_path.to_str().unwrap().to_string(),
        ));
        env_vars.push((
            "HUMANLAYER_DAEMON_SOCKET".to_string(),
            socket_path.to_str().unwrap().to_string(),
        ));
        env_vars.push(("HUMANLAYER_DAEMON_HTTP_PORT".to_string(), "0".to_string()));
        env_vars.push((
            "HUMANLAYER_DAEMON_HTTP_HOST".to_string(),
            "localhost".to_string(),
        ));

        if is_dev {
            env_vars.push((
                "HUMANLAYER_DAEMON_VERSION_OVERRIDE".to_string(),
                branch_id.clone(),
            ));
            // Enable debug logging for daemon in dev mode
            env_vars.push(("HUMANLAYER_DEBUG".to_string(), "true".to_string()));
            env_vars.push(("GIN_MODE".to_string(), "debug".to_string()));
        }

        // Start daemon with stdout capture and stderr logging
        let mut cmd = Command::new(&daemon_path);

        // Log the full command being executed for debugging
        log::info!("[Tauri] Executing daemon at path: {daemon_path:?}");
        log::info!("[Tauri] Daemon environment: database_path={}, socket_path={}, port=0, branch_id={branch_id}",
                   database_path.display(),
                   socket_path.display());

        // Log current PATH that will be inherited by daemon
        if let Ok(path) = std::env::var("PATH") {
            log::info!("[Tauri] PATH being passed to daemon: {path}");
        }

        // Always capture stderr for better debugging, even in production
        cmd.envs(env_vars)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start daemon: {e}"))?;

        // Get the PID before we do anything else
        let pid = child.id();
        log::info!("[Tauri] Daemon spawned with PID: {pid}");

        // Always spawn a task to read stderr for debugging
        if let Some(stderr) = child.stderr.take() {
            let branch_id_clone = branch_id.clone();
            let is_prod = !is_dev;
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(line) => {
                            // In production, always log at info level or higher for visibility
                            if is_prod {
                                // Check if it's an error or warning
                                if line.contains("ERROR")
                                    || line.contains("error")
                                    || line.contains("Error")
                                {
                                    log::error!("[Daemon] {branch_id_clone}: {line}");
                                } else if line.contains("WARN")
                                    || line.contains("warn")
                                    || line.contains("Warning")
                                {
                                    log::warn!("[Daemon] {branch_id_clone}: {line}");
                                } else {
                                    log::info!("[Daemon] {branch_id_clone}: {line}");
                                }
                            } else {
                                // Dev mode: parse log levels as before
                                let level = extract_log_level(&line);
                                let cleaned_line = remove_timestamp(&line);

                                match level {
                                    LogLevel::Error => {
                                        log::error!("[Daemon] {branch_id_clone}: {cleaned_line}")
                                    }
                                    LogLevel::Warn => {
                                        log::warn!("[Daemon] {branch_id_clone}: {cleaned_line}")
                                    }
                                    LogLevel::Info => {
                                        log::info!("[Daemon] {branch_id_clone}: {cleaned_line}")
                                    }
                                    LogLevel::Debug => {
                                        log::debug!("[Daemon] {branch_id_clone}: {cleaned_line}")
                                    }
                                    LogLevel::Trace => {
                                        log::trace!("[Daemon] {branch_id_clone}: {cleaned_line}")
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("[Tauri] Error reading daemon stderr: {e}");
                            break;
                        }
                    }
                }
                log::info!("[Tauri] Daemon stderr reader finished for {branch_id_clone}");
            });
        }

        // Parse stdout to get the actual port
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture daemon stdout")?;

        let mut reader = BufReader::new(stdout);
        let mut actual_port = None;
        let mut first_line = String::new();

        // Read the first line synchronously to get the port
        log::info!("[Tauri] Waiting for daemon to report port on stdout...");
        match reader.read_line(&mut first_line) {
            Ok(0) => {
                log::error!("[Tauri] Daemon stdout closed immediately (0 bytes read)");
                return Err("Daemon stdout closed before reporting port".to_string());
            }
            Ok(n) => {
                log::info!("[Tauri] Read {n} bytes from daemon stdout: {first_line:?}");
            }
            Err(e) => {
                log::error!("[Tauri] Failed to read daemon stdout: {e}");
                return Err(format!("Failed to read daemon stdout: {e}"));
            }
        }

        if first_line.starts_with("HTTP_PORT=") {
            let port_str = first_line.trim().replace("HTTP_PORT=", "");
            log::info!("[Tauri] Attempting to parse port from: {port_str:?}");
            match port_str.parse::<u16>() {
                Ok(p) => {
                    actual_port = Some(p);
                    log::info!("[Tauri] Successfully parsed port: {p}");
                }
                Err(e) => {
                    log::error!("[Tauri] Failed to parse port from {port_str:?}: {e}");
                }
            }
        } else {
            log::error!("[Tauri] First line from daemon stdout doesn't start with HTTP_PORT=: {first_line:?}");
        }

        let port = actual_port.ok_or_else(|| {
            format!("Daemon failed to report port. First line was: {first_line:?}")
        })?;
        log::info!("[Tauri] Got port {port} from daemon stdout");

        // Now spawn a task to keep reading stdout to prevent SIGPIPE
        let branch_id_for_stdout = branch_id.clone();
        tokio::spawn(async move {
            // Continue reading the rest of stdout
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        log::trace!("[Tauri] Daemon stdout {branch_id_for_stdout}: {line}");
                    }
                    Err(e) => {
                        log::debug!("[Tauri] Daemon stdout closed for {branch_id_for_stdout}: {e}");
                        break;
                    }
                }
            }
            log::debug!("[Tauri] Stdout reader task finished for {branch_id_for_stdout}");
        });

        // Check if process is still alive after reading port
        match child.try_wait() {
            Ok(None) => log::info!("[Tauri] Daemon process still running after port read"),
            Ok(Some(status)) => {
                return Err(format!(
                    "Daemon process exited immediately after starting! Status: {status:?}"
                ));
            }
            Err(e) => log::error!("[Tauri] Error checking daemon status: {e}"),
        }

        let daemon_info = DaemonInfo {
            port,
            pid,
            database_path: database_path.to_str().unwrap().to_string(),
            socket_path: socket_path.to_str().unwrap().to_string(),
            branch_id: branch_id.clone(),
            is_running: true,
        };

        // Store the process and info before awaiting
        {
            let mut process = self.process.lock().unwrap();
            *process = Some(child);
        }
        *self.info.lock().unwrap() = Some(daemon_info.clone());

        // Wait for daemon to be ready
        log::info!("[Tauri] Waiting for daemon to be ready on port {port}");
        wait_for_daemon(port).await?;
        log::info!("[Tauri] Daemon is ready and responding to health checks");

        // Spawn a task to monitor the daemon process
        let process_arc = self.process.clone();
        let branch_id_clone = branch_id.clone();
        let port_for_monitor = port;
        tokio::spawn(async move {
            let mut last_check = std::time::Instant::now();
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

                let mut process_guard = process_arc.lock().unwrap();
                if let Some(child) = process_guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            // Process has exited
                            log::error!(
                                "[Tauri] Daemon process exited unexpectedly! Branch: {branch_id_clone}, Port: {port_for_monitor}, Exit status: {status:?}, Time since last check: {:?}",
                                last_check.elapsed()
                            );
                            // Clear the process
                            *process_guard = None;
                            break;
                        }
                        Ok(None) => {
                            // Still running
                            last_check = std::time::Instant::now();
                        }
                        Err(e) => {
                            log::error!("[Tauri] Error checking daemon process status: {e}");
                            break;
                        }
                    }
                } else {
                    // No process to monitor
                    break;
                }
            }
        });

        Ok(daemon_info)
    }

    pub fn stop_daemon(&self) -> Result<(), String> {
        let mut process = self.process.lock().unwrap();

        if let Some(mut child) = process.take() {
            let pid = child.id();

            // Try SIGTERM first (graceful shutdown)
            signal::kill(Pid::from_raw(pid as i32), Signal::SIGTERM)
                .map_err(|e| format!("Failed to send SIGTERM to daemon: {e}"))?;

            log::info!("[Tauri] Sent SIGTERM to daemon process (PID: {pid})");

            // Wait for process to exit gracefully (with timeout)
            let start = std::time::Instant::now();
            let timeout = std::time::Duration::from_secs(15);

            loop {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        log::info!("[Tauri] Daemon process exited gracefully after SIGTERM");
                        break;
                    }
                    Ok(None) => {
                        if start.elapsed() > timeout {
                            // Force kill if it doesn't exit within timeout
                            log::warn!("[Tauri] Daemon didn't exit gracefully, sending SIGKILL");
                            child
                                .kill()
                                .map_err(|e| format!("Failed to kill daemon: {e}"))?;
                            let _ = child.wait();
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(e) => {
                        return Err(format!("Failed to check daemon status: {e}"));
                    }
                }
            }

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
                Ok(None) => true, // Still running
                _ => false,       // Exited or error
            }
        } else {
            false
        }
    }
}

fn get_daemon_path(app_handle: &AppHandle, is_dev: bool) -> Result<PathBuf, String> {
    if is_dev {
        // In dev mode, look for hld-dev in the project
        let current =
            env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?;

        // Handle both running from src-tauri and from humanlayer-wui
        let dev_path = if current.ends_with("src-tauri") {
            current
                .parent() // humanlayer-wui
                .and_then(|p| p.parent()) // humanlayer root
                .ok_or("Failed to get parent directory")?
                .join("hld")
                .join("hld-dev")
        } else {
            current
                .parent() // Go up from humanlayer-wui to humanlayer
                .ok_or("Failed to get parent directory")?
                .join("hld")
                .join("hld-dev")
        };

        if dev_path.exists() {
            Ok(dev_path)
        } else {
            Err(format!(
                "Development daemon not found at {dev_path:?}. Run 'make daemon-dev-build' first."
            ))
        }
    } else {
        // In production, use bundled binary
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {e}"))?;

        Ok(resource_dir.join("bin").join("hld"))
    }
}

async fn check_daemon_health(port: u16) -> Result<(), String> {
    let client = reqwest::Client::new();
    match client
        .get(format!("http://localhost:{port}/api/v1/health"))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => Ok(()),
        Ok(_) => Err("Daemon health check failed".to_string()),
        Err(e) => Err(format!("Failed to connect to daemon: {e}")),
    }
}

async fn wait_for_daemon(port: u16) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(10);

    while start.elapsed() < timeout {
        if check_daemon_health(port).await.is_ok() {
            return Ok(());
        }

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    Err("Daemon failed to start within 10 seconds".to_string())
}

#[derive(Debug)]
enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

fn extract_log_level(line: &str) -> LogLevel {
    // slog format includes level like: "2024-01-30T10:15:30Z INFO message"
    // or sometimes: "INFO[0001] message" for other loggers

    if line.contains(" ERROR ") || line.contains("ERROR[") {
        LogLevel::Error
    } else if line.contains(" WARN ") || line.contains("WARN[") {
        LogLevel::Warn
    } else if line.contains(" INFO ") || line.contains("INFO[") {
        LogLevel::Info
    } else if line.contains(" DEBUG ") || line.contains("DEBUG[") {
        LogLevel::Debug
    } else if line.contains(" TRACE ") || line.contains("TRACE[") {
        LogLevel::Trace
    } else {
        // Default to info for unparseable lines
        LogLevel::Info
    }
}

fn remove_timestamp(line: &str) -> &str {
    // Remove slog timestamp to avoid double timestamps
    // Format: "2024-01-30T10:15:30Z LEVEL message"
    if let Some(idx) = line.find(" INFO ") {
        &line[idx + 6..]
    } else if let Some(idx) = line.find(" ERROR ") {
        &line[idx + 7..]
    } else if let Some(idx) = line.find(" WARN ") {
        &line[idx + 6..]
    } else if let Some(idx) = line.find(" DEBUG ") {
        &line[idx + 7..]
    } else if let Some(idx) = line.find(" TRACE ") {
        &line[idx + 7..]
    } else {
        // Return original if no timestamp found
        line
    }
}
