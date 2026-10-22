use crate::sentry as app_sentry;
use crate::shell_env;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
enum DaemonProcessEvent {
    #[serde(rename = "daemon_ready")]
    DaemonReady,
    #[serde(rename = "daemon_already_running")]
    DaemonAlreadyRunning { message: String },
    #[serde(rename = "auth_failure")]
    AuthFailure { message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedDaemonIdentity<'a> {
    user_id: &'a str,
    organization_id: &'a str,
    host_id: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DaemonLaunchResult {
    #[serde(rename = "daemon_ready")]
    DaemonReady,
    #[serde(rename = "daemon_already_running")]
    DaemonAlreadyRunning { message: String },
}

/// Event emitted to frontend when daemon dies unexpectedly
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonDiedEvent {
    pub user_id: String,
    pub organization_id: String,
    pub exit_code: Option<i32>,
    pub will_retry: bool,
    pub auth_failure_message: Option<String>,
}

type DaemonKey = (String, String); // (user_id, organization_id)

struct OwnedDaemonState {
    child: Child,
    generation: Uuid,
    token: String,
    has_retried: bool,
    sync_mode: String,
    verified_claude_path: Option<String>,
}

type SharedLaunchResult = Result<DaemonLaunchResult, String>;

#[derive(Clone)]
struct LaunchSignal {
    inner: Arc<(Mutex<Option<SharedLaunchResult>>, Condvar)>,
}

#[derive(Clone)]
struct ProcessSignal {
    inner: Arc<(Mutex<Option<Result<DaemonProcessEvent, String>>>, Condvar)>,
}

impl ProcessSignal {
    fn new() -> Self {
        Self {
            inner: Arc::new((Mutex::new(None), Condvar::new())),
        }
    }

    fn publish(&self, event: DaemonProcessEvent) {
        let (slot, ready) = &*self.inner;
        let mut slot = slot.lock().unwrap();
        if slot.is_none() || matches!(event, DaemonProcessEvent::AuthFailure { .. }) {
            *slot = Some(Ok(event));
            ready.notify_all();
        }
    }

    fn fail(&self, message: String) {
        let (slot, ready) = &*self.inner;
        let mut slot = slot.lock().unwrap();
        if slot.is_none() {
            *slot = Some(Err(message));
            ready.notify_all();
        }
    }

    fn event(&self) -> Option<Result<DaemonProcessEvent, String>> {
        self.inner.0.lock().unwrap().clone()
    }
}

impl LaunchSignal {
    fn new() -> Self {
        Self {
            inner: Arc::new((Mutex::new(None), Condvar::new())),
        }
    }

    fn complete(&self, result: SharedLaunchResult) {
        let (result_slot, ready) = &*self.inner;
        let mut result_slot = result_slot.lock().unwrap_or_else(PoisonError::into_inner);
        if result_slot.is_none() {
            *result_slot = Some(result);
            ready.notify_all();
        }
    }

    #[cfg(test)]
    fn result(&self) -> Option<SharedLaunchResult> {
        self.inner.0.lock().unwrap().clone()
    }

    fn wait_for(&self, timeout: Duration) -> SharedLaunchResult {
        let deadline = Instant::now() + timeout;
        let (result_slot, ready) = &*self.inner;
        let mut result_slot = result_slot.lock().unwrap();
        loop {
            if let Some(result) = result_slot.clone() {
                return result;
            }
            let now = Instant::now();
            if now >= deadline {
                return Err("Timed out waiting for daemon launch result".to_string());
            }
            let wait = deadline.saturating_duration_since(now);
            let (next_slot, wait_result) = ready.wait_timeout(result_slot, wait).unwrap();
            result_slot = next_slot;
            if wait_result.timed_out() && result_slot.is_none() {
                return Err("Timed out waiting for daemon launch result".to_string());
            }
        }
    }
}

enum DaemonState {
    Starting {
        generation: Uuid,
        launch_signal: LaunchSignal,
        cancelled: Arc<AtomicBool>,
        verified_claude_path: Option<String>,
    },
    Owned(OwnedDaemonState),
    Stopping {
        generation: Uuid,
        stopped: StopSignal,
    },
}

impl DaemonState {
    fn is_starting(&self, generation: Uuid) -> bool {
        matches!(self, Self::Starting { generation: current, .. } if *current == generation)
    }

    fn is_stopping(&self, generation: Uuid) -> bool {
        matches!(self, Self::Stopping { generation: current, .. } if *current == generation)
    }
}

#[derive(Clone)]
struct StopSignal {
    inner: Arc<(Mutex<bool>, Condvar)>,
}

impl StopSignal {
    fn new() -> Self {
        Self {
            inner: Arc::new((Mutex::new(false), Condvar::new())),
        }
    }

    fn complete(&self) {
        let (stopped, ready) = &*self.inner;
        *stopped.lock().unwrap_or_else(PoisonError::into_inner) = true;
        ready.notify_all();
    }

    fn wait_for(&self, timeout: Duration) -> bool {
        let (stopped, ready) = &*self.inner;
        let stopped = stopped.lock().unwrap_or_else(PoisonError::into_inner);
        let (stopped, _) = ready
            .wait_timeout_while(stopped, timeout, |stopped| !*stopped)
            .unwrap_or_else(PoisonError::into_inner);
        *stopped
    }
}

fn remove_entry_in_state(
    daemons: &Mutex<HashMap<DaemonKey, DaemonState>>,
    key: &DaemonKey,
    is_this_entry: impl Fn(&DaemonState) -> bool,
) {
    let mut daemons = daemons.lock().unwrap_or_else(PoisonError::into_inner);
    if daemons.get(key).is_some_and(is_this_entry) {
        daemons.remove(key);
    }
}

struct StoppingEntry<'a> {
    daemons: &'a Mutex<HashMap<DaemonKey, DaemonState>>,
    key: DaemonKey,
    generation: Uuid,
    stopped: StopSignal,
}

impl Drop for StoppingEntry<'_> {
    fn drop(&mut self) {
        remove_entry_in_state(self.daemons, &self.key, |state| {
            state.is_stopping(self.generation)
        });
        self.stopped.complete();
    }
}

struct StartingEntry<'a> {
    daemons: &'a Mutex<HashMap<DaemonKey, DaemonState>>,
    key: DaemonKey,
    generation: Uuid,
    launch_signal: LaunchSignal,
}

impl Drop for StartingEntry<'_> {
    fn drop(&mut self) {
        remove_entry_in_state(self.daemons, &self.key, |state| {
            state.is_starting(self.generation)
        });
        self.launch_signal
            .complete(Err("Daemon launch ended without a result".to_string()));
    }
}

const DAEMON_LAUNCH_TIMEOUT: Duration = Duration::from_secs(45);
const DAEMON_GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(5);
const DAEMON_FORCE_STOP_MARGIN: Duration = Duration::from_secs(2);
const DAEMON_STOP_SETTLED_TIMEOUT: Duration =
    DAEMON_GRACEFUL_STOP_TIMEOUT.saturating_add(DAEMON_FORCE_STOP_MARGIN);
const DAEMON_LAUNCH_CLEANUP_MARGIN: Duration = Duration::from_secs(5);
const DAEMON_SETTLED_WAIT_TIMEOUT: Duration = DAEMON_STOP_SETTLED_TIMEOUT
    .saturating_add(DAEMON_LAUNCH_TIMEOUT)
    .saturating_add(DAEMON_LAUNCH_CLEANUP_MARGIN);
const DAEMON_QUIT_TIMEOUT: Duration = DAEMON_STOP_SETTLED_TIMEOUT;
const DAEMON_AUTH_FAILURE_PREFIX: &str = "Daemon authentication failed: ";
const DAEMON_MANAGEMENT_DISABLED_MESSAGE: &str =
    "Daemon launch cancelled: local daemon is turned off";

fn normalize_build_type(
    build_type: Option<&str>,
    debug_build: bool,
) -> Result<&'static str, String> {
    match build_type {
        Some("local") => Ok("local"),
        Some("dev") => Ok("dev"),
        Some("beta") => Ok("beta"),
        Some("prod") | Some("stable") => Ok("prod"),
        None if debug_build => Ok("local"),
        None => Ok("prod"),
        Some(value) => Err(format!("Unsupported compiled daemon build type: {value}")),
    }
}

fn compiled_daemon_stage() -> Result<&'static str, String> {
    normalize_build_type(option_env!("BUILD_TYPE"), cfg!(debug_assertions))
}

fn apply_launcher_controlled_daemon_identity_environment(
    daemon_env: &mut Vec<(String, String)>,
    token: &str,
    expected_identity: String,
    generation: Uuid,
) {
    daemon_env.retain(|(name, _)| {
        name != "DAEMON_IDENTITY"
            && name != "RIPTIDE_DAEMON_EXPECTED_IDENTITY"
            && name != "RIPTIDE_DAEMON_GENERATION_ID"
    });
    daemon_env.push(("DAEMON_IDENTITY".to_string(), token.to_string()));
    daemon_env.push((
        "RIPTIDE_DAEMON_EXPECTED_IDENTITY".to_string(),
        expected_identity,
    ));
    daemon_env.push((
        "RIPTIDE_DAEMON_GENERATION_ID".to_string(),
        generation.to_string(),
    ));
}

#[derive(Clone)]
pub struct DaemonManager {
    daemons: Arc<Mutex<HashMap<DaemonKey, DaemonState>>>,
    host_id: Arc<Mutex<Option<String>>>,
    is_shutting_down: Arc<Mutex<bool>>,
    /// Set while the local daemon setting is off: no new starts and no automatic restarts.
    management_disabled: Arc<AtomicBool>,
    /// Serializes management changes so an older enable cannot run after a newer disable.
    management_policy: Arc<Mutex<()>>,
}

fn create_daemon_log_file(user_id: &str, org_id: &str) -> Option<File> {
    let log_dir = crate::logging::get_log_base_dir();
    let timestamp = crate::logging::get_boot_timestamp();

    // Sanitize user_id and org_id for filename safety
    let safe_user = user_id.replace(|c: char| !c.is_alphanumeric() && c != '-', "_");
    let safe_org = org_id.replace(|c: char| !c.is_alphanumeric() && c != '-', "_");

    let log_path = log_dir.join(format!(
        "riptide-daemon-{}-{}-{}.log",
        safe_user, safe_org, timestamp
    ));

    match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(file) => {
            log::info!("Daemon logs will be written to: {:?}", log_path);
            Some(file)
        }
        Err(e) => {
            log::error!("Failed to create daemon log file {:?}: {}", log_path, e);
            None
        }
    }
}

fn consume_daemon_output<R: Read + Send + 'static>(
    stream: R,
    stream_name: &'static str,
    app_handle: AppHandle,
    daemons: Arc<Mutex<HashMap<DaemonKey, DaemonState>>>,
    key: DaemonKey,
    generation: Uuid,
    process_signal: ProcessSignal,
    open_streams: Arc<AtomicUsize>,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        let mut file = create_daemon_log_file(&key.0, &key.1);

        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if let Some(ref mut file) = file {
                        let timestamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
                        let _ = writeln!(file, "[{}] [{}] {}", timestamp, stream_name, line);
                        let _ = file.flush();
                    }

                    if stream_name == "stderr" {
                        log::info!("[Daemon {}/{}] {}", key.0, key.1, line);
                    } else {
                        log::trace!("[Daemon {}/{}] stdout: {}", key.0, key.1, line);
                    }

                    let Ok(event) = serde_json::from_str::<DaemonProcessEvent>(&line) else {
                        continue;
                    };
                    let auth_message = match &event {
                        DaemonProcessEvent::AuthFailure { message } => Some(message.clone()),
                        _ => None,
                    };
                    let removed_owned = {
                        let mut daemons = daemons.lock().unwrap();
                        match daemons.get(&key) {
                            Some(DaemonState::Starting {
                                generation: current,
                                ..
                            }) if *current == generation => {
                                process_signal.publish(event);
                                None
                            }
                            Some(DaemonState::Owned(state))
                                if state.generation == generation && auth_message.is_some() =>
                            {
                                let Some(DaemonState::Owned(state)) = daemons.remove(&key) else {
                                    unreachable!()
                                };
                                Some(state)
                            }
                            Some(DaemonState::Owned(state)) if state.generation == generation => {
                                process_signal.publish(event);
                                None
                            }
                            _ => continue,
                        }
                    };
                    if let (Some(mut state), Some(message)) = (removed_owned, auth_message) {
                        log::warn!("Detected auth failure, terminating owned daemon");
                        DaemonManager::terminate_candidate(&mut state.child);
                        let event = DaemonDiedEvent {
                            user_id: key.0.clone(),
                            organization_id: key.1.clone(),
                            exit_code: None,
                            will_retry: false,
                            auth_failure_message: Some(message),
                        };
                        if let Err(error) = app_handle.emit("daemon-died", &event) {
                            log::error!(
                                "Failed to emit daemon-died event for auth failure: {}",
                                error
                            );
                        }
                    }
                }
                Err(error) => {
                    log::debug!("Daemon {} closed: {}", stream_name, error);
                    break;
                }
            }
        }

        if open_streams.fetch_sub(1, Ordering::AcqRel) == 1 {
            process_signal
                .fail("Daemon output closed before a launch result was received".to_string());
        }
    });
}

impl DaemonManager {
    pub fn new() -> Self {
        Self {
            daemons: Arc::new(Mutex::new(HashMap::new())),
            host_id: Arc::new(Mutex::new(None)),
            is_shutting_down: Arc::new(Mutex::new(false)),
            management_disabled: Arc::new(AtomicBool::new(false)),
            management_policy: Arc::new(Mutex::new(())),
        }
    }

    fn is_management_disabled(&self) -> bool {
        self.management_disabled.load(Ordering::Acquire)
    }

    fn get_host_id_path() -> PathBuf {
        let home = dirs::home_dir().expect("Failed to get home directory");
        let riptide_dir = home.join(".humanlayer").join("riptide");
        match env::var("DEVSTACK_ID")
            .ok()
            .filter(|value| !value.is_empty())
        {
            Some(stack_id) => riptide_dir.join(format!("host_id_{}", stack_id)),
            None => riptide_dir.join("host_id"),
        }
    }

    pub fn get_or_create_host_id(&self) -> Result<String, String> {
        let mut host_id_guard = self.host_id.lock().unwrap();

        if let Some(ref id) = *host_id_guard {
            return Ok(id.clone());
        }

        let path = Self::get_host_id_path();

        // Ensure directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Try to read existing host_id
        if path.exists() {
            if let Ok(contents) = fs::read_to_string(&path) {
                let id = contents.trim().to_string();
                if !id.is_empty() {
                    *host_id_guard = Some(id.clone());
                    log::info!("Loaded existing host_id: {}", id);
                    return Ok(id);
                }
            }
        }

        // Generate new host_id
        let new_id = Uuid::new_v4().to_string();
        fs::write(&path, &new_id).map_err(|e| format!("Failed to write host_id: {}", e))?;

        *host_id_guard = Some(new_id.clone());
        log::info!("Generated new host_id: {}", new_id);

        Ok(new_id)
    }

    /// Start health monitoring thread that checks daemon processes
    pub fn start_health_monitor(&self, app_handle: AppHandle) {
        let manager = self.clone();

        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(5));

                // Check if we're shutting down
                if *manager.is_shutting_down.lock().unwrap() {
                    log::info!("Health monitor stopping due to shutdown");
                    break;
                }

                // Check each daemon
                let mut dead_daemons: Vec<(
                    DaemonKey,
                    Option<i32>,
                    String,
                    String,
                    Option<String>,
                    bool,
                )> = Vec::new();

                {
                    let mut daemons = manager.daemons.lock().unwrap();
                    for (key, state) in daemons.iter_mut() {
                        let DaemonState::Owned(state) = state else {
                            continue;
                        };
                        match state.child.try_wait() {
                            Ok(Some(status)) => {
                                // Daemon exited
                                let exit_code = status.code();
                                log::warn!(
                                    "Daemon for user={}, org={} died with exit code: {:?}",
                                    key.0,
                                    key.1,
                                    exit_code
                                );
                                app_sentry::capture_error(
                                    &format!(
                                        "Daemon died unexpectedly with exit code: {:?}",
                                        exit_code
                                    ),
                                    Some("daemon_health_monitor"),
                                );
                                dead_daemons.push((
                                    key.clone(),
                                    exit_code,
                                    state.token.clone(),
                                    state.sync_mode.clone(),
                                    state.verified_claude_path.clone(),
                                    state.has_retried,
                                ));
                            }
                            Ok(None) => {
                                // Still running
                            }
                            Err(e) => {
                                log::error!("Error checking daemon status: {}", e);
                            }
                        }
                    }

                    // Remove dead daemons from map
                    for (key, _, _, _, _, _) in &dead_daemons {
                        daemons.remove(key);
                    }
                }

                // Handle dead daemons - emit events and optionally retry
                for (key, exit_code, token, sync_mode, verified_claude_path, has_retried) in
                    dead_daemons
                {
                    if manager.is_management_disabled() {
                        continue;
                    }
                    let will_retry = !has_retried;

                    // Emit event to frontend
                    let event = DaemonDiedEvent {
                        user_id: key.0.clone(),
                        organization_id: key.1.clone(),
                        exit_code,
                        will_retry,
                        auth_failure_message: None,
                    };

                    if let Err(e) = app_handle.emit("daemon-died", &event) {
                        log::error!("Failed to emit daemon-died event: {}", e);
                    }

                    // Attempt restart if we haven't retried yet
                    if will_retry {
                        log::info!(
                            "Attempting to restart daemon for user={}, org={}",
                            key.0,
                            key.1
                        );

                        match manager.start_daemon_internal(
                            &app_handle,
                            &token,
                            &key.0,
                            &key.1,
                            &sync_mode,
                            verified_claude_path.as_deref(),
                            true, // mark as retried
                        ) {
                            Ok(DaemonLaunchResult::DaemonReady) => {
                                log::info!(
                                    "Successfully restarted daemon after readiness acknowledgement"
                                );
                            }
                            Ok(DaemonLaunchResult::DaemonAlreadyRunning { message }) => {
                                log::info!(
                                    "Restart handed off to an already-running daemon: {}",
                                    message
                                );
                            }
                            Err(e) => {
                                log::error!("Failed to restart daemon: {}", e);
                                app_sentry::capture_error(
                                    &format!("Failed to restart daemon: {}", e),
                                    Some("daemon_restart"),
                                );
                                if *manager.is_shutting_down.lock().unwrap()
                                    || manager.is_management_disabled()
                                    || e.starts_with(DAEMON_AUTH_FAILURE_PREFIX)
                                {
                                    continue;
                                }
                                let terminal_event = DaemonDiedEvent {
                                    user_id: key.0.clone(),
                                    organization_id: key.1.clone(),
                                    exit_code: None,
                                    will_retry: false,
                                    auth_failure_message: None,
                                };
                                if let Err(error) = app_handle.emit("daemon-died", &terminal_event)
                                {
                                    log::error!(
                                        "Failed to emit terminal daemon-died event: {}",
                                        error
                                    );
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    /// Mark manager as shutting down to prevent health monitor from restarting daemons
    pub fn set_shutting_down(&self) {
        let _daemons = self.daemons.lock().unwrap();
        *self.is_shutting_down.lock().unwrap() = true;
    }

    fn start_daemon_internal(
        &self,
        app_handle: &AppHandle,
        token: &str,
        user_id: &str,
        organization_id: &str,
        sync_mode: &str,
        verified_claude_path: Option<&str>,
        is_retry: bool,
    ) -> Result<DaemonLaunchResult, String> {
        if let Some(path) = verified_claude_path {
            validate_executable(path)?;
        }
        if *self.is_shutting_down.lock().unwrap() {
            return Err("Cannot start daemon while shutting down".to_string());
        }
        if self.is_management_disabled() {
            return Err(DAEMON_MANAGEMENT_DISABLED_MESSAGE.to_string());
        }
        let key = (user_id.to_string(), organization_id.to_string());
        let (
            generation,
            launch_signal,
            cancelled,
            should_spawn,
            joined_launch_claude_path_differs,
            replaced_daemon,
        ) = {
            let mut daemons = self.daemons.lock().unwrap();
            if *self.is_shutting_down.lock().unwrap() {
                return Err("Cannot start daemon while shutting down".to_string());
            }
            if self.is_management_disabled() {
                return Err(DAEMON_MANAGEMENT_DISABLED_MESSAGE.to_string());
            }
            if let Some(DaemonState::Stopping { stopped, .. }) = daemons.get(&key) {
                let stopped = stopped.clone();
                drop(daemons);
                if !stopped.wait_for(DAEMON_STOP_SETTLED_TIMEOUT) {
                    return Err("Timed out waiting for the previous daemon to stop".to_string());
                }
                return self.start_daemon_internal(
                    app_handle,
                    token,
                    user_id,
                    organization_id,
                    sync_mode,
                    verified_claude_path,
                    is_retry,
                );
            }
            let mut remove_dead_owned = false;
            let mut replace_owned = false;
            let existing_launch = if let Some(state) = daemons.get_mut(&key) {
                match state {
                    DaemonState::Starting {
                        generation,
                        launch_signal,
                        cancelled,
                        verified_claude_path: launching_claude_path,
                    } => Some((
                        *generation,
                        launch_signal.clone(),
                        cancelled.clone(),
                        launching_claude_path.as_deref() != verified_claude_path,
                    )),
                    DaemonState::Owned(state) => match state.child.try_wait() {
                        Ok(None) => {
                            if state.verified_claude_path
                                != verified_claude_path.map(str::to_string)
                            {
                                log::info!(
                                    "Verified Claude path changed; replacing daemon for user={}, org={}",
                                    user_id,
                                    organization_id
                                );
                                replace_owned = true;
                                None
                            } else {
                                state.sync_mode = sync_mode.to_string();
                                log::info!(
                                    "Owned daemon already running for user={}, org={}",
                                    user_id,
                                    organization_id
                                );
                                return Ok(DaemonLaunchResult::DaemonReady);
                            }
                        }
                        Ok(Some(status)) => {
                            log::warn!("Previous owned daemon exited with status: {:?}", status);
                            remove_dead_owned = true;
                            None
                        }
                        Err(error) => {
                            log::error!("Error checking owned daemon status: {}", error);
                            remove_dead_owned = true;
                            None
                        }
                    },
                    DaemonState::Stopping { .. } => {
                        unreachable!("stopping daemon state is joined before this match")
                    }
                }
            } else {
                None
            };
            if remove_dead_owned {
                daemons.remove(&key);
            }
            let replaced_daemon = if replace_owned {
                match daemons.remove(&key) {
                    Some(DaemonState::Owned(state)) => Some(state.child),
                    _ => None,
                }
            } else {
                None
            };

            if let Some((generation, launch_signal, cancelled, claude_path_differs)) =
                existing_launch
            {
                (
                    generation,
                    launch_signal,
                    cancelled,
                    false,
                    claude_path_differs,
                    None,
                )
            } else {
                let generation = Uuid::new_v4();
                let launch_signal = LaunchSignal::new();
                let cancelled = Arc::new(AtomicBool::new(false));
                daemons.insert(
                    key.clone(),
                    DaemonState::Starting {
                        generation,
                        launch_signal: launch_signal.clone(),
                        cancelled: cancelled.clone(),
                        verified_claude_path: verified_claude_path.map(str::to_string),
                    },
                );
                (
                    generation,
                    launch_signal,
                    cancelled,
                    true,
                    false,
                    replaced_daemon,
                )
            }
        };

        let _starting_entry = should_spawn.then(|| StartingEntry {
            daemons: &self.daemons,
            key: key.clone(),
            generation,
            launch_signal: launch_signal.clone(),
        });

        if let Some(mut replaced_daemon) = replaced_daemon {
            if let Err(error) = Self::stop_daemon_process(&mut replaced_daemon) {
                log::warn!("Failed to stop replaced daemon: {}", error);
            }
        }

        if !should_spawn {
            let joined_result = launch_signal.wait_for(DAEMON_SETTLED_WAIT_TIMEOUT);
            if joined_launch_claude_path_differs
                && matches!(joined_result, Ok(DaemonLaunchResult::DaemonReady))
            {
                return self.start_daemon_internal(
                    app_handle,
                    token,
                    user_id,
                    organization_id,
                    sync_mode,
                    verified_claude_path,
                    is_retry,
                );
            }
            return joined_result;
        }

        let fail_start = |message: String| {
            let mut daemons = self.daemons.lock().unwrap();
            if matches!(
                daemons.get(&key),
                Some(DaemonState::Starting { generation: current, .. }) if *current == generation
            ) {
                daemons.remove(&key);
            }
            drop(daemons);
            launch_signal.complete(Err(message.clone()));
            message
        };

        // Get daemon binary path
        let daemon_path = self.get_daemon_path(app_handle).map_err(&fail_start)?;
        log::info!("Starting daemon from: {:?}", daemon_path);

        // Build environment for daemon
        // Priority: shell environment (from user's login shell) > process environment
        // This ensures the daemon has access to PATH and other vars from .zshrc, .bash_profile, etc.
        let mut daemon_env: Vec<(String, String)> = if let Some(shell_env) = shell_env::get() {
            log::info!("Using shell environment for daemon");
            shell_env
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        } else {
            log::info!("Falling back to process environment for daemon");
            env::vars().collect()
        };

        for name in [
            "DEVSTACK_ID",
            "RIPTIDE_API_ORIGIN",
            "RIPTIDE_SYNC_ORIGIN",
            "RIPTIDE_APP_ORIGIN",
            "RIPTIDE_DAEMON_API_ORIGIN",
            "RIPTIDE_DAEMON_SYNC_ORIGIN",
            "RIPTIDE_DAEMON_CLOUD_ORIGIN",
            "RIPTIDE_DAEMON_APP_ORIGIN",
        ] {
            if let Ok(value) = env::var(name) {
                daemon_env.retain(|(key, _)| key != name);
                daemon_env.push((name.to_string(), value));
            }
        }

        let daemon_stage = compiled_daemon_stage().map_err(&fail_start)?;
        daemon_env.retain(|(name, _)| name != "RIPTIDE_DAEMON_CHANNEL");
        daemon_env.push((
            "RIPTIDE_DAEMON_CHANNEL".to_string(),
            daemon_stage.to_string(),
        ));

        let host_id = self.get_or_create_host_id().map_err(&fail_start)?;
        let expected_identity = serde_json::to_string(&ExpectedDaemonIdentity {
            user_id,
            organization_id,
            host_id: &host_id,
        })
        .map_err(|error| {
            fail_start(format!(
                "Failed to serialize expected daemon identity: {error}"
            ))
        })?;

        // Add launcher-controlled daemon identity values.
        apply_launcher_controlled_daemon_identity_environment(
            &mut daemon_env,
            token,
            expected_identity,
            generation,
        );
        daemon_env.push((
            "RIPTIDE_DAEMON_USE_ORPHAN_DETECTION".to_string(),
            "1".to_string(),
        ));

        // Trust system CA certificates so corporate network CAs are always trusted
        // This is read by Bun's TLS runtime at process startup (NODE_USE_SYSTEM_CA=1)
        daemon_env.push(("NODE_USE_SYSTEM_CA".to_string(), "1".to_string()));
        if let Some(path) = verified_claude_path {
            daemon_env.retain(|(key, _)| key != "HUMANLAYER_CLAUDE_PATH");
            daemon_env.push(("HUMANLAYER_CLAUDE_PATH".to_string(), path.to_string()));
        }

        // Set max concurrent outbound HTTP connections for Bun (default is 256)
        daemon_env.push((
            "BUN_CONFIG_MAX_HTTP_REQUESTS".to_string(),
            "1000".to_string(),
        ));

        // Log the PATH being passed to daemon for debugging
        if let Some((_, path)) = daemon_env.iter().find(|(k, _)| k == "PATH") {
            log::info!("Daemon PATH: {}", path);
        }

        log::info!(
            "Starting daemon for user={}, org={} with sync mode={}",
            user_id,
            organization_id,
            sync_mode
        );

        let child_result = {
            let daemons = self.daemons.lock().unwrap();
            let shutting_down = *self.is_shutting_down.lock().unwrap();
            let is_current_candidate = matches!(
                daemons.get(&key),
                Some(DaemonState::Starting { generation: current, .. }) if *current == generation
            );
            if shutting_down
                || self.is_management_disabled()
                || cancelled.load(Ordering::Acquire)
                || !is_current_candidate
            {
                drop(daemons);
                return Err(fail_start(
                    "Daemon launch cancelled before spawn".to_string(),
                ));
            }

            Command::new(&daemon_path)
                .env_clear() // Clear inherited env to use our explicit set
                .envs(daemon_env)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| {
                    let message = format!("Failed to spawn daemon: {error}");
                    app_sentry::capture_error(&message, Some("daemon_spawn"));
                    message
                })
        };
        let mut child = child_result.map_err(&fail_start)?;

        let pid = child.id();
        log::info!("Daemon spawned with PID: {}", pid);

        let open_streams = Arc::new(AtomicUsize::new(2));
        let process_signal = ProcessSignal::new();
        if let Some(stderr) = child.stderr.take() {
            consume_daemon_output(
                stderr,
                "stderr",
                app_handle.clone(),
                self.daemons.clone(),
                key.clone(),
                generation,
                process_signal.clone(),
                open_streams.clone(),
            );
        } else {
            open_streams.fetch_sub(1, Ordering::AcqRel);
        }

        if let Some(stdout) = child.stdout.take() {
            consume_daemon_output(
                stdout,
                "stdout",
                app_handle.clone(),
                self.daemons.clone(),
                key.clone(),
                generation,
                process_signal.clone(),
                open_streams.clone(),
            );
        } else if open_streams.fetch_sub(1, Ordering::AcqRel) == 1 {
            process_signal
                .fail("Daemon output closed before a launch result was received".to_string());
        }

        let deadline = Instant::now() + DAEMON_LAUNCH_TIMEOUT;
        let mut auth_failure_message = None;
        let launch_result = loop {
            if cancelled.load(Ordering::Acquire)
                || self.is_management_disabled()
                || *self.is_shutting_down.lock().unwrap()
            {
                break Err("Daemon launch cancelled".to_string());
            }
            if let Some(event) = process_signal.event() {
                break match event {
                    Ok(DaemonProcessEvent::DaemonReady) => Ok(DaemonLaunchResult::DaemonReady),
                    Ok(DaemonProcessEvent::DaemonAlreadyRunning { message }) => {
                        Ok(DaemonLaunchResult::DaemonAlreadyRunning { message })
                    }
                    Ok(DaemonProcessEvent::AuthFailure { message }) => {
                        auth_failure_message = Some(message.clone());
                        Err(format!("{DAEMON_AUTH_FAILURE_PREFIX}{message}"))
                    }
                    Err(message) => Err(message),
                };
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    break Err(format!(
                        "Daemon exited before reporting a launch result: {status}"
                    ));
                }
                Ok(None) => {}
                Err(error) => {
                    break Err(format!("Failed to inspect daemon candidate: {error}"));
                }
            }
            if Instant::now() >= deadline {
                break Err("Timed out waiting for daemon launch result".to_string());
            }
            std::thread::sleep(Duration::from_millis(25));
        };

        match launch_result {
            Ok(DaemonLaunchResult::DaemonReady) => {
                match child.try_wait() {
                    Ok(None) => {}
                    Ok(Some(status)) => {
                        let message =
                            format!("Daemon exited after readiness before promotion: {status}");
                        let mut daemons = self.daemons.lock().unwrap();
                        if matches!(
                            daemons.get(&key),
                            Some(DaemonState::Starting { generation: current, .. }) if *current == generation
                        ) {
                            daemons.remove(&key);
                        }
                        drop(daemons);
                        launch_signal.complete(Err(message.clone()));
                        return Err(message);
                    }
                    Err(error) => {
                        let message = format!("Failed to verify ready daemon liveness: {error}");
                        Self::terminate_candidate(&mut child);
                        let mut daemons = self.daemons.lock().unwrap();
                        if matches!(
                            daemons.get(&key),
                            Some(DaemonState::Starting { generation: current, .. }) if *current == generation
                        ) {
                            daemons.remove(&key);
                        }
                        drop(daemons);
                        launch_signal.complete(Err(message.clone()));
                        return Err(message);
                    }
                }
                let mut daemons = self.daemons.lock().unwrap();
                let superseding_auth_message = match process_signal.event() {
                    Some(Ok(DaemonProcessEvent::AuthFailure { message })) => Some(message),
                    _ => None,
                };
                if let Some(message) = superseding_auth_message {
                    if matches!(
                        daemons.get(&key),
                        Some(DaemonState::Starting { generation: current, .. }) if *current == generation
                    ) {
                        daemons.remove(&key);
                    }
                    drop(daemons);
                    Self::terminate_candidate(&mut child);
                    let event = DaemonDiedEvent {
                        user_id: key.0.clone(),
                        organization_id: key.1.clone(),
                        exit_code: None,
                        will_retry: false,
                        auth_failure_message: Some(message.clone()),
                    };
                    if let Err(error) = app_handle.emit("daemon-died", &event) {
                        log::error!("Failed to emit pre-ready auth failure: {}", error);
                    }
                    let failure = format!("{DAEMON_AUTH_FAILURE_PREFIX}{message}");
                    launch_signal.complete(Err(failure.clone()));
                    return Err(failure);
                }
                let is_current_candidate = matches!(
                    daemons.get(&key),
                    Some(DaemonState::Starting { generation: current, .. }) if *current == generation
                ) && !cancelled.load(Ordering::Acquire)
                    && !self.is_management_disabled()
                    && !*self.is_shutting_down.lock().unwrap();
                if !is_current_candidate {
                    drop(daemons);
                    Self::terminate_candidate(&mut child);
                    let message = "Daemon candidate lost its starting state".to_string();
                    launch_signal.complete(Err(message.clone()));
                    return Err(message);
                }
                daemons.insert(
                    key,
                    DaemonState::Owned(OwnedDaemonState {
                        child,
                        generation,
                        token: token.to_string(),
                        has_retried: is_retry,
                        sync_mode: sync_mode.to_string(),
                        verified_claude_path: verified_claude_path.map(str::to_string),
                    }),
                );
                log::info!("Daemon PID {} acknowledged readiness", pid);
                launch_signal.complete(Ok(DaemonLaunchResult::DaemonReady));
                Ok(DaemonLaunchResult::DaemonReady)
            }
            Ok(result @ DaemonLaunchResult::DaemonAlreadyRunning { .. }) => {
                Self::wait_for_candidate_exit(&mut child);
                let mut daemons = self.daemons.lock().unwrap();
                let is_current_candidate = matches!(
                    daemons.get(&key),
                    Some(DaemonState::Starting { generation: current, .. }) if *current == generation
                );
                if is_current_candidate {
                    daemons.remove(&key);
                }
                let was_cancelled = cancelled.load(Ordering::Acquire)
                    || self.is_management_disabled()
                    || *self.is_shutting_down.lock().unwrap()
                    || !is_current_candidate;
                drop(daemons);
                if was_cancelled {
                    let message = "Daemon launch cancelled".to_string();
                    launch_signal.complete(Err(message.clone()));
                    return Err(message);
                }
                launch_signal.complete(Ok(result.clone()));
                Ok(result)
            }
            Err(message) => {
                Self::terminate_candidate(&mut child);
                let mut daemons = self.daemons.lock().unwrap();
                if matches!(
                    daemons.get(&key),
                    Some(DaemonState::Starting { generation: current, .. }) if *current == generation
                ) {
                    daemons.remove(&key);
                }
                drop(daemons);
                if let Some(auth_failure_message) = auth_failure_message {
                    let event = DaemonDiedEvent {
                        user_id: key.0.clone(),
                        organization_id: key.1.clone(),
                        exit_code: None,
                        will_retry: false,
                        auth_failure_message: Some(auth_failure_message),
                    };
                    if let Err(error) = app_handle.emit("daemon-died", &event) {
                        log::error!("Failed to emit pre-ready auth failure: {}", error);
                    }
                }
                launch_signal.complete(Err(message.clone()));
                Err(message)
            }
        }
    }

    fn wait_for_candidate_exit(child: &mut Child) {
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(25)),
                Err(_) => break,
            }
        }
        Self::terminate_candidate(child);
    }

    fn terminate_candidate(child: &mut Child) {
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;
            let _ = kill(Pid::from_raw(child.id() as i32), Signal::SIGTERM);
            let deadline = Instant::now() + Duration::from_secs(1);
            while Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) => std::thread::sleep(Duration::from_millis(25)),
                    Err(_) => break,
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    pub fn start_daemon(
        &self,
        app_handle: &AppHandle,
        token: &str,
        user_id: &str,
        organization_id: &str,
        sync_mode: &str,
        verified_claude_path: Option<&str>,
    ) -> Result<DaemonLaunchResult, String> {
        self.start_daemon_internal(
            app_handle,
            token,
            user_id,
            organization_id,
            sync_mode,
            verified_claude_path,
            false,
        )
    }

    fn get_daemon_path(&self, app_handle: &AppHandle) -> Result<PathBuf, String> {
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;

        Ok(resource_dir.join("bin").join("riptided"))
    }

    pub fn stop_daemon(&self, user_id: &str, organization_id: &str) -> Result<(), String> {
        let key = (user_id.to_string(), organization_id.to_string());

        let mut daemons = self.daemons.lock().unwrap();
        let (pending_launch, pending_stop) = match daemons.get(&key) {
            Some(DaemonState::Starting {
                launch_signal,
                cancelled,
                ..
            }) => (Some((launch_signal.clone(), cancelled.clone())), None),
            Some(DaemonState::Stopping { stopped, .. }) => (None, Some(stopped.clone())),
            Some(DaemonState::Owned(_)) | None => (None, None),
        };
        if let Some((launch_signal, cancelled)) = pending_launch {
            cancelled.store(true, Ordering::Release);
            drop(daemons);
            let _ = launch_signal.wait_for(DAEMON_SETTLED_WAIT_TIMEOUT);
            return Ok(());
        }
        if let Some(stopped) = pending_stop {
            drop(daemons);
            stopped.wait_for(DAEMON_STOP_SETTLED_TIMEOUT);
            return Ok(());
        }

        let Some(DaemonState::Owned(mut state)) = daemons.remove(&key) else {
            return Ok(());
        };
        let stopping_entry = StoppingEntry {
            daemons: &self.daemons,
            key: key.clone(),
            generation: state.generation,
            stopped: StopSignal::new(),
        };
        daemons.insert(
            key,
            DaemonState::Stopping {
                generation: state.generation,
                stopped: stopping_entry.stopped.clone(),
            },
        );
        drop(daemons);

        log::info!(
            "Stopping daemon for user={}, org={}",
            user_id,
            organization_id
        );
        Self::stop_daemon_process(&mut state.child)
    }

    fn stop_daemon_process(child: &mut Child) -> Result<(), String> {
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;

            let pid = Pid::from_raw(child.id() as i32);
            if let Err(e) = kill(pid, Signal::SIGTERM) {
                log::warn!("Failed to send SIGTERM: {}", e);
            }

            let deadline = Instant::now() + DAEMON_GRACEFUL_STOP_TIMEOUT;
            while Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        log::info!("Daemon exited gracefully");
                        return Ok(());
                    }
                    Ok(None) => {
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        log::error!("Error waiting for daemon: {}", e);
                        break;
                    }
                }
            }

            log::warn!("Daemon didn't exit gracefully, force killing");
        }

        child
            .kill()
            .map_err(|e| format!("Failed to kill daemon: {}", e))?;
        let _ = child.wait();

        log::info!("Daemon stopped");
        Ok(())
    }

    pub fn stop_all_daemons(&self) {
        *self.is_shutting_down.lock().unwrap() = true;
        let (owned_daemons, pending_launches, pending_stops) = {
            let mut daemons = self.daemons.lock().unwrap();
            let states = std::mem::take(&mut *daemons);
            let mut owned_daemons = Vec::new();
            let mut pending_launches = Vec::new();
            let mut pending_stops = Vec::new();

            for (key, state) in states {
                match state {
                    DaemonState::Starting {
                        generation,
                        launch_signal,
                        cancelled,
                        verified_claude_path,
                    } => {
                        cancelled.store(true, Ordering::Release);
                        pending_launches.push(launch_signal.clone());
                        daemons.insert(
                            key,
                            DaemonState::Starting {
                                generation,
                                launch_signal,
                                cancelled,
                                verified_claude_path,
                            },
                        );
                    }
                    DaemonState::Owned(state) => owned_daemons.push((key, state)),
                    DaemonState::Stopping {
                        generation,
                        stopped,
                    } => {
                        pending_stops.push(stopped.clone());
                        daemons.insert(
                            key,
                            DaemonState::Stopping {
                                generation,
                                stopped,
                            },
                        );
                    }
                }
            }

            (owned_daemons, pending_launches, pending_stops)
        };

        let deadline = Instant::now() + DAEMON_QUIT_TIMEOUT;
        let owned_count = owned_daemons.len();
        let (stopped_sender, stopped_receiver) = mpsc::channel();
        for ((user_id, org_id), mut state) in owned_daemons {
            let stopped_sender = stopped_sender.clone();
            std::thread::spawn(move || {
                log::info!("Stopping daemon for user={}, org={}", user_id, org_id);
                if let Err(error) = Self::stop_daemon_process(&mut state.child) {
                    log::warn!("Failed to stop daemon at quit: {}", error);
                }
                let _ = stopped_sender.send(());
            });
        }
        drop(stopped_sender);

        for _ in 0..owned_count {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if stopped_receiver.recv_timeout(remaining).is_err() {
                log::warn!("Timed out waiting for daemons to stop at quit");
                break;
            }
        }
        for launch_signal in pending_launches {
            let _ = launch_signal.wait_for(deadline.saturating_duration_since(Instant::now()));
        }
        for stopped in pending_stops {
            stopped.wait_for(deadline.saturating_duration_since(Instant::now()));
        }

        log::info!("All daemons stopped");
    }

    /// Opens or closes the gate for starts and automatic restarts. Closing it cancels pending launches
    /// and stops every daemon this app owns, and fails if any of them may still be running. Daemons
    /// started outside this app keep running.
    pub fn set_management_enabled(&self, enabled: bool) -> Result<(), String> {
        let _policy = self
            .management_policy
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if enabled {
            self.management_disabled.store(false, Ordering::Release);
            return Ok(());
        }

        let keys: Vec<DaemonKey> = {
            let daemons = self.daemons.lock().unwrap_or_else(PoisonError::into_inner);
            // Launches check the gate under this lock before spawning, so each one either sees it
            // closed or is already in the map.
            self.management_disabled.store(true, Ordering::Release);
            daemons.keys().cloned().collect()
        };

        let stoppers: Vec<_> = keys
            .into_iter()
            .map(|(user_id, organization_id)| {
                let manager = self.clone();
                std::thread::spawn(move || manager.stop_daemon(&user_id, &organization_id))
            })
            .collect();
        let mut failures = Vec::new();
        for stopper in stoppers {
            match stopper.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => failures.push(error),
                Err(_) => failures.push("Daemon stop thread panicked".to_string()),
            }
        }
        let remaining = self
            .daemons
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len();
        if remaining > 0 {
            failures.push(format!("{remaining} local daemons did not stop"));
        }
        if failures.is_empty() {
            Ok(())
        } else {
            let message = format!("Failed to stop local daemons: {}", failures.join("; "));
            app_sentry::capture_error(&message, Some("daemon_disable_management"));
            Err(message)
        }
    }

    pub fn is_daemon_running(&self, user_id: &str, organization_id: &str) -> bool {
        let key = (user_id.to_string(), organization_id.to_string());
        let mut daemons = self.daemons.lock().unwrap();

        if let Some(DaemonState::Owned(state)) = daemons.get_mut(&key) {
            match state.child.try_wait() {
                Ok(None) => true,
                _ => {
                    daemons.remove(&key);
                    false
                }
            }
        } else {
            false
        }
    }
}

fn validate_executable(path: &str) -> Result<(), String> {
    let path = std::path::Path::new(path);
    if !path.is_absolute() || !path.is_file() {
        return Err(format!(
            "Verified Claude path is not an executable file: {}",
            path.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path
            .metadata()
            .map_err(|error| error.to_string())?
            .permissions()
            .mode()
            & 0o111
            == 0
        {
            return Err(format!(
                "Verified Claude path is not executable: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_verified_claude_paths() {
        assert!(validate_executable("bin/claude").is_err());
    }

    #[test]
    #[cfg(unix)]
    fn accepts_only_executable_files() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let directory =
            std::env::temp_dir().join(format!("riptide-daemon-path-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("claude");
        fs::write(&path, "#!/bin/sh\n").unwrap();
        assert!(validate_executable(path.to_str().unwrap()).is_err());

        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        assert!(validate_executable(path.to_str().unwrap()).is_ok());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn shared_process_event_fixture_decodes_to_typed_variants() {
        let fixture =
            include_str!("../../../packages/schemas/test/fixtures/daemon-process-events.jsonl");
        let events = fixture
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_str::<DaemonProcessEvent>(line).unwrap())
            .collect::<Vec<_>>();

        assert_eq!(
            events,
            vec![
                DaemonProcessEvent::DaemonReady,
                DaemonProcessEvent::DaemonAlreadyRunning {
                    message:
                        "A daemon is already running for this user, organization, host, and stage"
                            .to_string(),
                },
                DaemonProcessEvent::AuthFailure {
                    message: "Authentication failed (401). Please sign in again.".to_string(),
                },
            ]
        );
    }

    #[test]
    fn malformed_and_unknown_process_lines_remain_ordinary_logs() {
        assert!(serde_json::from_str::<DaemonProcessEvent>("not json").is_err());
        assert!(serde_json::from_str::<DaemonProcessEvent>(r#"{"type":"future_event"}"#).is_err());
        assert!(
            serde_json::from_str::<DaemonProcessEvent>(r#"{"type":"daemon_already_running"}"#)
                .is_err()
        );
    }

    #[test]
    fn compiled_stage_normalization_is_bounded_and_maps_stable_to_prod() {
        for stage in ["local", "dev", "beta", "prod"] {
            assert_eq!(normalize_build_type(Some(stage), false).unwrap(), stage);
        }
        assert_eq!(normalize_build_type(Some("stable"), false).unwrap(), "prod");
        assert_eq!(normalize_build_type(None, true).unwrap(), "local");
        assert_eq!(normalize_build_type(None, false).unwrap(), "prod");
        assert!(normalize_build_type(Some("preview"), false).is_err());
    }

    #[test]
    fn launcher_controlled_daemon_environment_replaces_stale_inherited_generation_and_identity_values(
    ) {
        let current_generation = Uuid::new_v4();
        let mut daemon_env = vec![
            ("UNCHANGED_VALUE".to_string(), "preserved".to_string()),
            ("DAEMON_IDENTITY".to_string(), "stale-token".to_string()),
            (
                "RIPTIDE_DAEMON_EXPECTED_IDENTITY".to_string(),
                "stale-identity".to_string(),
            ),
            (
                "RIPTIDE_DAEMON_GENERATION_ID".to_string(),
                Uuid::new_v4().to_string(),
            ),
        ];

        apply_launcher_controlled_daemon_identity_environment(
            &mut daemon_env,
            "current-token",
            "current-identity".to_string(),
            current_generation,
        );

        assert_eq!(
            daemon_env
                .iter()
                .filter(|(name, _)| name == "RIPTIDE_DAEMON_GENERATION_ID")
                .collect::<Vec<_>>(),
            vec![&(
                "RIPTIDE_DAEMON_GENERATION_ID".to_string(),
                current_generation.to_string()
            )]
        );
        assert!(daemon_env.contains(&("DAEMON_IDENTITY".to_string(), "current-token".to_string())));
        assert!(daemon_env.contains(&(
            "RIPTIDE_DAEMON_EXPECTED_IDENTITY".to_string(),
            "current-identity".to_string()
        )));
        assert!(daemon_env.contains(&("UNCHANGED_VALUE".to_string(), "preserved".to_string())));
    }

    #[test]
    fn launcher_controlled_daemon_environment_emits_current_generation_when_inherited_environment_has_none(
    ) {
        let current_generation = Uuid::new_v4();
        let mut daemon_env = Vec::new();

        apply_launcher_controlled_daemon_identity_environment(
            &mut daemon_env,
            "current-token",
            "current-identity".to_string(),
            current_generation,
        );

        assert!(daemon_env.contains(&(
            "RIPTIDE_DAEMON_GENERATION_ID".to_string(),
            current_generation.to_string()
        )));
    }

    #[test]
    fn concurrent_start_waiters_share_one_pending_launch_result() {
        let signal = LaunchSignal::new();
        let waiter_signal = signal.clone();
        let waiter = std::thread::spawn(move || waiter_signal.wait_for(Duration::from_secs(1)));

        assert!(signal.result().is_none());
        signal.complete(Ok(DaemonLaunchResult::DaemonReady));

        assert_eq!(
            waiter.join().unwrap().unwrap(),
            DaemonLaunchResult::DaemonReady
        );
    }

    #[test]
    fn raw_candidate_event_does_not_complete_public_waiters() {
        let process_signal = ProcessSignal::new();
        let launch_signal = LaunchSignal::new();

        process_signal.publish(DaemonProcessEvent::DaemonReady);

        assert_eq!(
            process_signal.event(),
            Some(Ok(DaemonProcessEvent::DaemonReady))
        );
        assert!(launch_signal.result().is_none());
    }

    #[test]
    fn auth_failure_supersedes_an_unsettled_ready_event() {
        let process_signal = ProcessSignal::new();
        process_signal.publish(DaemonProcessEvent::DaemonReady);
        process_signal.publish(DaemonProcessEvent::AuthFailure {
            message: "token expired".to_string(),
        });

        assert_eq!(
            process_signal.event(),
            Some(Ok(DaemonProcessEvent::AuthFailure {
                message: "token expired".to_string(),
            }))
        );
    }

    #[test]
    fn already_running_completes_as_success_and_cannot_be_replaced() {
        let signal = LaunchSignal::new();
        let expected = DaemonLaunchResult::DaemonAlreadyRunning {
            message: "incumbent owns lease".to_string(),
        };
        signal.complete(Ok(expected.clone()));
        signal.complete(Err("late EOF".to_string()));

        assert_eq!(signal.wait_for(Duration::from_millis(1)).unwrap(), expected);
    }

    #[test]
    fn eof_and_timeout_fail_a_pending_candidate() {
        let eof_signal = LaunchSignal::new();
        eof_signal.complete(Err(
            "Daemon output closed before a launch result was received".to_string(),
        ));
        assert!(eof_signal.wait_for(Duration::from_millis(1)).is_err());

        let timeout_signal = LaunchSignal::new();
        assert_eq!(
            timeout_signal
                .wait_for(Duration::from_millis(1))
                .unwrap_err(),
            "Timed out waiting for daemon launch result"
        );
    }

    #[test]
    fn stop_waits_for_starting_candidate_cleanup() {
        let manager = DaemonManager::new();
        let key = ("user-1".to_string(), "org-1".to_string());
        let generation = Uuid::new_v4();
        let launch_signal = LaunchSignal::new();
        let cancelled = Arc::new(AtomicBool::new(false));
        manager.daemons.lock().unwrap().insert(
            key.clone(),
            DaemonState::Starting {
                generation,
                launch_signal: launch_signal.clone(),
                cancelled: cancelled.clone(),
                verified_claude_path: None,
            },
        );

        let leader_manager = manager.clone();
        let leader_key = key.clone();
        let cleanup_finished = Arc::new(AtomicBool::new(false));
        let leader_cleanup_finished = cleanup_finished.clone();
        let leader = std::thread::spawn(move || {
            while !cancelled.load(Ordering::Acquire) {
                std::thread::yield_now();
            }
            let mut daemons = leader_manager.daemons.lock().unwrap();
            if matches!(
                daemons.get(&leader_key),
                Some(DaemonState::Starting { generation: current, .. }) if *current == generation
            ) {
                daemons.remove(&leader_key);
            }
            drop(daemons);
            leader_cleanup_finished.store(true, Ordering::Release);
            launch_signal.complete(Err("Daemon launch cancelled".to_string()));
        });

        assert!(!manager.is_daemon_running(&key.0, &key.1));
        manager.stop_daemon(&key.0, &key.1).unwrap();
        leader.join().unwrap();
        assert!(cleanup_finished.load(Ordering::Acquire));
        assert!(!manager.daemons.lock().unwrap().contains_key(&key));
    }

    #[test]
    #[cfg(unix)]
    fn stopping_a_daemon_process_lets_it_exit_on_sigterm() {
        let mut child = Command::new("sh")
            .args([
                "-c",
                "trap 'exit 0' TERM; echo ready; while :; do sleep 0.05; done",
            ])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut ready = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();

        DaemonManager::stop_daemon_process(&mut child).unwrap();

        assert_eq!(
            child.try_wait().unwrap().and_then(|status| status.code()),
            Some(0)
        );
    }

    #[cfg(unix)]
    fn spawn_ready_daemon(script: &str, argument: &str) -> Child {
        let mut child = Command::new("sh")
            .args(["-c", script, argument])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut ready = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        child
    }

    #[cfg(unix)]
    fn owned_daemon(child: Child) -> DaemonState {
        DaemonState::Owned(OwnedDaemonState {
            child,
            generation: Uuid::new_v4(),
            token: "token".to_string(),
            has_retried: false,
            sync_mode: "default".to_string(),
            verified_claude_path: None,
        })
    }

    #[test]
    #[cfg(unix)]
    fn stop_daemon_releases_the_map_lock_while_the_daemon_exits() {
        let manager = DaemonManager::new();
        let key = ("user-1".to_string(), "org-1".to_string());
        let child = spawn_ready_daemon(
            "trap 'sleep 1; exit 0' TERM; echo ready; while :; do sleep 0.05; done",
            "daemon",
        );
        manager
            .daemons
            .lock()
            .unwrap()
            .insert(key.clone(), owned_daemon(child));

        let stopper_manager = manager.clone();
        let stopper_key = key.clone();
        let stopper =
            std::thread::spawn(move || stopper_manager.stop_daemon(&stopper_key.0, &stopper_key.1));
        let deadline = Instant::now() + Duration::from_secs(2);
        while !matches!(
            manager.daemons.lock().unwrap().get(&key),
            Some(DaemonState::Stopping { .. })
        ) {
            assert!(
                Instant::now() < deadline,
                "stop never entered stopping state"
            );
            std::thread::sleep(Duration::from_millis(10));
        }

        let lock_started = Instant::now();
        assert!(!manager.is_daemon_running(&key.0, &key.1));
        assert!(lock_started.elapsed() < Duration::from_millis(200));
        assert!(!stopper.is_finished());

        manager.stop_daemon(&key.0, &key.1).unwrap();
        assert!(!manager.daemons.lock().unwrap().contains_key(&key));
        stopper.join().unwrap().unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn quit_stops_owned_daemons_gracefully_in_parallel() {
        let manager = DaemonManager::new();
        let directory =
            std::env::temp_dir().join(format!("riptide-daemon-quit-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let markers = (0..3)
            .map(|index| directory.join(format!("exited-{index}")))
            .collect::<Vec<_>>();
        for (index, marker) in markers.iter().enumerate() {
            let child = spawn_ready_daemon(
                "trap 'sleep 2; touch \"$0\"; exit 0' TERM; echo ready; while :; do sleep 0.05; done",
                marker.to_str().unwrap(),
            );
            manager.daemons.lock().unwrap().insert(
                (format!("user-{index}"), "org-1".to_string()),
                owned_daemon(child),
            );
        }

        let quit_started = Instant::now();
        manager.stop_all_daemons();

        assert!(quit_started.elapsed() < Duration::from_secs(4));
        assert!(markers.iter().all(|marker| marker.exists()));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn quit_is_bounded_when_daemons_ignore_sigterm() {
        let manager = DaemonManager::new();
        for index in 0..2 {
            let child = spawn_ready_daemon(
                "trap '' TERM; echo ready; while :; do sleep 0.05; done",
                "daemon",
            );
            manager.daemons.lock().unwrap().insert(
                (format!("user-{index}"), "org-1".to_string()),
                owned_daemon(child),
            );
        }

        let quit_started = Instant::now();
        manager.stop_all_daemons();

        assert!(quit_started.elapsed() <= DAEMON_QUIT_TIMEOUT + Duration::from_millis(500));
        assert!(manager.daemons.lock().unwrap().is_empty());
    }

    #[test]
    fn panicking_launch_leader_clears_its_starting_entry() {
        let manager = DaemonManager::new();
        let key = ("user-1".to_string(), "org-1".to_string());
        let generation = Uuid::new_v4();
        let launch_signal = LaunchSignal::new();
        manager.daemons.lock().unwrap().insert(
            key.clone(),
            DaemonState::Starting {
                generation,
                launch_signal: launch_signal.clone(),
                cancelled: Arc::new(AtomicBool::new(false)),
                verified_claude_path: None,
            },
        );

        let leader_manager = manager.clone();
        let leader_key = key.clone();
        let leader_signal = launch_signal.clone();
        let leader = std::thread::spawn(move || {
            let _starting_entry = StartingEntry {
                daemons: &leader_manager.daemons,
                key: leader_key,
                generation,
                launch_signal: leader_signal,
            };
            panic!("launch leader panicked");
        });

        assert!(leader.join().is_err());
        assert!(!manager.daemons.lock().unwrap().contains_key(&key));
        assert!(launch_signal.wait_for(Duration::from_millis(1)).is_err());
        assert!(launch_signal.result().is_some());
    }

    #[test]
    fn stale_generation_cannot_match_replacement_candidate() {
        let old_generation = Uuid::new_v4();
        let new_generation = Uuid::new_v4();
        assert_ne!(old_generation, new_generation);

        let state = DaemonState::Starting {
            generation: new_generation,
            launch_signal: LaunchSignal::new(),
            cancelled: Arc::new(AtomicBool::new(false)),
            verified_claude_path: None,
        };
        assert!(!matches!(
            state,
            DaemonState::Starting { generation, .. } if generation == old_generation
        ));
    }

    #[test]
    #[cfg(unix)]
    fn turning_management_off_stops_every_owned_daemon_until_turned_on() {
        let manager = DaemonManager::new();
        for index in 0..2 {
            let child = spawn_ready_daemon(
                "trap 'exit 0' TERM; echo ready; while :; do sleep 0.05; done",
                "daemon",
            );
            manager.daemons.lock().unwrap().insert(
                ("user-1".to_string(), format!("org-{index}")),
                owned_daemon(child),
            );
        }

        manager.set_management_enabled(false).unwrap();

        assert!(manager.is_management_disabled());
        assert!(manager.daemons.lock().unwrap().is_empty());
        assert!(!manager.is_daemon_running("user-1", "org-0"));
        manager.set_management_enabled(false).unwrap();

        manager.set_management_enabled(true).unwrap();
        assert!(!manager.is_management_disabled());
    }

    #[test]
    fn turning_management_off_cancels_a_pending_launch() {
        let manager = DaemonManager::new();
        let key = ("user-1".to_string(), "org-1".to_string());
        let generation = Uuid::new_v4();
        let launch_signal = LaunchSignal::new();
        let cancelled = Arc::new(AtomicBool::new(false));
        manager.daemons.lock().unwrap().insert(
            key.clone(),
            DaemonState::Starting {
                generation,
                launch_signal: launch_signal.clone(),
                cancelled: cancelled.clone(),
                verified_claude_path: None,
            },
        );

        let leader_manager = manager.clone();
        let leader_key = key.clone();
        let leader = std::thread::spawn(move || {
            while !cancelled.load(Ordering::Acquire) {
                std::thread::yield_now();
            }
            remove_entry_in_state(&leader_manager.daemons, &leader_key, |state| {
                state.is_starting(generation)
            });
            launch_signal.complete(Err("Daemon launch cancelled".to_string()));
        });

        manager.set_management_enabled(false).unwrap();
        leader.join().unwrap();
        assert!(!manager.daemons.lock().unwrap().contains_key(&key));
    }
}
