use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredGitRemote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredGitRepository {
    pub path: String,
    pub name: String,
    pub remotes: Vec<DiscoveredGitRemote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_remote: Option<String>,
    pub default_branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
}

#[tauri::command]
pub async fn discover_git_repositories(directory: String) -> Result<Vec<DiscoveredGitRepository>, String> {
    let selected = PathBuf::from(shellexpand::tilde(&directory).to_string());
    if let Some(repository) = inspect_git_repository(&selected) {
        return Ok(vec![repository]);
    }

    let mut repositories = Vec::new();
    for entry in std::fs::read_dir(&selected).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            if let Some(repository) = inspect_git_repository(&entry.path()) {
                repositories.push(repository);
            }
        }
    }
    repositories.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(repositories)
}

fn inspect_git_repository(directory: &std::path::Path) -> Option<DiscoveredGitRepository> {
    let canonical = directory.canonicalize().ok()?;
    let top_level = git_output(directory, &["rev-parse", "--show-toplevel"])?;
    if PathBuf::from(top_level.trim()).canonicalize().ok()? != canonical {
        return None;
    }

    let mut remotes = Vec::new();
    if let Some(remote_lines) = git_output(directory, &["remote", "-v"]) {
        for line in remote_lines.lines() {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() == 3 && fields[2] == "(fetch)" && !remotes.iter().any(|remote: &DiscoveredGitRemote| remote.name == fields[0]) {
                remotes.push(DiscoveredGitRemote { name: fields[0].to_string(), url: fields[1].to_string() });
            }
        }
    }

    let default_remote = remotes
        .iter()
        .find(|remote| remote.name == "origin")
        .or_else(|| remotes.first())
        .map(|remote| remote.name.clone());
    let remote_head = default_remote
        .as_ref()
        .map(|remote| format!("refs/remotes/{remote}/HEAD"));
    let remote_source_ref = remote_head
        .as_ref()
        .and_then(|remote_head| git_output(directory, &["symbolic-ref", "--short", remote_head]))
        .map(|branch| branch.trim().to_string())
        .filter(|branch| !branch.is_empty());
    let local_branch = git_output(directory, &["branch", "--show-current"])
        .map(|branch| branch.trim().to_string())
        .filter(|branch| !branch.is_empty());
    let source_ref = remote_source_ref
        .clone()
        .or_else(|| local_branch.clone())
        .unwrap_or_else(|| "HEAD".to_string());
    let default_branch = remote_source_ref
        .as_deref()
        .map(|branch| {
            default_remote
                .as_ref()
                .and_then(|remote| branch.strip_prefix(&format!("{remote}/")))
                .unwrap_or(branch)
                .to_string()
        })
        .or(local_branch)
        .unwrap_or_else(|| "main".to_string());

    Some(DiscoveredGitRepository {
        path: canonical.to_string_lossy().to_string(),
        name: canonical.file_name()?.to_string_lossy().to_string(),
        remotes,
        default_remote,
        default_branch,
        source_ref: Some(source_ref),
    })
}

fn git_output(directory: &std::path::Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(directory)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;
    if !output.status.success() { return None; }
    String::from_utf8(output.stdout).ok()
}

/// Result returned by workspace_config_read
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfigReadResult {
    /// Raw file contents, null when the file does not exist
    pub content: Option<String>,
    /// Whether the file exists
    pub exists: bool,
    /// Whether the selected directory is inside a Git repository. Only returned for the repo config read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_inside_git_repository: Option<bool>,
    /// Metadata when the selected directory is itself a Git repository root.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_repository: Option<DiscoveredGitRepository>,
}

/// Which config file to operate on
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceConfigTarget {
    #[serde(rename = "repo")]
    Repo,
    #[serde(rename = "local")]
    Local,
}

/// Returns the absolute path to the requested config file.
fn config_file_path(directory: &str, target: &WorkspaceConfigTarget) -> PathBuf {
    let expanded = shellexpand::tilde(directory).to_string();
    let dir = PathBuf::from(expanded);
    let file_name = match target {
        WorkspaceConfigTarget::Repo => "workspace.json",
        WorkspaceConfigTarget::Local => "workspace.local.json",
    };
    dir.join(".humanlayer").join(file_name)
}

/// Read a workspace config file (.humanlayer/workspace.json or .humanlayer/workspace.local.json)
/// from the given working directory.
///
/// Returns the raw file content and an exists flag. Content is None when the file
/// does not exist.
#[tauri::command]
pub async fn workspace_config_read(
    directory: String,
    target: WorkspaceConfigTarget,
) -> Result<WorkspaceConfigReadResult, String> {
    let selected_repository = if matches!(target, WorkspaceConfigTarget::Repo) {
        let selected = PathBuf::from(shellexpand::tilde(&directory).to_string());
        inspect_git_repository(&selected)
    } else {
        None
    };
    let is_inside_git_repository = if matches!(target, WorkspaceConfigTarget::Repo) {
        Some(
            Command::new("git")
                .arg("-C")
                .arg(shellexpand::tilde(&directory).to_string())
                .args(["rev-parse", "--is-inside-work-tree"])
                .env("GIT_TERMINAL_PROMPT", "0")
                .output()
                .map(|output| {
                    output.status.success()
                        && String::from_utf8_lossy(&output.stdout).trim() == "true"
                })
                .unwrap_or(false),
        )
    } else {
        None
    };
    let path = config_file_path(&directory, &target);

    if !path.exists() {
        return Ok(WorkspaceConfigReadResult {
            content: None,
            exists: false,
            is_inside_git_repository,
            selected_repository,
        });
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    Ok(WorkspaceConfigReadResult {
        content: Some(content),
        exists: true,
        is_inside_git_repository,
        selected_repository,
    })
}

/// Write content to a workspace config file, creating parent directories as needed.
#[tauri::command]
pub async fn workspace_config_write(
    directory: String,
    target: WorkspaceConfigTarget,
    content: String,
) -> Result<(), String> {
    let path = config_file_path(&directory, &target);

    // Create parent directory (.humanlayer/) if it does not exist
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
    }

    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;

    log::info!("Wrote workspace config: {}", path.display());
    Ok(())
}

/// Ensure that .humanlayer/workspace.local.json is listed in the repo's .gitignore.
///
/// If .gitignore does not exist, it is created. If the entry is already present
/// (exact match), nothing is changed.
#[tauri::command]
pub async fn workspace_config_ensure_gitignore(directory: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&directory).to_string();
    let dir = PathBuf::from(expanded);
    let gitignore_path = dir.join(".gitignore");

    let entry = ".humanlayer/workspace.local.json";

    if gitignore_path.exists() {
        let current = std::fs::read_to_string(&gitignore_path)
            .map_err(|e| format!("Failed to read .gitignore: {}", e))?;

        // Check if the entry is already present as a whole line
        if current.lines().any(|line| line.trim() == entry) {
            log::info!(".gitignore already contains entry for {}", entry);
            return Ok(());
        }

        // Append with a trailing newline
        let append = if current.ends_with('\n') {
            format!("{}\n", entry)
        } else {
            format!("\n{}\n", entry)
        };

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&gitignore_path)
            .map_err(|e| format!("Failed to open .gitignore for append: {}", e))?;

        use std::io::Write;
        file.write_all(append.as_bytes())
            .map_err(|e| format!("Failed to write to .gitignore: {}", e))?;

        log::info!("Appended {} to .gitignore", entry);
    } else {
        // Create .gitignore with the entry
        std::fs::write(&gitignore_path, format!("{}\n", entry))
            .map_err(|e| format!("Failed to create .gitignore: {}", e))?;

        log::info!("Created .gitignore with entry for {}", entry);
    }

    Ok(())
}

/// Open a workspace config file in the user's configured editor.
///
/// If the file does not yet exist, it is created from `preview_content` before
/// the editor is launched. This matches the design intent: "Open in editor" on
/// a missing file creates the file from the current preview, then opens it.
#[tauri::command]
pub async fn workspace_config_open_in_editor(
    app: tauri::AppHandle,
    directory: String,
    target: WorkspaceConfigTarget,
    preview_content: String,
    editor: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let path = config_file_path(&directory, &target);

    // If the file does not exist, create it from the preview
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
        std::fs::write(&path, &preview_content)
            .map_err(|e| format!("Failed to create config file from preview: {}", e))?;
        log::info!("Created config file from preview: {}", path.display());
    }

    let path_str = path
        .to_str()
        .ok_or_else(|| "Config file path contains invalid UTF-8".to_string())?;

    let opener = app.opener();

    if let Some(editor_cmd) = editor {
        let app_name = match editor_cmd.as_str() {
            "cursor" => get_cursor_app_name(),
            "code" => get_vscode_app_name(),
            "zed" => get_zed_app_name(),
            _ => return Err(format!("Unsupported editor: {}", editor_cmd)),
        };

        // Check editor exists before trying to open
        check_editor_exists(app_name)?;

        opener
            .open_path(path_str, app_name)
            .map_err(|e| format!("Failed to open editor: {}", e))?;
    } else {
        opener
            .open_path(path_str, None::<&str>)
            .map_err(|e| format!("Failed to open with system default: {}", e))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Editor helpers (mirrored from lib.rs to keep this module self-contained)
// ---------------------------------------------------------------------------

fn check_editor_exists(app_name: Option<&str>) -> Result<(), String> {
    let Some(name) = app_name else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        let home_path = home.display();
        let locations = vec![
            format!("/Applications/{}.app", name),
            format!("{}/Applications/{}.app", home_path, name),
            format!("/System/Applications/{}.app", name),
        ];

        for location in locations {
            if std::path::Path::new(&location).exists() {
                return Ok(());
            }
        }

        return Err(format!(
            "{} is not installed. Please install it from https://{}",
            name,
            match name {
                "Cursor" => "cursor.sh",
                "Visual Studio Code" => "code.visualstudio.com",
                "Zed" => "zed.dev",
                _ => "the editor's website",
            }
        ));
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let output = Command::new("which")
            .arg(name)
            .output()
            .map_err(|e| format!("Failed to check if {} exists: {}", name, e))?;

        if !output.status.success() {
            return Err(format!(
                "{} is not installed or not in PATH. Please install it first.",
                name
            ));
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let output = Command::new("where")
            .arg(name)
            .output()
            .map_err(|e| format!("Failed to check if {} exists: {}", name, e))?;

        if !output.status.success() {
            return Err(format!(
                "{} is not installed. Please install it first.",
                name
            ));
        }
        Ok(())
    }
}

fn get_cursor_app_name() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    return Some("Cursor");
    #[cfg(target_os = "windows")]
    return Some("Cursor");
    #[cfg(target_os = "linux")]
    return Some("cursor");
}

fn get_vscode_app_name() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    return Some("Visual Studio Code");
    #[cfg(target_os = "windows")]
    return Some("Code");
    #[cfg(target_os = "linux")]
    return Some("code");
}

fn get_zed_app_name() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    return Some("Zed");
    #[cfg(target_os = "windows")]
    return Some("Zed");
    #[cfg(target_os = "linux")]
    return Some("zed");
}

// ---------------------------------------------------------------------------
// Worktree-now lifecycle commands
// ---------------------------------------------------------------------------
//
// These commands implement the `workspaceTiming = now` setup pipeline.
// They run entirely before the DB task row is created, so the task starts
// with its final working directory already prepared.
//
// Pipeline order:
//   1. workspace_preflight   — validate every repo before any mutation
//   2. workspace_create      — git worktree add for all repos
//   3. workspace_copy_globs  — copy configured files into created worktrees
//   4. workspace_run_setup   — run the setup command for one repo worktree
//   5. workspace_remove_all  — cleanup: remove all created worktrees (no parent)

/// Input to workspace_preflight.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreflightInput {
    /// Absolute path to the selected working directory (the "." repo).
    pub selected_directory: String,
    /// The repos to preflight, each with resolved effective fields.
    pub repos: Vec<WorkspaceRepoInput>,
}

/// A single resolved repo entry passed from the TypeScript layer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepoInput {
    /// Path relative to selectedDirectory ("." or "../sibling").
    pub local_path: String,
    /// Rendered absolute target worktree path (tilde expanded by TS).
    pub target_path: String,
    /// Branch name (already rendered from branchTemplate).
    pub branch: String,
    /// Git ref to create the worktree from ("HEAD", "origin/main", etc.).
    pub source_ref: String,
    /// Remote used to publish and track the task branch. Inferred when omitted.
    pub branch_remote: Option<String>,
    /// Glob patterns to copy (relative to source repo root).
    pub copy_globs: Vec<String>,
}

/// Per-repo preflight result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepoPreflightResult {
    pub local_path: String,
    pub target_path: String,
    pub ok: bool,
    /// Non-empty when `ok` is false.
    pub error: String,
}

/// Overall preflight result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreflightResult {
    pub ok: bool,
    pub repos: Vec<WorkspaceRepoPreflightResult>,
}

/// Preflight every repo in the workspace config before any mutation.
///
/// Checks (per repo):
///   - Source repo exists and is a git repository
///   - Target worktree path does not already exist
///   - Branch does not already exist in the source repo
///   - sourceRef is resolvable (fetches remote first when needed)
///
/// Config invariants (e.g. exactly one primary repo, common-parent target
/// paths) are owned and validated by the TypeScript layer before this runs;
/// Rust only validates git facts and the filesystem.
#[tauri::command]
pub async fn workspace_preflight(
    input: WorkspacePreflightInput,
) -> Result<WorkspacePreflightResult, String> {
    let selected_expanded = shellexpand::tilde(&input.selected_directory).to_string();
    let selected_dir = PathBuf::from(&selected_expanded);

    let mut repo_results = Vec::new();
    let mut all_ok = true;

    for repo in &input.repos {
        let source_dir = resolve_repo_path(&selected_dir, &repo.local_path);
        let target_path_expanded = shellexpand::tilde(&repo.target_path).to_string();
        let target_path = PathBuf::from(&target_path_expanded);

        let result = preflight_repo(repo, &source_dir, &target_path);
        if !result.ok {
            all_ok = false;
        }
        repo_results.push(result);
    }

    Ok(WorkspacePreflightResult {
        ok: all_ok,
        repos: repo_results,
    })
}

fn resolve_repo_path(selected_dir: &PathBuf, local_path: &str) -> PathBuf {
    if local_path == "." {
        selected_dir.clone()
    } else {
        // Normalize: join then canonicalize-like resolution without actually hitting FS
        let joined = selected_dir.join(local_path);
        // Use std::path to normalize the path (removes .. components where possible)
        joined
    }
}

fn source_git_command(source_dir: &PathBuf) -> std::process::Command {
    let mut command = std::process::Command::new("git");
    command.args(["-C", &source_dir.to_string_lossy(), "-c", "core.bare=false"]);
    command
}

fn preflight_repo(
    repo: &WorkspaceRepoInput,
    source_dir: &PathBuf,
    target_path: &PathBuf,
) -> WorkspaceRepoPreflightResult {
    let mk_err = |msg: String| WorkspaceRepoPreflightResult {
        local_path: repo.local_path.clone(),
        target_path: repo.target_path.clone(),
        ok: false,
        error: msg,
    };
    let mk_ok = || WorkspaceRepoPreflightResult {
        local_path: repo.local_path.clone(),
        target_path: repo.target_path.clone(),
        ok: true,
        error: String::new(),
    };

    // 1. Source repo must exist
    if !source_dir.exists() {
        return mk_err(format!(
            "Source directory does not exist: {}",
            source_dir.display()
        ));
    }

    // 2. Source repo must be a git repository
    let git_check = source_git_command(source_dir)
        .args(["rev-parse", "--git-dir"])
        .output();
    match git_check {
        Ok(out) if !out.status.success() => {
            return mk_err(format!("Not a git repository: {}", source_dir.display()));
        }
        Err(e) => {
            return mk_err(format!("Failed to run git: {}", e));
        }
        _ => {}
    }

    // 3. Target path must not already exist
    if target_path.exists() {
        return mk_err(format!(
            "Target path already exists: {}. Delete it or choose a different task slug.",
            target_path.display()
        ));
    }

    // 4. Branch must not already exist (local only per v1 spec)
    let branch_check = source_git_command(source_dir)
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{}", repo.branch),
        ])
        .output();
    match branch_check {
        Ok(out) if out.status.success() => {
            return mk_err(format!(
                "Branch '{}' already exists in {}. Delete it or change the task slug.",
                repo.branch,
                source_dir.display()
            ));
        }
        Err(e) => {
            return mk_err(format!("Failed to check branch: {}", e));
        }
        _ => {} // non-zero exit = branch doesn't exist, which is what we want
    }

    // 5. sourceRef must be resolvable. If it looks like a remote ref, fetch first.
    // Remote detection: check if the prefix before "/" is a configured remote.
    let source_ref = &repo.source_ref;
    if let Some(slash_pos) = source_ref.find('/') {
        let potential_remote = &source_ref[..slash_pos];
        // Check if it's a known remote
        let remotes_out = source_git_command(source_dir)
            .args(["remote"])
            .output()
            .ok();
        let remotes = remotes_out
            .as_ref()
            .map(|o| String::from_utf8_lossy(&o.stdout))
            .unwrap_or_default();
        let is_remote = remotes.lines().any(|r| r.trim() == potential_remote);

        if is_remote {
            // Fetch remote before checking
            let fetch_out = source_git_command(source_dir)
                .args(["fetch", potential_remote])
                .output();
            if let Err(e) = fetch_out {
                return mk_err(format!(
                    "Failed to fetch remote '{}': {}",
                    potential_remote, e
                ));
            }
        }
    }

    // Verify the ref resolves
    let ref_check = source_git_command(source_dir)
        .args(["rev-parse", "--verify", source_ref.as_str()])
        .output();
    match ref_check {
        Ok(out) if !out.status.success() => {
            return mk_err(format!(
                "sourceRef '{}' does not resolve in {}.",
                source_ref,
                source_dir.display()
            ));
        }
        Err(e) => {
            return mk_err(format!("Failed to verify sourceRef: {}", e));
        }
        _ => {}
    }

    mk_ok()
}

// ---------------------------------------------------------------------------

/// Input for workspace_create.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateInput {
    pub selected_directory: String,
    pub repos: Vec<WorkspaceRepoInput>,
}

/// Per-repo creation result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepoCreateResult {
    pub local_path: String,
    pub target_path: String,
    /// Absolute (tilde-expanded) target worktree path.
    pub expanded_target_path: String,
    /// Source ref resolved before worktree creation.
    pub resolved_source_ref: Option<String>,
    /// Git remote URL selected for the source ref, captured best-effort.
    pub remote_url: Option<String>,
    /// Exact commit SHA used to create the worktree.
    pub resolved_sha: Option<String>,
    pub ok: bool,
    pub error: String,
}

/// Overall workspace creation result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateResult {
    pub ok: bool,
    pub repos: Vec<WorkspaceRepoCreateResult>,
}

/// Create all git worktrees for the workspace.
///
/// Runs `git worktree add -b <branch> <target_path> <sourceRef>` for each repo.
/// Creates parent directories for target paths as needed.
/// Stops on first failure and returns partial results.
#[tauri::command]
pub async fn workspace_create(
    input: WorkspaceCreateInput,
) -> Result<WorkspaceCreateResult, String> {
    let selected_expanded = shellexpand::tilde(&input.selected_directory).to_string();
    let selected_dir = PathBuf::from(&selected_expanded);

    let mut repo_results = Vec::new();
    let mut all_ok = true;

    for repo in &input.repos {
        let source_dir = resolve_repo_path(&selected_dir, &repo.local_path);
        let target_path_expanded = shellexpand::tilde(&repo.target_path).to_string();
        let target_path = PathBuf::from(&target_path_expanded);

        let mk_err = |msg: String| WorkspaceRepoCreateResult {
            local_path: repo.local_path.clone(),
            target_path: repo.target_path.clone(),
            expanded_target_path: target_path_expanded.clone(),
            resolved_source_ref: None,
            remote_url: None,
            resolved_sha: None,
            ok: false,
            error: msg,
        };

        let source_identity = match resolve_source_identity(&source_dir, &repo.source_ref) {
            Ok(identity) => identity,
            Err(error) => {
                repo_results.push(mk_err(error));
                all_ok = false;
                break;
            }
        };

        // Create parent directory if needed
        if let Some(parent) = target_path.parent() {
            if !parent.exists() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    repo_results.push(mk_err(format!(
                        "Failed to create parent directory {}: {}",
                        parent.display(),
                        e
                    )));
                    all_ok = false;
                    break;
                }
            }
        }

        // Create from the resolved commit so source ref movement cannot change the anchor.
        let out = source_git_command(&source_dir)
            .args([
                "worktree",
                "add",
                "-b",
                &repo.branch,
                &target_path.to_string_lossy(),
                &source_identity.resolved_sha,
            ])
            .output();

        match out {
            Ok(o) if o.status.success() => {
                log::info!(
                    "[workspace_create] Created worktree {} -> {}",
                    repo.local_path,
                    target_path.display()
                );
                repo_results.push(WorkspaceRepoCreateResult {
                    local_path: repo.local_path.clone(),
                    target_path: repo.target_path.clone(),
                    expanded_target_path: target_path_expanded.clone(),
                    resolved_source_ref: Some(source_identity.resolved_source_ref),
                    remote_url: source_identity.remote_url,
                    resolved_sha: Some(source_identity.resolved_sha),
                    ok: true,
                    error: String::new(),
                });
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                repo_results.push(mk_err(format!("git worktree add failed: {}", stderr)));
                all_ok = false;
                break;
            }
            Err(e) => {
                repo_results.push(mk_err(format!("Failed to run git: {}", e)));
                all_ok = false;
                break;
            }
        }
    }

    Ok(WorkspaceCreateResult {
        ok: all_ok,
        repos: repo_results,
    })
}

#[derive(Debug, PartialEq)]
struct WorkspaceSourceIdentity {
    resolved_source_ref: String,
    resolved_sha: String,
    remote_url: Option<String>,
}

fn git_stdout(source_dir: &PathBuf, args: &[&str]) -> Result<String, String> {
    let output = source_git_command(source_dir)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run git {}: {}", args.join(" "), error))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn configured_remotes(source_dir: &PathBuf) -> Vec<String> {
    let mut remotes = git_stdout(source_dir, &["remote"])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    remotes.sort();
    remotes
}

fn source_remote(resolved_source_ref: &str, remotes: &[String]) -> Option<String> {
    let remote_ref = resolved_source_ref
        .strip_prefix("refs/remotes/")
        .unwrap_or(resolved_source_ref);
    remotes
        .iter()
        .find(|remote| remote_ref.starts_with(&format!("{remote}/")))
        .cloned()
}

fn capture_remote_url(
    source_dir: &PathBuf,
    resolved_source_ref: &str,
    remotes: &[String],
) -> Option<String> {
    let mut candidates = Vec::new();
    if let Some(remote) = source_remote(resolved_source_ref, remotes) {
        candidates.push(remote);
    }
    for remote in ["origin", "upstream"] {
        if remotes.iter().any(|candidate| candidate == remote)
            && !candidates.iter().any(|candidate| candidate == remote)
        {
            candidates.push(remote.to_string());
        }
    }
    for remote in remotes {
        if !candidates.contains(remote) {
            candidates.push(remote.clone());
        }
    }

    for remote in candidates {
        match git_stdout(source_dir, &["remote", "get-url", &remote]) {
            Ok(url) if !url.is_empty() => return Some(url),
            Ok(_) => {}
            Err(error) => log::warn!(
                "[workspace_create] Could not capture remote URL for {} in {}: {}",
                remote,
                source_dir.display(),
                error
            ),
        }
    }
    None
}

fn resolve_source_identity(
    source_dir: &PathBuf,
    configured_source_ref: &str,
) -> Result<WorkspaceSourceIdentity, String> {
    let resolved_source_ref = if configured_source_ref == "HEAD" {
        git_stdout(
            source_dir,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )
        .ok()
        .filter(|source_ref| !source_ref.is_empty())
        .or_else(|| {
            git_stdout(source_dir, &["symbolic-ref", "--quiet", "--short", "HEAD"])
                .ok()
                .filter(|source_ref| !source_ref.is_empty())
        })
        .unwrap_or_else(|| "HEAD".to_string())
    } else {
        configured_source_ref.to_string()
    };

    let commit_input = format!("{}^{{commit}}", resolved_source_ref);
    let resolved_sha =
        git_stdout(source_dir, &["rev-parse", "--verify", &commit_input]).map_err(|error| {
            format!(
                "sourceRef '{}' does not resolve to a commit in {}: {}",
                resolved_source_ref,
                source_dir.display(),
                error
            )
        })?;
    if resolved_sha.is_empty() {
        return Err(format!(
            "sourceRef '{}' resolved to an empty commit in {}",
            resolved_source_ref,
            source_dir.display()
        ));
    }

    let remotes = configured_remotes(source_dir);
    let remote_url = capture_remote_url(source_dir, &resolved_source_ref, &remotes);

    Ok(WorkspaceSourceIdentity {
        resolved_source_ref,
        resolved_sha,
        remote_url,
    })
}

// ---------------------------------------------------------------------------

/// Input for workspace_copy_globs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCopyGlobsInput {
    pub selected_directory: String,
    pub repos: Vec<WorkspaceRepoInput>,
}

/// Per-repo copy result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepoCopyResult {
    pub local_path: String,
    pub files_copied: u32,
    pub ok: bool,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCopyGlobsResult {
    pub ok: bool,
    pub repos: Vec<WorkspaceRepoCopyResult>,
}

/// Copy configured glob patterns into each created worktree.
///
/// For each repo, resolves every glob pattern relative to the source repo root
/// and copies matched regular files to the same relative path under the
/// corresponding target worktree. Missing matches silently no-op.
/// Destination files are overwritten.
#[tauri::command]
pub async fn workspace_copy_globs(
    input: WorkspaceCopyGlobsInput,
) -> Result<WorkspaceCopyGlobsResult, String> {
    log::info!(
        "[workspace_copy_globs] Called with selectedDirectory={}, repos count={}",
        input.selected_directory,
        input.repos.len()
    );

    let selected_expanded = shellexpand::tilde(&input.selected_directory).to_string();
    let selected_dir = PathBuf::from(&selected_expanded);

    let mut repo_results = Vec::new();
    let mut all_ok = true;

    for repo in &input.repos {
        log::info!(
            "[workspace_copy_globs] Repo localPath={}, copyGlobs count={}, globs={:?}",
            repo.local_path,
            repo.copy_globs.len(),
            repo.copy_globs
        );
        if repo.copy_globs.is_empty() {
            repo_results.push(WorkspaceRepoCopyResult {
                local_path: repo.local_path.clone(),
                files_copied: 0,
                ok: true,
                error: String::new(),
            });
            continue;
        }

        let source_dir = resolve_repo_path(&selected_dir, &repo.local_path);
        let target_path_expanded = shellexpand::tilde(&repo.target_path).to_string();
        let target_dir = PathBuf::from(&target_path_expanded);

        let result =
            copy_globs_for_repo(&source_dir, &target_dir, &repo.copy_globs, &repo.local_path);
        if !result.ok {
            all_ok = false;
        }
        repo_results.push(result);
    }

    Ok(WorkspaceCopyGlobsResult {
        ok: all_ok,
        repos: repo_results,
    })
}

fn copy_globs_for_repo(
    source_dir: &PathBuf,
    target_dir: &PathBuf,
    copy_globs: &[String],
    local_path: &str,
) -> WorkspaceRepoCopyResult {
    use glob::glob;

    let mk_err = |msg: String| WorkspaceRepoCopyResult {
        local_path: local_path.to_string(),
        files_copied: 0,
        ok: false,
        error: msg,
    };

    let mut files_copied = 0u32;

    for pattern in copy_globs {
        // Resolve pattern relative to the source repo root
        let full_pattern = format!("{}/{}", source_dir.display(), pattern);

        let entries = match glob(&full_pattern) {
            Ok(e) => e,
            Err(e) => {
                return mk_err(format!("Invalid glob pattern '{}': {}", pattern, e));
            }
        };

        for entry in entries {
            match entry {
                Ok(src_path) => {
                    // Only copy regular files (not directories or symlinks)
                    let metadata = match std::fs::metadata(&src_path) {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    if !metadata.is_file() {
                        continue;
                    }

                    // Compute relative path from source_dir to src_path
                    let relative = match src_path.strip_prefix(source_dir) {
                        Ok(r) => r.to_path_buf(),
                        Err(_) => {
                            // Path escaped source dir — skip for safety
                            log::warn!(
                                "[workspace_copy_globs] Glob match {} escaped source dir, skipping",
                                src_path.display()
                            );
                            continue;
                        }
                    };

                    let dest_path = target_dir.join(&relative);

                    // Create parent directories
                    if let Some(parent) = dest_path.parent() {
                        if !parent.exists() {
                            if let Err(e) = std::fs::create_dir_all(parent) {
                                log::warn!(
                                    "[workspace_copy_globs] Failed to create parent dir {}: {}",
                                    parent.display(),
                                    e
                                );
                                continue;
                            }
                        }
                    }

                    // Copy file (overwrite destination)
                    match std::fs::copy(&src_path, &dest_path) {
                        Ok(_) => {
                            files_copied += 1;
                            log::debug!(
                                "[workspace_copy_globs] Copied {} -> {}",
                                src_path.display(),
                                dest_path.display()
                            );
                        }
                        Err(e) => {
                            log::warn!(
                                "[workspace_copy_globs] Failed to copy {} -> {}: {}",
                                src_path.display(),
                                dest_path.display(),
                                e
                            );
                        }
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[workspace_copy_globs] Glob error for pattern '{}': {}",
                        pattern,
                        e
                    );
                }
            }
        }
    }

    WorkspaceRepoCopyResult {
        local_path: local_path.to_string(),
        files_copied,
        ok: true,
        error: String::new(),
    }
}

// ---------------------------------------------------------------------------

/// Input for workspace_run_setup — runs the setup command for ONE repo.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRunSetupInput {
    /// The repo's target worktree directory (already created).
    pub target_path: String,
    /// The setup command to run in the worktree.
    pub setup_command: String,
    /// localPath identifier for logging/result attribution.
    pub local_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRunSetupResult {
    pub local_path: String,
    pub ok: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub error: String,
}

/// Run the setup command for a single repo worktree.
///
/// The command is executed via the system shell (`sh -c <command>`) inside
/// the target worktree directory. Called once per repo that has a non-empty
/// setup command, sequentially after all worktrees are created.
///
/// A non-zero exit code is returned as `ok: false` with the exit code,
/// stdout, and stderr captured. The Retry / Proceed Anyway / Remove All
/// decision is handled in the UI layer.
#[tauri::command]
pub async fn workspace_run_setup(
    input: WorkspaceRunSetupInput,
) -> Result<WorkspaceRunSetupResult, String> {
    use std::process::Command;

    let target_expanded = shellexpand::tilde(&input.target_path).to_string();
    let target_path = PathBuf::from(&target_expanded);

    if input.setup_command.is_empty() {
        return Ok(WorkspaceRunSetupResult {
            local_path: input.local_path,
            ok: true,
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            error: String::new(),
        });
    }

    if !target_path.exists() {
        return Ok(WorkspaceRunSetupResult {
            local_path: input.local_path.clone(),
            ok: false,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            error: format!(
                "Target worktree path does not exist: {}",
                target_path.display()
            ),
        });
    }

    log::info!(
        "[workspace_run_setup] Running setup command in {}: {}",
        target_path.display(),
        input.setup_command
    );

    let output = Command::new("sh")
        .arg("-c")
        .arg(&input.setup_command)
        .current_dir(&target_path)
        .output();

    match output {
        Ok(out) => {
            let exit_code = out.status.code().unwrap_or(-1);
            let ok = out.status.success();
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();

            if !ok {
                log::warn!(
                    "[workspace_run_setup] Setup command exited {} in {}: {}",
                    exit_code,
                    target_path.display(),
                    stderr
                );
            }

            Ok(WorkspaceRunSetupResult {
                local_path: input.local_path,
                ok,
                exit_code,
                stdout,
                stderr,
                error: String::new(),
            })
        }
        Err(e) => Ok(WorkspaceRunSetupResult {
            local_path: input.local_path,
            ok: false,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            error: format!("Failed to run setup command: {}", e),
        }),
    }
}

// ---------------------------------------------------------------------------

/// Input for workspace_remove_all — cleanup after a failed setup run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRemoveAllInput {
    pub selected_directory: String,
    /// The repos whose worktrees were created and should be removed.
    pub repos: Vec<WorkspaceRepoInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRemoveAllResult {
    pub ok: bool,
    /// Any repos that failed to remove.
    pub failed_removals: Vec<String>,
    pub error: String,
}

/// Remove all worktrees created during a workspace-now setup run.
///
/// Uses `git worktree remove --force <target_path>` from the source repo.
/// Removes only the target worktree directories, never the parent workspace
/// directory. If cleanup fails for a repo, the error is surfaced rather than
/// silently ignored.
///
/// Per design: "Remove All Worktrees removes the worktrees created for this
/// setup run, not the parent workspace directory."
#[tauri::command]
pub async fn workspace_remove_all(
    input: WorkspaceRemoveAllInput,
) -> Result<WorkspaceRemoveAllResult, String> {
    log::info!(
        "[workspace_remove_all] Starting cleanup: selectedDirectory={}, repos={}",
        input.selected_directory,
        input.repos.len()
    );

    let selected_expanded = shellexpand::tilde(&input.selected_directory).to_string();
    let selected_dir = PathBuf::from(&selected_expanded);

    let mut failed_removals: Vec<String> = Vec::new();

    // Remove in reverse order (last created first) to avoid dependency issues
    for repo in input.repos.iter().rev() {
        let source_dir = resolve_repo_path(&selected_dir, &repo.local_path);
        let target_path_expanded = shellexpand::tilde(&repo.target_path).to_string();
        let target_path = PathBuf::from(&target_path_expanded);

        log::info!(
            "[workspace_remove_all] Processing repo: localPath={}, targetPath={}, sourceDir={}",
            repo.local_path,
            target_path.display(),
            source_dir.display()
        );

        // Skip if the target path doesn't exist (may not have been created yet)
        if !target_path.exists() {
            log::info!(
                "[workspace_remove_all] Skipping non-existent target: {}",
                target_path.display()
            );
            continue;
        }

        // git worktree remove --force <target>
        let out = source_git_command(&source_dir)
            .args([
                "worktree",
                "remove",
                "--force",
                &target_path.to_string_lossy(),
            ])
            .output();

        match out {
            Ok(o) if o.status.success() => {
                log::info!(
                    "[workspace_remove_all] Removed worktree: {}",
                    target_path.display()
                );
                // Also delete the branch that was created
                let branch = &repo.branch;
                let _ = source_git_command(&source_dir)
                    .args(["branch", "-D", branch])
                    .output();
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                log::error!(
                    "[workspace_remove_all] Failed to remove {}: {}",
                    target_path.display(),
                    stderr
                );
                failed_removals.push(format!("{}: {}", target_path.display(), stderr));
            }
            Err(e) => {
                log::error!(
                    "[workspace_remove_all] Error removing {}: {}",
                    target_path.display(),
                    e
                );
                failed_removals.push(format!("{}: {}", target_path.display(), e));
            }
        }
    }

    let ok = failed_removals.is_empty();
    let error = if ok {
        String::new()
    } else {
        format!(
            "Failed to remove {} worktree(s). Manual cleanup may be needed.",
            failed_removals.len()
        )
    };

    log::info!(
        "[workspace_remove_all] Completed: ok={}, failedCount={}",
        ok,
        failed_removals.len()
    );

    Ok(WorkspaceRemoveAllResult {
        ok,
        failed_removals,
        error,
    })
}

#[cfg(test)]
mod workspace_setup_tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    #[test]
    fn workspace_config_read_serializes_repository_status_for_frontend() {
        for is_inside_git_repository in [true, false] {
            let result = WorkspaceConfigReadResult {
                content: None,
                exists: false,
                is_inside_git_repository: Some(is_inside_git_repository),
                selected_repository: None,
            };
            assert_eq!(
                serde_json::to_value(result).unwrap(),
                serde_json::json!({
                    "content": null,
                    "exists": false,
                    "isInsideGitRepository": is_inside_git_repository,
                })
            );
        }
    }

    #[test]
    fn workspace_config_read_omits_unchecked_repository_status() {
        let result = WorkspaceConfigReadResult {
            content: Some("{}".to_string()),
            exists: true,
            is_inside_git_repository: None,
            selected_repository: None,
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({ "content": "{}", "exists": true })
        );
    }

    #[test]
    fn workspace_config_read_serializes_selected_repository_metadata() {
        let result = WorkspaceConfigReadResult {
            content: None,
            exists: false,
            is_inside_git_repository: Some(true),
            selected_repository: Some(DiscoveredGitRepository {
                path: "/repo".to_string(),
                name: "repo".to_string(),
                remotes: vec![DiscoveredGitRemote {
                    name: "origin".to_string(),
                    url: "git@example.com:acme/repo.git".to_string(),
                }],
                default_remote: Some("origin".to_string()),
                default_branch: "trunk".to_string(),
                source_ref: Some("origin/trunk".to_string()),
            }),
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "content": null,
                "exists": false,
                "isInsideGitRepository": true,
                "selectedRepository": {
                    "path": "/repo",
                    "name": "repo",
                    "remotes": [{ "name": "origin", "url": "git@example.com:acme/repo.git" }],
                    "defaultRemote": "origin",
                    "defaultBranch": "trunk",
                    "sourceRef": "origin/trunk",
                },
            })
        );
    }

    struct TestRepo {
        path: PathBuf,
    }

    impl TestRepo {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("riptide-workspace-setup-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            git(&path, &["init", "-b", "main"]);
            git(&path, &["config", "user.email", "test@example.com"]);
            git(&path, &["config", "user.name", "Workspace Setup Test"]);
            std::fs::write(path.join("README.md"), "start\n").unwrap();
            git(&path, &["add", "README.md"]);
            git(&path, &["commit", "-m", "initial"]);
            Self { path }
        }

        fn head(&self) -> String {
            git(&self.path, &["rev-parse", "HEAD"])
        }

        fn add_remote(&self, name: &str, url: &str) {
            git(&self.path, &["remote", "add", name, url]);
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn git(repo: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[tokio::test]
    async fn workspace_config_read_discovers_the_selected_repository() {
        let repo = TestRepo::new();
        repo.add_remote("origin", "git@example.com:acme/repo.git");

        let result = workspace_config_read(
            repo.path.to_string_lossy().to_string(),
            WorkspaceConfigTarget::Repo,
        )
        .await
        .unwrap();

        assert!(result.is_inside_git_repository.unwrap());
        let selected = result.selected_repository.unwrap();
        assert_eq!(
            selected.path,
            repo.path.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(selected.default_branch, "main");
        assert_eq!(selected.default_remote.as_deref(), Some("origin"));
        assert_eq!(selected.source_ref.as_deref(), Some("main"));
        assert_eq!(selected.remotes.len(), 1);
        assert_eq!(selected.remotes[0].name, "origin");
    }

    #[tokio::test]
    async fn workspace_config_read_uses_head_for_a_detached_repository() {
        let repo = TestRepo::new();
        git(&repo.path, &["checkout", "--detach"]);

        let result = workspace_config_read(
            repo.path.to_string_lossy().to_string(),
            WorkspaceConfigTarget::Repo,
        )
        .await
        .unwrap();

        let selected = result.selected_repository.unwrap();
        assert_eq!(selected.default_branch, "main");
        assert_eq!(selected.source_ref.as_deref(), Some("HEAD"));
    }

    #[test]
    fn workspace_setup_resolves_tracked_head_to_upstream() {
        let repo = TestRepo::new();
        repo.add_remote("fork", "git@example.com:acme/fork.git");
        git(
            &repo.path,
            &["update-ref", "refs/remotes/fork/main", "HEAD"],
        );
        git(&repo.path, &["config", "branch.main.remote", "fork"]);
        git(
            &repo.path,
            &["config", "branch.main.merge", "refs/heads/main"],
        );

        let identity = resolve_source_identity(&repo.path, "HEAD").unwrap();

        assert_eq!(identity.resolved_source_ref, "fork/main");
        assert_eq!(identity.resolved_sha, repo.head());
        assert_eq!(
            identity.remote_url.as_deref(),
            Some("git@example.com:acme/fork.git")
        );
    }

    #[test]
    fn workspace_setup_resolves_untracked_head_to_local_branch() {
        let repo = TestRepo::new();

        let identity = resolve_source_identity(&repo.path, "HEAD").unwrap();

        assert_eq!(identity.resolved_source_ref, "main");
        assert_eq!(identity.resolved_sha, repo.head());
    }

    #[test]
    fn workspace_setup_keeps_head_for_detached_checkout() {
        let repo = TestRepo::new();
        let head = repo.head();
        git(&repo.path, &["checkout", "--detach", &head]);

        let identity = resolve_source_identity(&repo.path, "HEAD").unwrap();

        assert_eq!(identity.resolved_source_ref, "HEAD");
        assert_eq!(identity.resolved_sha, head);
    }

    #[test]
    fn workspace_setup_preserves_explicit_source_ref() {
        let repo = TestRepo::new();
        git(&repo.path, &["branch", "release"]);

        let identity = resolve_source_identity(&repo.path, "release").unwrap();

        assert_eq!(identity.resolved_source_ref, "release");
        assert_eq!(identity.resolved_sha, repo.head());
    }

    #[test]
    fn workspace_setup_prefers_source_remote_url() {
        let repo = TestRepo::new();
        repo.add_remote("origin", "git@example.com:acme/origin.git");
        repo.add_remote("source", "git@example.com:acme/source.git");
        git(
            &repo.path,
            &["update-ref", "refs/remotes/source/main", "HEAD"],
        );

        let identity = resolve_source_identity(&repo.path, "source/main").unwrap();

        assert_eq!(
            identity.remote_url.as_deref(),
            Some("git@example.com:acme/source.git")
        );
    }

    #[test]
    fn workspace_setup_uses_remote_url_fallback_order() {
        let repo = TestRepo::new();
        repo.add_remote("zeta", "git@example.com:acme/zeta.git");
        repo.add_remote("alpha", "git@example.com:acme/alpha.git");
        repo.add_remote("upstream", "git@example.com:acme/upstream.git");
        repo.add_remote("origin", "git@example.com:acme/origin.git");

        let remotes = configured_remotes(&repo.path);
        assert_eq!(
            capture_remote_url(&repo.path, "main", &remotes).as_deref(),
            Some("git@example.com:acme/origin.git")
        );

        git(&repo.path, &["remote", "remove", "origin"]);
        let remotes = configured_remotes(&repo.path);
        assert_eq!(
            capture_remote_url(&repo.path, "main", &remotes).as_deref(),
            Some("git@example.com:acme/upstream.git")
        );

        git(&repo.path, &["remote", "remove", "upstream"]);
        let remotes = configured_remotes(&repo.path);
        assert_eq!(
            capture_remote_url(&repo.path, "main", &remotes).as_deref(),
            Some("git@example.com:acme/alpha.git")
        );
    }
}
