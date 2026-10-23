import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { Effect } from 'effect'

import { isProjectWorkspaceTask } from '../task-workspace-context/resolve-session-workspace-view'
import { TaskWorkspaceContext } from '../task-workspace-context/task-workspace-context.service'
import { TaskDiffLifecycleObserver } from './task-diff-lifecycle-observer.service'
import { reportTaskDiffError } from './task-diff-observability'
import {
	makeTaskDiffWorkspaceForLifecycle,
	makeTaskDiffWorkspaceForProjectWorkspace,
	selectTaskDiffSession,
} from './task-diff-workspace'

interface TaskLifecycleCollectionRow {
	readonly id: string
	readonly organization_id?: string | null
	readonly archived: boolean
	/** Set for project-workspace tasks, which carry no legacy workspace_state. */
	readonly workspace_id?: string | null
	readonly workspace_state?: WorkspaceState | null
}

interface SessionLifecycleCollectionRow {
	readonly id: string
	readonly task_id?: string | null
	readonly host_id: string
	readonly working_directory: string
	readonly status: string
	readonly updated_at?: bigint | null
}

export interface TaskDiffLifecycleCollections {
	readonly tasks: { readonly toArray: ReadonlyArray<TaskLifecycleCollectionRow> }
	readonly sessions: { readonly toArray: ReadonlyArray<SessionLifecycleCollectionRow> }
}

export interface ReconcileTaskDiffCollectionsInput {
	readonly collections: TaskDiffLifecycleCollections
	readonly taskIds: ReadonlySet<string>
}

/**
 * A project-workspace task reads its worktrees from the daemon's recently loaded task context.
 * Session launch refreshes that context, so the session-change reconcile that follows a launch
 * sees the materialized paths without another API round trip.
 */
const projectWorkspaceForTaskDiff = Effect.fn('task_diff.collections.project_workspace')(function* (
	task: TaskLifecycleCollectionRow,
	session: SessionLifecycleCollectionRow,
) {
	const contexts = yield* TaskWorkspaceContext
	const context = yield* contexts.recentTaskWorkspaceContext({ taskId: task.id })
	if (context === null) return null
	return yield* makeTaskDiffWorkspaceForProjectWorkspace(context, session).pipe(
		Effect.catchTag('SchemaError', (error) =>
			reportTaskDiffError(error, 'collections.project_workspace', { taskId: task.id }).pipe(Effect.as(null)),
		),
	)
})

/** Reconciles task and session snapshots without treating transient absence as removal. */
export const reconcileTaskDiffCollections = ({ collections, taskIds }: ReconcileTaskDiffCollectionsInput) =>
	Effect.gen(function* () {
		const observer = yield* TaskDiffLifecycleObserver
		yield* Effect.forEach(
			taskIds,
			(taskId) =>
				Effect.gen(function* () {
					const task = collections.tasks.toArray.find((candidate) => candidate.id === taskId)
					if (!task) return
					yield* observer.observeTask({ taskId, archived: task.archived })

					const session = selectTaskDiffSession(taskId, collections.sessions.toArray)
					const workspace = session
						? isProjectWorkspaceTask(task)
							? yield* projectWorkspaceForTaskDiff(task, session)
							: yield* makeTaskDiffWorkspaceForLifecycle(task, session)
						: null
					yield* observer.observeWorkspace({ taskId, workspace: workspace ?? undefined })
				}),
			{ concurrency: 4, discard: true },
		)
	}).pipe(
		Effect.withSpan('task_diff.collections.reconcile', {
			attributes: { task_count: taskIds.size },
		}),
	)
