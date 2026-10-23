import type { TaskWorkspaceContext as TaskWorkspaceContextRecord } from '@humanlayer/schemas/effect/project-workspace'
import { Context, type Effect } from 'effect'

import type { DaemonTaskWorkspaceContextError } from '../daemon-api/daemon-api.errors'

export interface TaskWorkspaceContextInput {
	readonly taskId: string
}

/**
 * Task-scoped repository context for every session this daemon runs: the immutable workspace
 * snapshot plus this daemon's own user/host materialization. Both reads resolve to `null` when
 * the task has no project workspace, when this user may not read it, or when the API is
 * unreachable after bounded retries. Launch reads fail on transport errors; only background
 * tracking may degrade so an agent never starts with silently missing sibling repositories.
 */
export interface TaskWorkspaceContextService {
	/** Authoritative read for session launch. Also refreshes what `recentTaskWorkspaceContext` serves. */
	readonly loadTaskWorkspaceContext: (
		input: TaskWorkspaceContextInput,
	) => Effect.Effect<TaskWorkspaceContextRecord | null, DaemonTaskWorkspaceContextError>
	/**
	 * Recently read context for periodic trackers such as commit watching, repository observation,
	 * and task-diff registration. Serves the last read within the configured freshness window so
	 * a reconcile loop over many sessions makes at most one API call per task per window.
	 */
	readonly recentTaskWorkspaceContext: (
		input: TaskWorkspaceContextInput,
	) => Effect.Effect<TaskWorkspaceContextRecord | null>
}

export class TaskWorkspaceContext extends Context.Service<TaskWorkspaceContext, TaskWorkspaceContextService>()(
	'TaskWorkspaceContext',
) {}
