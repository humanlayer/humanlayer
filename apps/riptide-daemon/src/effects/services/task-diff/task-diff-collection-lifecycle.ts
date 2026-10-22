import { Effect } from 'effect'

import type { DaemonRuntime } from '@/effects/runtime'

import {
	reconcileTaskDiffCollections,
	type ReconcileTaskDiffCollectionsInput,
	type TaskDiffLifecycleCollections,
} from './task-diff-collection-reconciler'
import { reportTaskDiffError } from './task-diff-observability'

/** Observe a failed pass at the callback boundary, not a successful per-task skip.
 * Concurrent work may already have completed; a later collection change starts a new pass.
 */
export const reconcileTaskDiffCollectionsFromCallback = (input: ReconcileTaskDiffCollectionsInput) =>
	reconcileTaskDiffCollections(input).pipe(
		Effect.catchTag('SchemaError', (error) =>
			reportTaskDiffError(error, 'collections.reconcile', { taskCount: input.taskIds.size }),
		),
		Effect.catchCause((cause) =>
			reportTaskDiffError(cause, 'collections.reconcile.defect', { taskCount: input.taskIds.size }),
		),
	)

interface SessionChange {
	readonly value: { readonly task_id?: string | null }
}

interface TaskChange {
	readonly value: { readonly id: string }
}

export interface TaskDiffCollectionLifecycle {
	reconcileSessionChanges(changes: ReadonlyArray<SessionChange>): void
	reconcileTaskChanges(changes: ReadonlyArray<TaskChange>): void
	reconcileAllTasks(): void
}

export function makeTaskDiffCollectionLifecycle(input: {
	readonly collections: TaskDiffLifecycleCollections
	readonly runtime: DaemonRuntime
}): TaskDiffCollectionLifecycle {
	const reconcile = (taskIds: ReadonlySet<string>) => {
		input.runtime.runFork(reconcileTaskDiffCollectionsFromCallback({ collections: input.collections, taskIds }))
	}

	return {
		reconcileSessionChanges: (changes) =>
			reconcile(new Set(changes.flatMap((change) => (change.value.task_id ? [change.value.task_id] : [])))),
		reconcileTaskChanges: (changes) => reconcile(new Set(changes.map((change) => change.value.id))),
		reconcileAllTasks: () => reconcile(new Set(input.collections.tasks.toArray.map((task) => task.id))),
	}
}
