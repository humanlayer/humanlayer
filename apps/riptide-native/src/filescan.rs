use ignore::WalkBuilder;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct FileMatch {
    pub path: String,
    pub display_path: String,
    pub score: i64,
    pub matched_indexes: Vec<usize>,
    pub is_directory: bool,
}

/// Hidden (dot-prefixed) repository directories that are project-authored context
/// and should be searchable even though the main walk filters hidden entries.
/// Gitignore is still honored for these roots (unlike the .humanlayer walk).
const SEARCHABLE_HIDDEN_ROOTS: &[&str] = &[
    ".agents",
    ".changeset",
    ".claude",
    ".config",
    ".continue",
    ".cursor",
    ".devcontainer",
    ".devin",
    ".github",
    ".husky",
    ".storybook",
    ".vscode",
    ".windsurf",
];

/// Drain an `ignore::Walk`, pushing each entry's absolute path and directory flag
/// into `entries`. Shared by the main walk, the `.humanlayer` walk, and the
/// allowlisted hidden-root walks so they all apply identical candidate handling:
/// timeout checks, optional root-skip, walker-error skip, and non-UTF-8 skip.
///
/// `skip_root` is `Some(path)` for the main walk (which must not emit the search
/// root itself) and `None` for the hidden-root and `.humanlayer` walks, which
/// intentionally push the directory entry itself.
fn collect_walk_entries(
    walker: ignore::Walk,
    skip_root: Option<&Path>,
    entries: &mut Vec<(String, bool)>,
    start: Instant,
    timeout: Duration,
) {
    for entry in walker {
        if start.elapsed() >= timeout {
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if let Some(root) = skip_root {
            if entry.path() == root {
                continue;
            }
        }

        let abs_path = match entry.path().to_str() {
            Some(p) => p.to_string(),
            None => continue,
        };

        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        entries.push((abs_path, is_dir));
    }
}

/// Recursively walk the given paths, collect files, and fuzzy match against the query.
/// Uses ignore crate for gitignore support and symlink cycle detection.
/// Uses nucleo-matcher for fzf-style fuzzy matching.
/// Two-round approach: basenames first (with score boost), then full paths.
#[tauri::command]
pub async fn fuzzy_search_files(
    query: String,
    paths: Vec<String>,
    limit: Option<usize>,
) -> Result<Vec<FileMatch>, String> {
    let limit = limit.unwrap_or(50);

    tokio::task::spawn_blocking(move || {
        let timeout = Duration::from_secs(5);
        let start = Instant::now();

        // Expand tilde in all paths up front (shell tilde expansion isn't handled by std::path)
        let expanded_paths: Vec<String> = paths
            .iter()
            .map(|p| {
                if p.starts_with("~/") || p == "~" {
                    if let Some(home) = std::env::var_os("HOME") {
                        p.replacen('~', &home.to_string_lossy().as_ref(), 1)
                    } else {
                        p.clone()
                    }
                } else {
                    p.clone()
                }
            })
            .collect();

        // Phase 1: Collect all file entries using two walks per search path:
        //  - Main walk: respects gitignore, skips hidden files/dirs
        //  - .humanlayer walk: ignores gitignore (since .humanlayer/tasks/ is gitignored)
        let mut entries: Vec<(String, bool)> = Vec::new();

        for search_path in &expanded_paths {
            if start.elapsed() >= timeout {
                break;
            }

            let path = Path::new(search_path);
            if !path.exists() {
                continue;
            }

            // Main walk: normal files with gitignore and hidden filtering
            let walker = WalkBuilder::new(path)
                .follow_links(true)
                .git_ignore(true)
                .git_global(true)
                .git_exclude(true)
                .hidden(true)
                .max_depth(Some(20))
                .build();
            collect_walk_entries(walker, Some(path), &mut entries, start, timeout);

            // Separate walk for .humanlayer: bypass gitignore (.humanlayer/tasks/ is
            // gitignored) but still skip dotfiles within it
            let humanlayer_path = path.join(".humanlayer");
            if humanlayer_path.exists() {
                let hl_walker = WalkBuilder::new(&humanlayer_path)
                    .follow_links(true)
                    .git_ignore(false)
                    .git_global(false)
                    .git_exclude(false)
                    .hidden(true)
                    .max_depth(Some(20))
                    .build();
                collect_walk_entries(hl_walker, None, &mut entries, start, timeout);
            }

            // Allowlisted hidden roots: enter the dot-directory (hidden(false)) but keep
            // gitignore enabled so ignored local files inside them stay out of results.
            for hidden_root in SEARCHABLE_HIDDEN_ROOTS {
                let hidden_path = path.join(hidden_root);
                if hidden_path.exists() {
                    let hidden_walker = WalkBuilder::new(&hidden_path)
                        .follow_links(true)
                        .git_ignore(true)
                        .git_global(true)
                        .git_exclude(true)
                        .hidden(false)
                        .max_depth(Some(20))
                        .build();
                    collect_walk_entries(hidden_walker, None, &mut entries, start, timeout);
                }
            }
        }

        // If empty query, return first N entries sorted alphabetically
        if query.is_empty() {
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            entries.truncate(limit);
            let first_search_path = expanded_paths.first().map(|s| s.as_str()).unwrap_or("");
            return Ok(entries
                .into_iter()
                .map(|(path, is_dir)| {
                    let display_path = make_display_path(&path, first_search_path);
                    FileMatch {
                        path,
                        display_path,
                        score: 0,
                        matched_indexes: vec![],
                        is_directory: is_dir,
                    }
                })
                .collect());
        }

        // Phase 2: Two-round fuzzy matching
        let mut matcher = Matcher::new(Config::DEFAULT);
        let pattern = Pattern::parse(&query, CaseMatching::Smart, Normalization::Smart);

        let first_search_path = expanded_paths.first().map(|s| s.as_str()).unwrap_or("");

        // Round 1: Match on basenames with score boost
        let mut matched_results: Vec<FileMatch> = Vec::new();
        let mut matched_indices: std::collections::HashSet<usize> =
            std::collections::HashSet::new();

        for (idx, (path, is_dir)) in entries.iter().enumerate() {
            let basename = Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            let mut buf = Vec::new();
            let haystack = Utf32Str::new(basename, &mut buf);
            let mut indices = Vec::new();

            if let Some(score) = pattern.indices(haystack, &mut matcher, &mut indices) {
                let boosted_score = score as i64 + (indices.len() as i64 * 30);
                let display_path = make_display_path(path, first_search_path);
                matched_results.push(FileMatch {
                    path: path.clone(),
                    display_path,
                    score: boosted_score,
                    matched_indexes: indices.iter().map(|&i| i as usize).collect(),
                    is_directory: *is_dir,
                });
                matched_indices.insert(idx);
            }
        }

        // Round 2: Match on relative display paths for remaining entries.
        // Using display paths (relative to search root) instead of absolute paths
        // gives much better scoring for path-like queries like "apps/riptide-api/src".
        // We collect ALL matches here (no early exit) so the final sort picks the best.
        for (idx, (path, is_dir)) in entries.iter().enumerate() {
            if matched_indices.contains(&idx) {
                continue;
            }

            let display_path = make_display_path(path, first_search_path);
            let mut buf = Vec::new();
            let haystack = Utf32Str::new(&display_path, &mut buf);
            let mut indices = Vec::new();

            if let Some(score) = pattern.indices(haystack, &mut matcher, &mut indices) {
                matched_results.push(FileMatch {
                    path: path.clone(),
                    display_path,
                    score: score as i64,
                    matched_indexes: indices.iter().map(|&i| i as usize).collect(),
                    is_directory: *is_dir,
                });
            }
        }

        // Sort by score descending, truncate to limit
        matched_results.sort_by(|a, b| b.score.cmp(&a.score));
        matched_results.truncate(limit);

        Ok(matched_results)
    })
    .await
    .map_err(|e| format!("File search task failed: {}", e))?
}

/// Make a display path relative to the search root
fn make_display_path(path: &str, search_root: &str) -> String {
    if let Some(relative) = path.strip_prefix(search_root) {
        let relative = relative.trim_start_matches('/');
        if relative.is_empty() {
            path.to_string()
        } else {
            relative.to_string()
        }
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Temp-directory fixture that cleans itself up on drop, so tests do not
    /// depend on the `tempfile` dev-dependency.
    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let unique = format!(
                "riptide-filescan-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::SeqCst)
            );
            let root = std::env::temp_dir().join(unique);
            fs::create_dir_all(&root).expect("create fixture root");
            Fixture { root }
        }

        fn write(&self, relative: &str, contents: &str) {
            let path = self.root.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create parent dirs");
            }
            fs::write(&path, contents).expect("write fixture file");
        }

        fn root_str(&self) -> String {
            self.root.to_string_lossy().to_string()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn build_fixture() -> Fixture {
        let fixture = Fixture::new();
        fixture.write("src/visible.ts", "export const visible = true;\n");
        fixture.write(".claude/settings.json", "{}\n");
        fixture.write(".github/workflows/ci.yml", "name: ci\n");
        fixture.write(".git/config", "[core]\n");
        fixture.write(".humanlayer/tasks/task-slug/research.md", "# research\n");
        fixture
    }

    async fn search(root: &str, query: &str) -> Vec<String> {
        fuzzy_search_files(query.to_string(), vec![root.to_string()], Some(100))
            .await
            .expect("search should succeed")
            .into_iter()
            .map(|m| m.path)
            .collect()
    }

    fn contains_suffix(paths: &[String], suffix: &str) -> bool {
        paths.iter().any(|p| p.ends_with(suffix))
    }

    #[tokio::test]
    async fn includes_allowlisted_hidden_roots() {
        let fixture = build_fixture();
        let root = fixture.root_str();

        let claude = search(&root, "claude").await;
        assert!(
            contains_suffix(&claude, ".claude/settings.json"),
            "expected .claude/settings.json in results for query 'claude', got: {claude:?}"
        );

        let github = search(&root, "github").await;
        assert!(
            contains_suffix(&github, ".github/workflows/ci.yml"),
            "expected .github/workflows/ci.yml in results for query 'github', got: {github:?}"
        );
    }

    #[tokio::test]
    async fn still_includes_humanlayer_artifacts() {
        let fixture = build_fixture();
        let root = fixture.root_str();

        let research = search(&root, "research").await;
        assert!(
            contains_suffix(&research, ".humanlayer/tasks/task-slug/research.md"),
            "expected .humanlayer artifact in results for query 'research', got: {research:?}"
        );
    }

    #[tokio::test]
    async fn excludes_git_directory() {
        let fixture = build_fixture();
        let root = fixture.root_str();

        let config = search(&root, "config").await;
        assert!(
            !contains_suffix(&config, ".git/config"),
            "did not expect .git/config in results for query 'config', got: {config:?}"
        );
    }

    #[tokio::test]
    async fn still_includes_visible_files() {
        let fixture = build_fixture();
        let root = fixture.root_str();

        let visible = search(&root, "visible").await;
        assert!(
            contains_suffix(&visible, "src/visible.ts"),
            "expected src/visible.ts in results for query 'visible', got: {visible:?}"
        );
    }
}
