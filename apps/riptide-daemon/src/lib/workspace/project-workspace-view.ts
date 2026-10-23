import type { WorkspaceView, WorkspaceViewRepo } from '@humanlayer/db/utils/workspace-view'
import type {
	TaskWorkspaceContext,
	WorkspaceRepository,
	WorkspaceRepositoryStatus,
} from '@humanlayer/schemas/effect/project-workspace'
import { repositoryNameFromIdentity } from '@humanlayer/schemas/effect/project-workspace'

import { renderWorkspaceSetupStatusBlock, type WorkspaceSetupStatusLine } from './render-workspace-information'

/** Synthetic configSources path for directories resolved from project-workspace records. */
export const PROJECT_WORKSPACE_SOURCE_PATH =
	'workspaces.repositories+workspace_repository_status_for_user_for_host.materialization'

/** A workspace the calling daemon has placed: the snapshot plus this user/host's repository rows. */
export interface PlacedTaskWorkspaceContext extends TaskWorkspaceContext {
	readonly materialization: NonNullable<TaskWorkspaceContext['materialization']>
}

export const isPlacedTaskWorkspaceContext = (context: TaskWorkspaceContext): context is PlacedTaskWorkspaceContext =>
	context.materialization !== null

/** The worktree directory name a multi-repository workspace uses for one repository. */
export const workspaceRepositoryDirectoryName = (repositoryIdentity: string): string =>
	repositoryNameFromIdentity(repositoryIdentity)

/** Returns the shortest repository identity suffix that is unique within the workspace. */
export function repositoryDisplayNames(repositoryIdentities: readonly string[]): ReadonlyMap<string, string> {
	const segmentsByIdentity = new Map(
		repositoryIdentities.map((identity) => [identity, identity.split('/').filter(Boolean)] as const),
	)
	return new Map(
		repositoryIdentities.map((identity) => {
			const segments = segmentsByIdentity.get(identity) ?? [identity]
			for (let length = 1; length <= segments.length; length += 1) {
				const suffix = segments.slice(-length).join('/')
				const unique = repositoryIdentities.every((candidate) => {
					if (candidate === identity) return true
					return (segmentsByIdentity.get(candidate) ?? [candidate]).slice(-length).join('/') !== suffix
				})
				if (unique) return [identity, suffix] as const
			}
			return [identity, identity] as const
		}),
	)
}

type MutableWorkspaceViewRepo = { -readonly [Key in keyof WorkspaceViewRepo]: WorkspaceViewRepo[Key] }

const normalizeSeparators = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** Strip the repository's relative path from its worktree path to recover the workspace root. */
const baseDirectoryForMaterializedPath = (materializedPath: string, relativePath: string): string => {
	const target = normalizeSeparators(materializedPath)
	if (relativePath === '.') return target
	const suffix = `/${normalizeSeparators(relativePath)}`
	if (target.endsWith(suffix)) return target.slice(0, -suffix.length)
	const separatorIndex = target.lastIndexOf('/')
	return separatorIndex > 0 ? target.slice(0, separatorIndex) : target
}

interface ContextRepository {
	readonly repository: WorkspaceRepository
	readonly displayName: string
	readonly status: WorkspaceRepositoryStatus | undefined
	/** `.` for a single-repository workspace, else the worktree directory name. */
	readonly relativePath: string
	/** The materialized worktree path, else the path this user/host will materialize into. */
	readonly targetPath: string
	readonly materialized: boolean
}

/**
 * Pair every snapshot repository with this user/host's current-generation status row. The
 * snapshot, not the status rows, defines which repositories exist; a row without a snapshot
 * repository is ignored and a repository without a row is reported as not yet materialized.
 */
export function contextRepositories(context: PlacedTaskWorkspaceContext): ContextRepository[] {
	const statuses = new Map(
		context.materialization.repositories.map((status) => [status.repositoryIdentity, status] as const),
	)
	const single = context.workspace.repositories.length === 1
	const displayNames = repositoryDisplayNames(
		context.workspace.repositories.map((repository) => repository.repositoryIdentity),
	)
	const root = normalizeSeparators(context.materialization.location.filePath)
	return context.workspace.repositories.map((repository) => {
		const status = statuses.get(repository.repositoryIdentity)
		const relativePath = single ? '.' : workspaceRepositoryDirectoryName(repository.repositoryIdentity)
		const materializedPath = status?.materialization?.path
		const materialized = materializedPath !== undefined && materializedPath.trim().length > 0
		return {
			repository,
			displayName: displayNames.get(repository.repositoryIdentity) ?? repository.repositoryIdentity,
			status,
			relativePath,
			targetPath: materialized ? materializedPath : single ? root : `${root}/${relativePath}`,
			materialized,
		}
	})
}

/**
 * The workspace root on this host: recovered from the first materialized worktree once one
 * exists, otherwise the portable `~`-prefixed placement path the API stored.
 */
export function placementRootFromContext(context: PlacedTaskWorkspaceContext): string {
	const firstMaterialized = contextRepositories(context).find((entry) => entry.materialized)
	return firstMaterialized
		? baseDirectoryForMaterializedPath(firstMaterialized.targetPath, firstMaterialized.relativePath)
		: context.materialization.location.filePath
}

/**
 * Present a project workspace to the repository-aware consumers that already understand the
 * legacy `WorkspaceView`: prompt rendering, configured-repository discovery, commit watching,
 * repository observation, and pull-request tracking. Paths keep the placement's `~` prefix until
 * a worktree exists; consumers expand `~` against their own home, never another user's.
 */
export function projectWorkspaceViewFromContext(context: TaskWorkspaceContext): WorkspaceView | null {
	if (!isPlacedTaskWorkspaceContext(context)) return null
	const repositories = contextRepositories(context)
	const repos = repositories.map<WorkspaceViewRepo>((entry) => {
		const repo: MutableWorkspaceViewRepo = {
			localPath: entry.repository.repositoryIdentity,
			relativePath: entry.relativePath,
			targetPath: entry.targetPath,
			materialized: entry.materialized,
			remoteUrl: entry.repository.remoteUrl,
			sourceRef: entry.repository.defaultBranch,
			branch: entry.repository.branch,
			primary: entry.repository.default,
		}
		if (entry.status !== undefined) repo.status = entry.status.status
		if (entry.repository.description !== undefined) repo.description = entry.repository.description
		const sourceCommit = entry.status?.resolvedCommit ?? entry.repository.baseCommit
		if (sourceCommit !== undefined && sourceCommit !== null) repo.sourceCommit = sourceCommit
		return repo
	})
	return {
		source: 'project_workspace',
		workspaceBaseDirectory: placementRootFromContext(context),
		// Project workspaces gate launch on materialization, never on setup completion.
		setupBlocksFirstSession: false,
		repos,
	}
}

/**
 * Render the same `<workspace_setup_status>` block legacy tasks receive, from this user/host's
 * repository rows. Finished repositories are omitted; parked errors and accepted skips stay visible.
 */
export function renderProjectWorkspaceSetupProgress(context: TaskWorkspaceContext): string | null {
	if (!isPlacedTaskWorkspaceContext(context)) return null
	const lines: WorkspaceSetupStatusLine[] = []
	let firstError: WorkspaceRepositoryStatus['error'] = null
	for (const entry of contextRepositories(context)) {
		const status = entry.status
		if (status === undefined) continue
		const displayPath = entry.relativePath === '.' ? './' : entry.relativePath
		if (status.status !== 'done') {
			const command = entry.repository.setupCommand
			const action =
				status.status === 'running_setup_command' && command !== undefined && command.length > 0
					? command
					: status.status
			const failed = status.error !== null && status.error.stage === status.status
			lines.push({ displayPath, action, outcome: failed ? 'FAILED' : 'RUNNING' })
		}
		for (const skip of status.acceptedSkips) {
			lines.push({ displayPath, action: skip.stage, outcome: 'SKIPPED BY USER' })
		}
		if (firstError === null && status.error !== null) firstError = status.error
	}
	return renderWorkspaceSetupStatusBlock(
		lines,
		firstError === null ? null : { message: firstError.message, stderr: firstError.stderr },
	)
}
