import { deriveWorkspaceView, type WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceSetupState, WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'

export function requiresRepositoryDirectoryForLaunch(input: {
	worktreeTiming: string | null | undefined
	workspaceSpec: WorkspaceSpec | null | undefined
	/**
	 * True when the selected host already has a task_workspace_setup_for_host
	 * row. Rows from before resolved_workspace_spec existed carry none; those
	 * hosts launch with the shared task spec rather than prompting again.
	 */
	hasHostSetupRow: boolean
}): boolean {
	return input.worktreeTiming === 'now' && input.workspaceSpec != null && !input.hasHostSetupRow
}

/**
 * Workspace-aware launch derivations for multi-repo `worktree:now` tasks.
 *
 * New tasks resolve workspace_spec with the selected host's setup row. Legacy
 * tasks fall back to workspace_state plus task_user_settings.
 *
 * Everything is gated on `repos.length > 1` — single-repo snapshots and
 * legacy (null) tasks derive nothing, so their behavior is unchanged.
 */

export interface WorkspaceLaunchChoice {
	/** Directory to launch in. Expanded when the local base is known, else `~`-prefixed (the daemon expands at launch). */
	path: string
	/** Short display label: 'workspace root' or the repo subdir name */
	label: string
	kind: 'root' | 'repo'
	/** True for the workspace's primary/default launch repo */
	primary: boolean
	/** User-provided repo description from the workspace config, when present */
	description?: string
}

export interface WorkspaceLaunchInputs {
	workspaceView: WorkspaceView | null
	workspaceSpec: WorkspaceSpec | null
	workspaceSetupState: WorkspaceSetupState | null
	/** Deprecated snapshot used only when workspaceSpec is absent. */
	workspaceState: WorkspaceState | null
	/** Current user's `task_user_settings.workspace_base_directory` (expanded local path), when set */
	userWorkspaceBaseDirectory: string | null
	/** Local $HOME when known (Tauri); used to expand the snapshot's `~` base. Null/undefined leaves `~` intact. */
	homeDirectory: string | null
}

/** Expand a leading `~` against the provided home directory; no-op when home is unknown. */
function expandTildePath(path: string, homeDirectory: string | null | undefined): string {
	if (!homeDirectory) return path
	if (path !== '~' && !path.startsWith('~/')) return path
	const home = homeDirectory.replace(/[\\/]+$/, '')
	return `${home}${path.slice(1)}`
}

/** Join the workspace base with a repo subdir using forward slashes (snapshot paths are `/`-separated). */
function joinWorkspacePath(base: string, segment: string): string {
	const cleanBase = base.replace(/\/+$/, '')
	const cleanSegment = segment.replace(/^\/+/, '')
	return `${cleanBase}/${cleanSegment}`
}

/**
 * The workspace base directory for this user on a multi-repo task: their
 * recorded local base when set, else the snapshot's non-expanded `~/...`
 * base. Returns null for single-repo / legacy tasks so callers fall through
 * to today's behavior unchanged.
 */
export function resolveWorkspaceBaseDirectory(
	workspaceView: WorkspaceView | null,
	userWorkspaceBaseDirectory: string | null,
): string | null {
	if (!workspaceView || workspaceView.repos.length <= 1) return null
	if (workspaceView.source === 'workspace_spec' && workspaceView.repos.some((repo) => repo.materialized)) {
		return workspaceView.workspaceBaseDirectory
	}
	const userBase = userWorkspaceBaseDirectory?.trim()
	return userBase ? userBase : workspaceView.workspaceBaseDirectory
}

const resolveInputWorkspaceView = (inputs: WorkspaceLaunchInputs): WorkspaceView | null =>
	inputs.workspaceView ??
	deriveWorkspaceView({
		workspaceSpec: inputs.workspaceSpec,
		workspaceSetupState: inputs.workspaceSetupState,
		legacyWorkspaceState: inputs.workspaceState,
	})

/** Multi-repo base for launch derivations, tilde-expanded when the local home is known. */
function resolveWorkspaceLaunchBase(inputs: WorkspaceLaunchInputs): string | null {
	const base = resolveWorkspaceBaseDirectory(resolveInputWorkspaceView(inputs), inputs.userWorkspaceBaseDirectory)
	if (!base) return null
	return expandTildePath(base, inputs.homeDirectory)
}

const resolveRepoLaunchPath = (
	workspaceView: WorkspaceView,
	repo: WorkspaceView['repos'][number],
	base: string,
	homeDirectory: string | null | undefined,
): string =>
	workspaceView.source === 'workspace_spec' && repo.materialized
		? expandTildePath(repo.targetPath, homeDirectory)
		: joinWorkspacePath(base, repo.relativePath)

/**
 * Selectable launch directories for a multi-repo task: the workspace root
 * first, then every repo in config-declared order (primary flagged). Empty
 * for single-repo / legacy tasks.
 */
export function deriveWorkspaceLaunchChoices(inputs: WorkspaceLaunchInputs): WorkspaceLaunchChoice[] {
	const base = resolveWorkspaceLaunchBase(inputs)
	const workspaceView = resolveInputWorkspaceView(inputs)
	if (!base || !workspaceView) return []
	return [
		{ path: base, label: 'workspace root', kind: 'root', primary: false },
		...workspaceView.repos.map<WorkspaceLaunchChoice>((repo) => {
			const choice: WorkspaceLaunchChoice = {
				path: resolveRepoLaunchPath(workspaceView, repo, base, inputs.homeDirectory),
				label: repo.relativePath,
				kind: 'repo',
				primary: repo.primary,
			}
			if (repo.description !== undefined) choice.description = repo.description
			return choice
		}),
	]
}

/**
 * Default new-session working directory for a multi-repo task: the
 * `primary: true` repo's directory under the user's local base (config-order
 * first repo as a defensive fallback when no repo is flagged). Null for
 * single-repo / legacy tasks — their pre-fill is unchanged.
 */
export function deriveWorkspacePrimaryLaunchDirectory(inputs: WorkspaceLaunchInputs): string | null {
	const base = resolveWorkspaceLaunchBase(inputs)
	const workspaceView = resolveInputWorkspaceView(inputs)
	if (!base || !workspaceView) return null
	const primaryRepo = workspaceView.repos.find((repo) => repo.primary) ?? workspaceView.repos[0]
	if (!primaryRepo) return null
	return resolveRepoLaunchPath(workspaceView, primaryRepo, base, inputs.homeDirectory)
}

interface HostScopedTaskDirectoryInput {
	taskOwnerUserId: string | null
	userId: string | undefined
	hostId: string
	userSettings?: { host_id: string | null; working_directory: string | null }
	setupRows: ReadonlyArray<{
		host_id: string
		resolved_workspace_spec?: { repos: ReadonlyArray<{ targetPath: string; primary: boolean }> } | null
	}>
	plannedWorkspaceDirectory?: string | null
	fallback: string
}

/** Resolve a collaborator's task directory without reusing a path saved for another host. */
export function resolveHostScopedTaskDirectory(input: HostScopedTaskDirectoryInput): string {
	const hostSetupRow = input.setupRows.find((row) => row.host_id === input.hostId)
	if (input.plannedWorkspaceDirectory) {
		if (!hostSetupRow) return input.plannedWorkspaceDirectory
		return (
			hostSetupRow.resolved_workspace_spec?.repos.find((repo) => repo.primary)?.targetPath ??
			input.plannedWorkspaceDirectory
		)
	}
	if (!input.userId || input.taskOwnerUserId === input.userId) return input.fallback
	if (input.userSettings?.host_id === input.hostId && input.userSettings.working_directory?.trim()) {
		return input.userSettings.working_directory.trim()
	}
	const mapping = hostSetupRow?.resolved_workspace_spec
	return mapping?.repos.find((repo) => repo.primary)?.targetPath ?? input.fallback
}
