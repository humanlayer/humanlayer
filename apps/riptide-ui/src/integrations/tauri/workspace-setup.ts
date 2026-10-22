/**
 * workspace-setup.ts — Tauri frontend wrappers for native worktree-now commands.
 *
 * These wrappers call into workspace_setup.rs via Tauri's invoke() bridge.
 * All functions degrade gracefully (no-op / return safe defaults) in web mode.
 *
 * The workspace-now pipeline in order:
 *   1. workspacePreflight   — validate all repos before any mutation
 *   2. workspaceCreate      — git worktree add for every repo
 *   3. workspaceCopyGlobs   — copy configured files into worktrees
 *   4. workspaceRunSetup    — run setup commands for repos with setupCommand
 *   5. workspaceRemoveAll   — cleanup on failure or user request
 */

import { invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Shared input/output types (mirror of workspace_setup.rs structs)
// ---------------------------------------------------------------------------

/** A single resolved repo entry for worktree-now commands. */
export interface WorkspaceRepoInput {
	/** Relative path to the repo, e.g. "." or "../api" */
	localPath: string
	/** Rendered absolute target worktree path (tilde already expanded) */
	targetPath: string
	/** Branch name (rendered from branchTemplate) */
	branch: string
	/** Git ref to create the worktree from ("HEAD", "origin/main", etc.) */
	sourceRef: string
	/** Remote used to publish and track the task branch. Inferred when omitted. */
	branchRemote?: string
	/** Shell command to run after copy-globs. Empty string = no command. Used by TS pipeline, not sent to Rust preflight/create/copy. */
	setupCommand: string
	/** Glob patterns to copy into the created worktree */
	copyGlobs: string[]
}

// ---------------------------------------------------------------------------
// workspace_preflight
// ---------------------------------------------------------------------------

export interface WorkspaceRepoPreflightResult {
	localPath: string
	targetPath: string
	ok: boolean
	/** Non-empty when ok is false */
	error: string
}

export interface WorkspacePreflightResult {
	ok: boolean
	repos: WorkspaceRepoPreflightResult[]
}

/**
 * Preflight every repo before any mutation.
 *
 * Checks: source exists, is a git repo, target path doesn't exist,
 * branch doesn't exist, sourceRef resolves (fetches remotes when needed).
 * Config invariants (exactly one primary repo, common-parent target paths)
 * are validated TS-side before this is called.
 */
export async function workspacePreflight(input: {
	selectedDirectory: string
	repos: WorkspaceRepoInput[]
}): Promise<WorkspacePreflightResult> {
	if (!isTauri()) {
		return {
			ok: false,
			repos: [
				{
					localPath: '',
					targetPath: '',
					ok: false,
					error: 'Workspace setup is only available in the desktop app.',
				},
			],
		}
	}
	return invoke<WorkspacePreflightResult>('workspace_preflight', { input })
}

// ---------------------------------------------------------------------------
// workspace_create
// ---------------------------------------------------------------------------

export interface WorkspaceRepoCreateResult {
	localPath: string
	targetPath: string
	/** Absolute (tilde-expanded) target worktree path */
	expandedTargetPath: string
	/** Source ref resolved before worktree creation */
	resolvedSourceRef: string | null
	/** Remote URL selected for the source ref, captured best-effort (null when unavailable) */
	remoteUrl: string | null
	/** Exact commit SHA used to create the worktree */
	resolvedSha: string | null
	ok: boolean
	error: string
}

export interface WorkspaceCreateResult {
	ok: boolean
	repos: WorkspaceRepoCreateResult[]
}

/**
 * Create all git worktrees for the workspace.
 *
 * Runs `git worktree add -b <branch> <targetPath> <sourceRef>` for each repo.
 * Stops on first failure. Each per-repo result carries the expanded target
 * path plus git identity (resolved source ref, commit SHA, and optional remote URL)
 * for the task's workspace_state snapshot.
 */
export async function workspaceCreate(input: {
	selectedDirectory: string
	repos: WorkspaceRepoInput[]
}): Promise<WorkspaceCreateResult> {
	if (!isTauri()) {
		return {
			ok: false,
			repos: [
				{
					localPath: '',
					targetPath: '',
					expandedTargetPath: '',
					resolvedSourceRef: null,
					remoteUrl: null,
					resolvedSha: null,
					ok: false,
					error: 'Workspace setup is only available in the desktop app.',
				},
			],
		}
	}
	return invoke<WorkspaceCreateResult>('workspace_create', { input })
}

// ---------------------------------------------------------------------------
// workspace_copy_globs
// ---------------------------------------------------------------------------

export interface WorkspaceRepoCopyResult {
	localPath: string
	filesCopied: number
	ok: boolean
	error: string
}

export interface WorkspaceCopyGlobsResult {
	ok: boolean
	repos: WorkspaceRepoCopyResult[]
}

/**
 * Copy configured glob patterns into each created worktree.
 *
 * Missing glob matches silently no-op. Destination files are overwritten.
 * Only copies regular files (not directories or symlinks).
 */
export async function workspaceCopyGlobs(input: {
	selectedDirectory: string
	repos: WorkspaceRepoInput[]
}): Promise<WorkspaceCopyGlobsResult> {
	if (!isTauri()) {
		return {
			ok: false,
			repos: [
				{
					localPath: '',
					filesCopied: 0,
					ok: false,
					error: 'Workspace setup is only available in the desktop app.',
				},
			],
		}
	}
	return invoke<WorkspaceCopyGlobsResult>('workspace_copy_globs', { input })
}

// ---------------------------------------------------------------------------
// workspace_run_setup
// ---------------------------------------------------------------------------

export interface WorkspaceRunSetupResult {
	localPath: string
	ok: boolean
	exitCode: number
	stdout: string
	stderr: string
	error: string
}

/**
 * Run the setup command for a single repo worktree.
 *
 * Executed via `sh -c <command>` inside the target worktree directory.
 * Non-zero exit code → ok: false. The Retry / Proceed Anyway / Remove All
 * decision is handled in the UI layer.
 */
export async function workspaceRunSetup(input: {
	targetPath: string
	setupCommand: string
	localPath: string
}): Promise<WorkspaceRunSetupResult> {
	if (!isTauri()) {
		return {
			localPath: input.localPath,
			ok: false,
			exitCode: -1,
			stdout: '',
			stderr: '',
			error: 'Workspace setup is only available in the desktop app.',
		}
	}
	return invoke<WorkspaceRunSetupResult>('workspace_run_setup', { input })
}

// ---------------------------------------------------------------------------
// workspace_remove_all
// ---------------------------------------------------------------------------

export interface WorkspaceRemoveAllResult {
	ok: boolean
	failedRemovals: string[]
	error: string
}

/**
 * Remove all worktrees created during a workspace-now setup run.
 *
 * Uses `git worktree remove --force <targetPath>` from each source repo.
 * Removes only the target worktree directories, never the parent workspace
 * directory. Errors are surfaced rather than silently ignored.
 */
export async function workspaceRemoveAll(input: {
	selectedDirectory: string
	repos: WorkspaceRepoInput[]
}): Promise<WorkspaceRemoveAllResult> {
	if (!isTauri()) {
		return { ok: false, failedRemovals: [], error: 'Workspace setup is only available in the desktop app.' }
	}
	return invoke<WorkspaceRemoveAllResult>('workspace_remove_all', { input })
}
