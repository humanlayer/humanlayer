import type { TaskWorkspaceContext } from '@humanlayer/schemas/effect/project-workspace'
import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { TaskDiffWorkspace } from '@humanlayer/streams/diff'
import { Effect, Schema } from 'effect'
import * as Path from 'effect/Path'

import { normalizePath } from '@/lib/utils'
import {
	contextRepositories,
	isPlacedTaskWorkspaceContext,
	placementRootFromContext,
} from '@/lib/workspace/project-workspace-view'

interface TaskDiffWorkspaceTaskState {
	readonly id: string
	readonly organization_id?: string | null
	readonly workspace_state?: WorkspaceState | null
}

interface TaskDiffWorkspaceSessionState {
	readonly id: string
	readonly task_id?: string | null
	readonly host_id: string
	readonly working_directory: string
	readonly status: string
	readonly updated_at?: bigint | null
}

const startedSessionStatuses = new Set([
	'running',
	'waiting_for_usage_limit',
	'failed',
	'ready_for_input',
	'needs_approval',
	'interrupt_requested',
	'interrupted',
	'resuming',
])

/** Selects the same host-local anchor regardless of collection arrival order. */
export const selectTaskDiffSession = (
	taskId: string,
	sessions: ReadonlyArray<TaskDiffWorkspaceSessionState>,
): TaskDiffWorkspaceSessionState | undefined =>
	sessions
		.filter((session) => session.task_id === taskId && startedSessionStatuses.has(session.status))
		.toSorted((left, right) => {
			const leftUpdated = left.updated_at ?? 0n
			const rightUpdated = right.updated_at ?? 0n
			if (leftUpdated !== rightUpdated) return leftUpdated > rightUpdated ? -1 : 1
			return left.id.localeCompare(right.id)
		})[0]

/** Combines logical workspace metadata with a durable session's host-local path anchor. */
export const makeTaskDiffWorkspaceForLifecycle = (
	task: TaskDiffWorkspaceTaskState,
	session: TaskDiffWorkspaceSessionState,
) =>
	Effect.gen(function* () {
		if (!task.organization_id || !task.workspace_state || session.task_id !== task.id) return null
		if (task.workspace_state.repos.length === 0) return null
		const primary = task.workspace_state.repos.find((repo) => repo.primary)
		if (!primary) return null

		const path = yield* Path.Path
		const primarySegments = path
			.normalize(primary.path)
			.split('/')
			.filter((segment) => segment !== '.')
		const workspaceBaseDirectory = primarySegments.reduce(
			(directory) => path.dirname(directory),
			path.resolve(normalizePath(session.working_directory)),
		)
		const repos = task.workspace_state.repos.map((repo) => ({
			id: repo.path,
			absolutePath: path.normalize(path.join(workspaceBaseDirectory, repo.path)),
			sourceRef: repo.sourceRef,
			sourceCommit: repo.sourceCommit,
		}))

		return yield* Schema.decodeUnknownEffect(TaskDiffWorkspace)({
			organizationId: task.organization_id,
			taskId: task.id,
			hostId: session.host_id,
			workspaceBaseDirectory,
			repos,
		})
	})

/**
 * Builds the capture workspace for a project-workspace task from this user/host's own
 * materialization. Only materialized worktrees are captured, and each compares against the
 * workspace's pinned base commit rather than a moving branch ref. Any repository whose pin has
 * not resolved yet is left out until its status row carries one.
 */
export const makeTaskDiffWorkspaceForProjectWorkspace = Effect.fn('task_diff.project_workspace')(function* (
	context: TaskWorkspaceContext,
	session: TaskDiffWorkspaceSessionState,
) {
	if (session.task_id !== context.taskId || !isPlacedTaskWorkspaceContext(context)) return null
	// A placement belongs to one host; a session anchored elsewhere has no worktrees here.
	if (context.materialization.location.hostId !== session.host_id) return null
	const path = yield* Path.Path
	const materialized = contextRepositories(context).filter((entry) => entry.materialized)
	const repos = materialized.flatMap((entry) => {
		const sourceCommit = entry.status?.resolvedCommit ?? entry.repository.baseCommit
		if (sourceCommit === undefined || sourceCommit === null) return []
		return [
			{
				id: entry.relativePath,
				displayName: entry.displayName,
				absolutePath: path.normalize(normalizePath(entry.targetPath)),
				sourceRef: 'HEAD',
				sourceCommit,
			},
		]
	})
	if (repos.length === 0) return null
	const workspaceBaseDirectory = path.resolve(normalizePath(placementRootFromContext(context)))
	return yield* Schema.decodeUnknownEffect(TaskDiffWorkspace)({
		organizationId: context.workspace.organizationId,
		taskId: context.taskId,
		hostId: session.host_id,
		workspaceBaseDirectory,
		repos,
	})
})
