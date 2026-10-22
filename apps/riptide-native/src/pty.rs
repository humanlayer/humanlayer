//! PTY (pseudo-terminal) management for integrated terminal support.
//!
//! This module provides Tauri commands for spawning and managing PTY sessions
//! that run in the user's shell environment. PTY output is streamed to the
//! webview via Tauri Channels for low-latency terminal rendering.
//!
//! PTY sessions survive panel close/reopen. The Channel can be detached and
//! reattached — output produced while detached is buffered in a ring buffer
//! and replayed on reattach.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use uuid::Uuid;

use crate::shell_env;

/// Maximum bytes to buffer while the Channel is detached (64 KB).
const RING_BUFFER_CAP: usize = 64 * 1024;

/// Event sent to the webview via Channel
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum PtyEvent {
    /// Raw output data from the PTY
    Output { data: Vec<u8> },
    /// PTY process exited
    Exit { code: Option<u32> },
}

/// Shared channel handle that can be swapped between attach/detach.
struct ChannelHandle {
    channel: Option<Channel<PtyEvent>>,
    /// Ring buffer for output produced while no channel is attached.
    ring: VecDeque<u8>,
}

impl ChannelHandle {
    fn new(channel: Channel<PtyEvent>) -> Self {
        Self {
            channel: Some(channel),
            ring: VecDeque::with_capacity(RING_BUFFER_CAP),
        }
    }

    /// Send data to the attached channel, or buffer it if detached.
    fn send_output(&mut self, data: &[u8]) -> Result<(), String> {
        if let Some(ref ch) = self.channel {
            ch.send(PtyEvent::Output {
                data: data.to_vec(),
            })
            .map_err(|e| e.to_string())
        } else {
            // Buffer data in ring, evicting oldest bytes if over capacity
            let space_needed = data.len();
            let available = RING_BUFFER_CAP.saturating_sub(self.ring.len());
            if space_needed > available {
                let to_drain = space_needed - available;
                self.ring.drain(..to_drain.min(self.ring.len()));
            }
            // If a single write exceeds the entire buffer, only keep the tail
            if data.len() > RING_BUFFER_CAP {
                self.ring.clear();
                self.ring.extend(&data[data.len() - RING_BUFFER_CAP..]);
            } else {
                self.ring.extend(data);
            }
            Ok(())
        }
    }

    fn send_exit(&self, code: Option<u32>) {
        if let Some(ref ch) = self.channel {
            let _ = ch.send(PtyEvent::Exit { code });
        }
    }

    /// Detach the current channel. Returns silently if already detached.
    fn detach(&mut self) {
        self.channel = None;
    }

    /// Attach a new channel and replay any buffered output.
    fn attach(&mut self, channel: Channel<PtyEvent>) {
        // Replay buffered output
        if !self.ring.is_empty() {
            let buffered: Vec<u8> = self.ring.drain(..).collect();
            let _ = channel.send(PtyEvent::Output { data: buffered });
        }
        self.channel = Some(channel);
    }
}

/// A running PTY session
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Writer handle for sending input to PTY
    writer: Box<dyn Write + Send>,
    /// Shared channel handle (swappable for attach/detach)
    channel_handle: Arc<Mutex<ChannelHandle>>,
}

/// Manager for all active PTY sessions
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn kill_all(&self) -> usize {
        let Ok(mut sessions) = self.sessions.lock() else {
            log::error!("Failed to lock PTY sessions for kill_all");
            return 0;
        };

        let count = sessions.len();
        for (pty_id, mut session) in sessions.drain() {
            kill_pty_session(&pty_id, &mut session);
        }
        count
    }
}

fn child_process_id(child: &mut Box<dyn Child + Send + Sync>) -> Option<u32> {
    child.process_id()
}

fn child_pids(parent_pid: u32) -> Vec<u32> {
    let output = Command::new("pgrep")
        .arg("-P")
        .arg(parent_pid.to_string())
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

fn signal_pid(pid: u32, signal: nix::sys::signal::Signal) {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;

    let _ = kill(Pid::from_raw(pid as i32), signal);
}

fn signal_descendants(parent_pid: u32, signal: nix::sys::signal::Signal) {
    for child_pid in child_pids(parent_pid) {
        signal_descendants(child_pid, signal);
        signal_pid(child_pid, signal);
    }
}

fn kill_pty_session(pty_id: &str, session: &mut PtySession) {
    if let Some(pid) = child_process_id(&mut session.child) {
        signal_descendants(pid, nix::sys::signal::Signal::SIGTERM);
    }

    session.child.kill().ok();

    if let Some(pid) = child_process_id(&mut session.child) {
        signal_descendants(pid, nix::sys::signal::Signal::SIGKILL);
    }

    log::info!("[PTY {}] Killed", pty_id);
}

/// Create a new PTY session in the given working directory.
/// Returns the PTY ID. Output is streamed via the provided Channel.
#[tauri::command]
pub fn pty_create(
    pty_manager: tauri::State<'_, PtyManager>,
    on_event: Channel<PtyEvent>,
    cwd: String,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    // The renderer resizes the shell to the fitted viewport after creation.
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let command_program = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // Expand leading ~ in the working directory so PTYs land in the right place.
    // portable-pty passes cwd straight to the OS, which does not expand tildes.
    let expanded_cwd = shellexpand::tilde(&cwd).to_string();

    // Build command with shell environment
    let mut cmd = CommandBuilder::new(&command_program);
    cmd.cwd(&expanded_cwd);

    // Apply user's shell environment if available
    let has_term = if let Some(env) = shell_env::get() {
        for (key, value) in env.iter() {
            cmd.env(key, value);
        }
        env.contains_key("TERM")
    } else {
        false
    };

    // Ensure TERM is set - required for shell/TUI apps to work correctly.
    // When launched from GUI (Finder/Dock), TERM is not inherited.
    // Only set default if user's shell environment doesn't already have TERM.
    if !has_term {
        cmd.env("TERM", "xterm-256color");
    }

    // Spawn the process
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn {}: {}", command_program, e))?;

    // Get writer for input
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    // Get reader for output
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    let pty_id = Uuid::new_v4().to_string();
    let pty_id_clone = pty_id.clone();

    let channel_handle = Arc::new(Mutex::new(ChannelHandle::new(on_event)));
    let reader_handle = Arc::clone(&channel_handle);

    // Spawn reader thread that streams output via Channel (or buffers if detached)
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF - PTY closed
                    log::info!("[PTY {}] Reader EOF", pty_id_clone);
                    let handle = reader_handle.lock().unwrap();
                    handle.send_exit(None);
                    break;
                }
                Ok(n) => {
                    let mut handle = reader_handle.lock().unwrap();
                    if let Err(e) = handle.send_output(&buf[..n]) {
                        log::warn!("[PTY {}] Failed to send output event: {}", pty_id_clone, e);
                        // Don't break — the channel may have been detached and
                        // will be reattached later. Data goes to ring buffer.
                    }
                }
                Err(e) => {
                    log::error!("[PTY {}] Read error: {}", pty_id_clone, e);
                    let handle = reader_handle.lock().unwrap();
                    handle.send_exit(None);
                    break;
                }
            }
        }
    });

    // Store session
    let session = PtySession {
        master: pair.master,
        child,
        writer,
        channel_handle,
    };

    pty_manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?
        .insert(pty_id.clone(), session);

    log::info!(
        "[PTY {}] Created {} in {}",
        pty_id,
        command_program,
        expanded_cwd
    );
    Ok(pty_id)
}

/// Attach a new Channel to an existing PTY session.
/// Replays any buffered output that was produced while detached.
#[tauri::command]
pub fn pty_attach(
    pty_manager: tauri::State<'_, PtyManager>,
    pty_id: String,
    on_event: Channel<PtyEvent>,
) -> Result<(), String> {
    let sessions = pty_manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;

    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("PTY {} not found", pty_id))?;

    let mut handle = session
        .channel_handle
        .lock()
        .map_err(|e| format!("Channel lock poisoned: {}", e))?;

    handle.attach(on_event);
    log::info!("[PTY {}] Channel attached", pty_id);
    Ok(())
}

/// Detach the Channel from a PTY session without killing it.
/// Output produced after detach is buffered and replayed on next attach.
#[tauri::command]
pub fn pty_detach(pty_manager: tauri::State<'_, PtyManager>, pty_id: String) -> Result<(), String> {
    let sessions = pty_manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;

    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("PTY {} not found", pty_id))?;

    let mut handle = session
        .channel_handle
        .lock()
        .map_err(|e| format!("Channel lock poisoned: {}", e))?;

    handle.detach();
    log::info!("[PTY {}] Channel detached", pty_id);
    Ok(())
}

/// Write input data to a PTY session.
#[tauri::command]
pub fn pty_write(
    pty_manager: tauri::State<'_, PtyManager>,
    pty_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut sessions = pty_manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;

    let session = sessions
        .get_mut(&pty_id)
        .ok_or_else(|| format!("PTY {} not found", pty_id))?;

    session
        .writer
        .write_all(&data)
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;

    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY: {}", e))?;

    Ok(())
}

/// Resize a PTY session to the given dimensions.
#[tauri::command]
pub fn pty_resize(
    pty_manager: tauri::State<'_, PtyManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = pty_manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;

    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("PTY {} not found", pty_id))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {}", e))?;

    log::debug!("[PTY {}] Resized to {}x{}", pty_id, cols, rows);
    Ok(())
}

/// Kill a PTY session and clean up resources.
#[tauri::command]
pub fn pty_kill(pty_manager: tauri::State<'_, PtyManager>, pty_id: String) -> Result<(), String> {
    let mut sessions = pty_manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;

    if let Some(mut session) = sessions.remove(&pty_id) {
        kill_pty_session(&pty_id, &mut session);
    }

    Ok(())
}

/// List all active PTY session IDs.
#[tauri::command]
pub fn pty_list(pty_manager: tauri::State<'_, PtyManager>) -> Result<Vec<String>, String> {
    let sessions = pty_manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;

    Ok(sessions.keys().cloned().collect())
}
