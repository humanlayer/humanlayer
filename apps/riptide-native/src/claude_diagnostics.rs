use crate::shell_env;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

/// Minimum supported Claude Code version for installation diagnostics and onboarding probes.
pub const MINIMUM_CLAUDE_VERSION: (u32, u32, u32) = (2, 1, 177);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const SMOKE_TEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_FAILURE_DETAILS_BYTES: usize = 4_096;
const CODELAYER_FINAL_MESSAGE_START: &str = "__CODELAYER_FINAL_MESSAGE_START__";
const CODELAYER_FINAL_MESSAGE_END: &str = "__CODELAYER_FINAL_MESSAGE_END__";

#[derive(Serialize)]
pub struct ClaudeCheckResult {
    pub path: String,
    pub version: String,
    pub installation_source: String,
    pub is_recommended: bool,
    /// Whether `version` satisfies `MINIMUM_CLAUDE_VERSION`.
    pub is_version_supported: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CodingAgent {
    Claude,
    Codex,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeCodingAgentInput {
    pub agent: CodingAgent,
    pub preferred_path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum AgentProbeFailure {
    NotFound { details: String },
    UnsupportedVersion { details: String },
    AuthenticationRequired { details: String },
    SmokeTestFailed { details: String },
    TimedOut { details: String },
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AgentProbeResult {
    Ready {
        agent: CodingAgent,
        path: String,
        version: String,
        installation_source: String,
        checked_at: u64,
    },
    Failed {
        agent: CodingAgent,
        path: Option<String>,
        version: Option<String>,
        installation_source: Option<String>,
        failure: AgentProbeFailure,
        checked_at: u64,
    },
}

enum CommandRun {
    Completed {
        success: bool,
        stdout: String,
        stderr: String,
    },
    TimedOut,
    Failed(String),
}

fn checked_at() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn run_bounded(
    path: &str,
    args: &[&str],
    shell_env: &HashMap<String, String>,
    duration: Duration,
    remove_claude_parent_markers: bool,
) -> CommandRun {
    let mut command = TokioCommand::new(path);
    command.args(args).env_clear().kill_on_drop(true);
    command.envs(shell_env.iter().filter(|(key, _)| {
        !remove_claude_parent_markers
            || (!key.eq_ignore_ascii_case("CLAUDECODE")
                && !key.eq_ignore_ascii_case("CLAUDE_CODE_ENTRYPOINT"))
    }));

    match timeout(duration, command.output()).await {
        Err(_) => CommandRun::TimedOut,
        Ok(Err(error)) => CommandRun::Failed(error.to_string()),
        Ok(Ok(output)) => CommandRun::Completed {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        },
    }
}

fn failed_probe(
    agent: CodingAgent,
    path: Option<String>,
    version: Option<String>,
    installation_source: Option<String>,
    failure: AgentProbeFailure,
) -> AgentProbeResult {
    AgentProbeResult::Failed {
        agent,
        path,
        version,
        installation_source,
        failure,
        checked_at: checked_at(),
    }
}

fn bounded_failure_details(mut details: String) -> String {
    if details.len() <= MAX_FAILURE_DETAILS_BYTES {
        return details;
    }
    let mut end = MAX_FAILURE_DETAILS_BYTES;
    while !details.is_char_boundary(end) {
        end -= 1;
    }
    details.truncate(end);
    details.push_str("\n[output truncated]");
    details
}

fn bounded_combined_output(stdout: &str, stderr: &str, fallback: &str) -> String {
    let mut details = String::new();
    if !stderr.is_empty() {
        details.push_str("stderr: ");
        details.push_str(stderr);
    }
    if !stdout.is_empty() {
        if !details.is_empty() {
            details.push('\n');
        }
        details.push_str("stdout: ");
        details.push_str(stdout);
    }
    if details.is_empty() {
        return fallback.to_string();
    }
    bounded_failure_details(details)
}

fn is_authentication_failure(details: &str, codex: bool) -> bool {
    let normalized = details.to_ascii_lowercase();
    let mut authentication_markers = vec![
        "authentication",
        "not logged in",
        "please log in",
        "please login",
        "/login",
        "api key",
        "oauth",
        "unauthorized",
    ];
    if codex {
        authentication_markers.extend([
            "missing auth for provider: codex",
            "invalid auth for provider: codex",
            "missing authentication for provider: codex",
            "invalid authentication for provider: codex",
            "invalid token for provider: codex",
            "invalid credentials for provider: codex",
        ]);
    }

    authentication_markers
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn smoke_failure(stdout: &str, stderr: &str) -> AgentProbeFailure {
    let details = [stderr, stdout]
        .iter()
        .find(|value| !value.is_empty())
        .copied()
        .unwrap_or("Claude smoke test exited without a response")
        .to_string();
    if is_authentication_failure(&details, false) {
        AgentProbeFailure::AuthenticationRequired { details }
    } else {
        AgentProbeFailure::SmokeTestFailed { details }
    }
}

fn codex_smoke_failure(stdout: &str, stderr: &str) -> AgentProbeFailure {
    let details = bounded_combined_output(
        stdout,
        stderr,
        "CodeLayer Codex smoke test exited without a response",
    );
    if is_authentication_failure(&details, true) {
        AgentProbeFailure::AuthenticationRequired { details }
    } else {
        AgentProbeFailure::SmokeTestFailed { details }
    }
}

fn codelayer_codex_smoke_succeeded(stdout: &str) -> bool {
    let Some(start_index) = stdout.rfind(CODELAYER_FINAL_MESSAGE_START) else {
        return false;
    };
    let message_start = start_index + CODELAYER_FINAL_MESSAGE_START.len();
    let Some(end_offset) = stdout[message_start..].find(CODELAYER_FINAL_MESSAGE_END) else {
        return false;
    };
    &stdout[message_start..message_start + end_offset] == "hi"
}

/// Classify installation source based on path patterns.
///
/// The recommended sources are the native installer / managed paths
/// (`~/.local/bin/claude`, `~/.claude/local/claude`); everything else (Homebrew, NVM, npm,
/// bun, other) is a working-but-non-recommended install. This mirrors the daemon's binary
/// detection ordering in `apps/riptide-daemon/src/lib/binary-detection.ts`, which prefers
/// `~/.local/bin` and `~/.claude/local/claude` ahead of Homebrew/NVM/npm/bun fallbacks.
fn classify_installation_source(path: &str) -> (String, bool) {
    if path.contains("/.local/bin/") || path.contains("/.claude/local/") {
        ("native".to_string(), true)
    } else if path.contains("/opt/homebrew/") || path.contains("/usr/local/bin/") {
        ("homebrew".to_string(), false)
    } else if path.contains("/.nvm/") {
        ("nvm".to_string(), false)
    } else if path.contains("/.npm/") || path.contains("/.npm-global/") {
        ("npm".to_string(), false)
    } else if path.contains("/.bun/") {
        ("bun".to_string(), false)
    } else {
        ("other".to_string(), false)
    }
}

/// Parse the leading `MAJOR.MINOR.PATCH` out of a `claude --version` string.
///
/// Claude prints e.g. `1.2.3 (Claude Code)`; a missing patch defaults to 0. Returns `None`
/// when no dotted-number run is present (callers treat that as unsupported).
fn parse_version(version: &str) -> Option<(u32, u32, u32)> {
    let trimmed = version.trim();
    // Take the first whitespace-delimited token, then split on '.'.
    let token = trimmed.split_whitespace().next()?;
    let mut parts = token.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u32>().ok()?;
    let patch_raw = parts.next().unwrap_or("0");
    // Strip any trailing non-digits from the patch (e.g. "3-beta").
    let patch_digits: String = patch_raw
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let patch = patch_digits.parse::<u32>().unwrap_or(0);
    Some((major, minor, patch))
}

/// Whether `version` satisfies `MINIMUM_CLAUDE_VERSION`. Unparseable versions are unsupported.
fn is_version_supported(version: &str) -> bool {
    match parse_version(version) {
        Some(v) => v >= MINIMUM_CLAUDE_VERSION,
        None => false,
    }
}

/// Build the ordered list of candidate Claude paths, mirroring the daemon's detection.
///
/// Order: explicit `HUMANLAYER_CLAUDE_PATH` override (or legacy `RIPTIDE_CLAUDE_PATH`) →
/// recommended/common installer paths →
/// (after these) the `which`/login-shell PATH lookup handled by the caller.
fn candidate_paths() -> Vec<String> {
    let mut paths = Vec::new();
    for variable in ["HUMANLAYER_CLAUDE_PATH", "RIPTIDE_CLAUDE_PATH"] {
        if let Ok(explicit) = std::env::var(variable) {
            if !explicit.trim().is_empty() {
                paths.push(explicit);
                break;
            }
        }
    }
    if let Some(home) = dirs_home() {
        paths.push(format!("{home}/.local/bin/claude"));
        paths.push(format!("{home}/.claude/local/claude"));
        paths.push(format!("{home}/.npm/bin/claude"));
        paths.push(format!("{home}/.bun/bin/claude"));
        let nvm_versions = Path::new(&home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(nvm_versions) {
            let mut nvm_paths: Vec<String> = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path().join("bin/claude"))
                .filter(|path| path.is_file())
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            nvm_paths.sort_by(|a, b| b.cmp(a));
            paths.extend(nvm_paths);
        }
    }
    paths.push("/usr/local/bin/claude".to_string());
    paths.push("/opt/homebrew/bin/claude".to_string());
    paths
}

fn dirs_home() -> Option<String> {
    std::env::var("HOME").ok().filter(|h| !h.is_empty())
}

/// Resolve a usable `claude` path, preferring the recommended installer paths and falling back
/// to a login-shell `which` lookup (which carries the user's PATH/nvm). Returns `None` when no
/// executable can be resolved.
fn resolve_claude_path(shell_env: &HashMap<String, String>) -> Option<String> {
    // 1. Recommended / common installer paths (no shell needed).
    for candidate in candidate_paths() {
        if Path::new(&candidate).is_file() {
            return Some(candidate);
        }
    }

    // 2. Ask both common login shells. This also loads NVM setups that only exist in one shell's
    // login files, which a GUI process does not inherit.
    for shell in ["/bin/zsh", "/bin/bash"] {
        if !Path::new(shell).is_file() {
            continue;
        }
        let output = Command::new(shell)
            .args(["-l", "-c", "command -v claude"])
            .env_clear()
            .envs(shell_env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .output();
        if let Ok(output) = output {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if output.status.success() && Path::new(&path).is_file() {
                return Some(path);
            }
        }
    }

    None
}

/// Resolve the HumanLayer CLI used to run CodeLayer's Codex provider.
///
/// The GUI already captures the login-shell environment, so inspect its PATH directly rather
/// than spawning another shell. This preserves the user's global npm, bun, and NVM resolution.
fn resolve_humanlayer_path(shell_env: &HashMap<String, String>) -> Option<String> {
    let mut candidates = Vec::new();
    if let Some(home) = shell_env
        .get("HOME")
        .filter(|home| !home.is_empty())
        .cloned()
        .or_else(dirs_home)
    {
        candidates.push(format!("{home}/.local/bin/humanlayer"));
        candidates.push(format!("{home}/.npm/bin/humanlayer"));
        candidates.push(format!("{home}/.bun/bin/humanlayer"));
        let nvm_versions = Path::new(&home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(nvm_versions) {
            let mut nvm_paths: Vec<String> = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path().join("bin/humanlayer"))
                .filter(|path| path.is_file())
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            nvm_paths.sort_by(|a, b| b.cmp(a));
            candidates.extend(nvm_paths);
        }
    }
    candidates.push("/usr/local/bin/humanlayer".to_string());
    candidates.push("/opt/homebrew/bin/humanlayer".to_string());
    if let Some(path) = candidates
        .into_iter()
        .find(|path| Path::new(path).is_file())
    {
        return Some(path);
    }
    shell_env.get("PATH").and_then(|path| {
        std::env::split_paths(path)
            .map(|directory| directory.join("humanlayer"))
            .find(|candidate| candidate.is_file())
            .map(|candidate| candidate.to_string_lossy().to_string())
    })
}

/// Read the version string from `claude --version`. Returns `None` if the binary won't run.
fn read_version(path: &str, shell_env: &HashMap<String, String>) -> Option<String> {
    let version_output = Command::new(path)
        .arg("--version")
        .env_clear()
        .envs(shell_env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .output()
        .ok()?;

    if !version_output.status.success() {
        return None;
    }

    Some(
        String::from_utf8_lossy(&version_output.stdout)
            .trim()
            .to_string(),
    )
}

/// Check Claude Code is installed and resolvable, returning installation info + version policy.
///
/// Aligns binary detection with the daemon (`HUMANLAYER_CLAUDE_PATH`, then legacy
/// `RIPTIDE_CLAUDE_PATH` → recommended/common paths → login-shell `which`), classifies the install
/// source, and reports whether the detected version meets the minimum supported policy. This backs
/// the boot-time advisory dialog and the launch preflight on the UI side.
#[tauri::command]
pub async fn check_claude_installed() -> Result<ClaudeCheckResult, String> {
    let shell_env = shell_env::get().ok_or("Failed to load shell environment")?;

    let path = resolve_claude_path(shell_env).ok_or_else(|| {
        "Claude Code not found. Please install Claude Code from https://code.claude.com/docs/en/overview"
            .to_string()
    })?;

    log::info!("Found claude at: {}", path);

    let version = read_version(&path, shell_env).ok_or_else(|| {
        "Claude Code binary found but not executable. Try reinstalling from https://code.claude.com/docs/en/overview".to_string()
    })?;
    log::info!("Claude version: {}", version);

    let (installation_source, is_recommended) = classify_installation_source(&path);
    let version_supported = is_version_supported(&version);
    log::info!(
        "Installation source: {} (recommended: {}, version_supported: {})",
        installation_source,
        is_recommended,
        version_supported
    );

    Ok(ClaudeCheckResult {
        path,
        version,
        installation_source,
        is_recommended,
        is_version_supported: version_supported,
    })
}

#[tauri::command]
pub async fn probe_coding_agent(input: ProbeCodingAgentInput) -> AgentProbeResult {
    if input.agent == CodingAgent::Codex {
        let shell_env =
            match shell_env::get() {
                Some(shell_env) => shell_env,
                None => return failed_probe(
                    CodingAgent::Codex,
                    input.preferred_path,
                    None,
                    None,
                    AgentProbeFailure::NotFound {
                        details:
                            "Failed to load the shell environment used to find the HumanLayer CLI"
                                .to_string(),
                    },
                ),
            };
        let path = match input.preferred_path {
            Some(path) if Path::new(&path).is_absolute() && Path::new(&path).is_file() => path,
            Some(path) => {
                return failed_probe(
                    CodingAgent::Codex,
                    Some(path.clone()),
                    None,
                    None,
                    AgentProbeFailure::NotFound {
                        details: format!("HumanLayer CLI was not found at the exact path: {path}"),
                    },
                )
            }
            None => match resolve_humanlayer_path(shell_env) {
                Some(path) => path,
                None => return failed_probe(
                    CodingAgent::Codex,
                    None,
                    None,
                    None,
                    AgentProbeFailure::NotFound {
                        details:
                            "HumanLayer CLI was not found in known global install locations or the login-shell PATH"
                                .to_string(),
                    },
                ),
            },
        };
        let installation_source = classify_installation_source(&path).0;
        let version =
            match run_bounded(&path, &["--version"], shell_env, VERSION_TIMEOUT, false).await {
                CommandRun::TimedOut => {
                    return failed_probe(
                        CodingAgent::Codex,
                        Some(path),
                        None,
                        Some(installation_source),
                        AgentProbeFailure::TimedOut {
                            details: "HumanLayer CLI --version timed out".to_string(),
                        },
                    )
                }
                CommandRun::Failed(error) => {
                    return failed_probe(
                        CodingAgent::Codex,
                        Some(path),
                        None,
                        Some(installation_source),
                        AgentProbeFailure::NotFound {
                            details: format!("HumanLayer CLI could not run: {error}"),
                        },
                    )
                }
                CommandRun::Completed {
                    success,
                    stdout,
                    stderr,
                } => {
                    let version = if stdout.is_empty() { stderr } else { stdout };
                    if !success || version.is_empty() {
                        return failed_probe(
                            CodingAgent::Codex,
                            Some(path),
                            Some(version.clone()),
                            Some(installation_source),
                            AgentProbeFailure::UnsupportedVersion {
                                details: "HumanLayer CLI --version did not return a version"
                                    .to_string(),
                            },
                        );
                    }
                    version
                }
            };
        return match run_bounded(
            &path,
            &[
                "codelayer",
                "--prompt",
                "respond with hi and nothing else",
                "--model",
                "gpt-5.6-luna",
                "--provider",
                "codex",
            ],
            shell_env,
            SMOKE_TEST_TIMEOUT,
            false,
        )
        .await
        {
            CommandRun::TimedOut => failed_probe(
                CodingAgent::Codex,
                Some(path),
                Some(version),
                Some(installation_source),
                AgentProbeFailure::TimedOut {
                    details: "Codex smoke test timed out".to_string(),
                },
            ),
            CommandRun::Failed(error) => failed_probe(
                CodingAgent::Codex,
                Some(path),
                Some(version),
                Some(installation_source),
                AgentProbeFailure::SmokeTestFailed {
                    details: bounded_failure_details(format!(
                        "Codex smoke test could not run: {error}"
                    )),
                },
            ),
            CommandRun::Completed {
                success,
                stdout,
                stderr: _,
            } if success && codelayer_codex_smoke_succeeded(&stdout) => AgentProbeResult::Ready {
                agent: CodingAgent::Codex,
                path,
                version,
                installation_source,
                checked_at: checked_at(),
            },
            CommandRun::Completed { stdout, stderr, .. } => failed_probe(
                CodingAgent::Codex,
                Some(path),
                Some(version),
                Some(installation_source),
                codex_smoke_failure(&stdout, &stderr),
            ),
        };
    }

    let shell_env = match shell_env::get() {
        Some(shell_env) => shell_env,
        None => {
            return failed_probe(
                CodingAgent::Claude,
                input.preferred_path,
                None,
                None,
                AgentProbeFailure::NotFound {
                    details: "Failed to load the shell environment used to find Claude".to_string(),
                },
            )
        }
    };

    let path = match input.preferred_path {
        Some(path) if Path::new(&path).is_absolute() && Path::new(&path).is_file() => path,
        Some(path) => {
            return failed_probe(
                CodingAgent::Claude,
                Some(path.clone()),
                None,
                None,
                AgentProbeFailure::NotFound {
                    details: format!("Claude was not found at the exact path: {path}"),
                },
            )
        }
        None => match resolve_claude_path(shell_env) {
            Some(path) => path,
            None => {
                return failed_probe(
                    CodingAgent::Claude,
                    None,
                    None,
                    None,
                    AgentProbeFailure::NotFound {
                        details: "Claude Code was not found in known install locations or the login-shell PATH"
                            .to_string(),
                    },
                )
            }
        },
    };
    let (installation_source, _) = classify_installation_source(&path);

    let version = match run_bounded(&path, &["--version"], shell_env, VERSION_TIMEOUT, false).await
    {
        CommandRun::TimedOut => {
            return failed_probe(
                CodingAgent::Claude,
                Some(path),
                None,
                Some(installation_source),
                AgentProbeFailure::TimedOut {
                    details: "Claude --version timed out".to_string(),
                },
            )
        }
        CommandRun::Failed(error) => {
            return failed_probe(
                CodingAgent::Claude,
                Some(path),
                None,
                Some(installation_source),
                AgentProbeFailure::NotFound {
                    details: format!("Claude could not run: {error}"),
                },
            )
        }
        CommandRun::Completed {
            success,
            stdout,
            stderr,
        } => {
            let version = if stdout.is_empty() { stderr } else { stdout };
            if !success || !is_version_supported(&version) {
                return failed_probe(
                    CodingAgent::Claude,
                    Some(path),
                    Some(version.clone()),
                    Some(installation_source),
                    AgentProbeFailure::UnsupportedVersion {
                        details: if version.is_empty() {
                            "Claude --version did not return a supported version".to_string()
                        } else {
                            format!("Claude version is not supported: {version}")
                        },
                    },
                );
            }
            version
        }
    };

    match run_bounded(
        &path,
        &["-p", "hi", "--model", "haiku"],
        shell_env,
        SMOKE_TEST_TIMEOUT,
        true,
    )
    .await
    {
        CommandRun::TimedOut => failed_probe(
            CodingAgent::Claude,
            Some(path),
            Some(version),
            Some(installation_source),
            AgentProbeFailure::TimedOut {
                details: "Claude smoke test timed out".to_string(),
            },
        ),
        CommandRun::Failed(error) => failed_probe(
            CodingAgent::Claude,
            Some(path),
            Some(version),
            Some(installation_source),
            AgentProbeFailure::SmokeTestFailed {
                details: format!("Claude smoke test could not run: {error}"),
            },
        ),
        CommandRun::Completed {
            success,
            stdout,
            stderr: _,
        } if success && !stdout.is_empty() => AgentProbeResult::Ready {
            agent: CodingAgent::Claude,
            path,
            version,
            installation_source,
            checked_at: checked_at(),
        },
        CommandRun::Completed { stdout, stderr, .. } => {
            let failure = smoke_failure(&stdout, &stderr);
            failed_probe(
                CodingAgent::Claude,
                Some(path),
                Some(version),
                Some(installation_source),
                failure,
            )
        }
    }
}

/// Run `claude --update` to update the Claude Code CLI to the latest version.
#[tauri::command]
pub async fn update_claude_code() -> Result<(), String> {
    let shell_env = shell_env::get().ok_or("Failed to load shell environment")?;

    let output = Command::new("claude")
        .arg("--update")
        .env_clear()
        .envs(shell_env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .output()
        .map_err(|e| format!("Failed to run claude --update: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "claude --update failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    log::info!("Claude Code updated successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_native_installer_paths_as_recommended() {
        assert_eq!(
            classify_installation_source("/Users/dev/.local/bin/claude"),
            ("native".to_string(), true)
        );
        assert_eq!(
            classify_installation_source("/Users/dev/.claude/local/claude"),
            ("native".to_string(), true)
        );
    }

    #[test]
    fn classifies_non_recommended_sources() {
        assert_eq!(
            classify_installation_source("/opt/homebrew/bin/claude"),
            ("homebrew".to_string(), false)
        );
        assert_eq!(
            classify_installation_source("/Users/dev/.nvm/versions/node/v20/bin/claude"),
            ("nvm".to_string(), false)
        );
        assert_eq!(
            classify_installation_source("/Users/dev/.bun/bin/claude"),
            ("bun".to_string(), false)
        );
    }

    #[test]
    fn parses_versions_with_suffix_and_missing_patch() {
        assert_eq!(parse_version("1.2.3 (Claude Code)"), Some((1, 2, 3)));
        assert_eq!(parse_version("2.4"), Some((2, 4, 0)));
        assert_eq!(parse_version("1.2.3-beta"), Some((1, 2, 3)));
        assert_eq!(parse_version("unknown"), None);
    }

    #[test]
    fn version_support_matches_minimum_policy() {
        assert!(is_version_supported("2.1.177"));
        assert!(is_version_supported("99.0.0"));
        assert!(!is_version_supported("2.1.176"));
        assert!(!is_version_supported("garbage"));
    }

    #[test]
    fn classifies_authentication_smoke_failures() {
        assert_eq!(
            smoke_failure("", "Please run /login to authenticate"),
            AgentProbeFailure::AuthenticationRequired {
                details: "Please run /login to authenticate".to_string()
            }
        );
        assert_eq!(
            smoke_failure("", "model request failed"),
            AgentProbeFailure::SmokeTestFailed {
                details: "model request failed".to_string()
            }
        );
    }

    #[test]
    fn classifies_codelayer_codex_auth_failures_and_bounds_diagnostics() {
        assert!(matches!(
            codex_smoke_failure("", "Missing auth for provider: codex"),
            AgentProbeFailure::AuthenticationRequired { .. }
        ));
        assert!(matches!(
            codex_smoke_failure("", "Invalid token for provider: codex"),
            AgentProbeFailure::AuthenticationRequired { .. }
        ));
        assert!(matches!(
            codex_smoke_failure("", "HTTP 401 Unauthorized"),
            AgentProbeFailure::AuthenticationRequired { .. }
        ));

        let details = bounded_combined_output(&"x".repeat(5_000), "useful error", "fallback");
        assert!(details.starts_with("stderr: useful error\nstdout: "));
        assert!(details.ends_with("[output truncated]"));
        assert!(details.len() <= MAX_FAILURE_DETAILS_BYTES + "\n[output truncated]".len());
    }

    #[test]
    fn requires_the_codelayer_final_message_marker() {
        assert!(codelayer_codex_smoke_succeeded(
            "codelayer output\n__CODELAYER_FINAL_MESSAGE_START__hi__CODELAYER_FINAL_MESSAGE_END__\n[Done]"
        ));
        assert!(!codelayer_codex_smoke_succeeded("hi"));
        assert!(!codelayer_codex_smoke_succeeded(
            "__CODELAYER_FINAL_MESSAGE_START__hello__CODELAYER_FINAL_MESSAGE_END__"
        ));
    }

    #[test]
    fn serializes_probe_results_for_the_renderer_contract() {
        let value = serde_json::to_value(AgentProbeResult::Ready {
            agent: CodingAgent::Claude,
            path: "/usr/local/bin/claude".to_string(),
            version: "2.1.177".to_string(),
            installation_source: "homebrew".to_string(),
            checked_at: 42,
        })
        .unwrap();

        assert_eq!(value["status"], "ready");
        assert_eq!(value["agent"], "claude");
        assert_eq!(value["installationSource"], "homebrew");
        assert_eq!(value["checkedAt"], 42);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn exact_path_probe_runs_version_and_smoke_without_claudecode() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let directory =
            std::env::temp_dir().join(format!("riptide-agent-probe-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let executable = directory.join("claude");
        fs::write(
            &executable,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '2.1.177 (Claude Code)'; exit 0; fi\nif [ -n \"${CLAUDECODE+x}\" ] || [ -n \"${CLAUDE_CODE_ENTRYPOINT+x}\" ]; then printf 'Claude parent marker leaked' >&2; exit 2; fi\nif [ \"$1 $2 $3 $4 $5\" != \"-p hi --model haiku \" ]; then printf 'bad args: %s' \"$*\" >&2; exit 3; fi\nprintf 'Hello'\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();
        std::env::set_var("CLAUDECODE", "parent-session");
        std::env::set_var("CLAUDE_CODE_ENTRYPOINT", "cli");

        let result = probe_coding_agent(ProbeCodingAgentInput {
            agent: CodingAgent::Claude,
            preferred_path: Some(executable.to_string_lossy().to_string()),
        })
        .await;

        std::env::remove_var("CLAUDECODE");
        std::env::remove_var("CLAUDE_CODE_ENTRYPOINT");
        fs::remove_dir_all(directory).unwrap();
        assert!(matches!(result, AgentProbeResult::Ready { .. }));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn exact_humanlayer_path_probe_runs_codelayer_codex_smoke() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let directory =
            std::env::temp_dir().join(format!("riptide-codelayer-probe-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let executable = directory.join("humanlayer");
        fs::write(
            &executable,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'humanlayer-cli 1.0.0'; exit 0; fi\nif [ \"$*\" != \"codelayer --prompt respond with hi and nothing else --model gpt-5.6-luna --provider codex\" ]; then printf 'bad args: %s' \"$*\" >&2; exit 3; fi\nprintf 'progress\\n__CODELAYER_FINAL_MESSAGE_START__hi__CODELAYER_FINAL_MESSAGE_END__\\n[Done]'\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();

        let result = probe_coding_agent(ProbeCodingAgentInput {
            agent: CodingAgent::Codex,
            preferred_path: Some(executable.to_string_lossy().to_string()),
        })
        .await;

        fs::remove_dir_all(directory).unwrap();
        assert!(matches!(result, AgentProbeResult::Ready { .. }));
    }
}
