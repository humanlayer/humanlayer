import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { isTaskEligible, matchesTaskScope, type TaskScope } from '@/lib/tasks/taskScope'

/**
 * The number of tasks the Tasks surface would show under the given scope.
 *
 * Lives at `SessionsPage` level because the Tasks body unmounts on every other
 * tab, and only one layout mounts at a time — the badge would otherwise go
 * stale or disagree with the control-row count. It runs the same eligibility and
 * scope predicates as Board and List, over minimal projections.
 */
export function useFilteredTasksCount(scope: TaskScope): number {
	const { tasksCollection, sessionsCollection } = useSync()

	const { data: taskRows } = useLiveQuery(
		(q) =>
			q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.archived, false))
				.select(({ tasks }) => ({
					id: tasks.id,
					archived: tasks.archived,
					is_draft: tasks.is_draft,
					resource_owner_user_id: tasks.resource_owner_user_id,
				})),
		[tasksCollection],
	)

	// Session creators are only needed to resolve Mine membership.
	const needsSessions = scope.mode === 'mine'
	const { data: sessionRows } = useLiveQuery(
		(q) => {
			if (!needsSessions) return undefined
			return q.from({ sessions: sessionsCollection }).select(({ sessions }) => ({
				task_id: sessions.task_id,
				created_by: sessions.created_by,
			}))
		},
		[sessionsCollection, needsSessions],
	)

	return useMemo(() => {
		const creatorsByTaskId = new Map<string, Array<string | null>>()
		for (const session of sessionRows ?? []) {
			if (!session.task_id) continue
			const bucket = creatorsByTaskId.get(session.task_id)
			if (bucket) bucket.push(session.created_by)
			else creatorsByTaskId.set(session.task_id, [session.created_by])
		}

		let total = 0
		for (const task of taskRows ?? []) {
			if (!isTaskEligible(task, scope)) continue
			if (!matchesTaskScope(task, creatorsByTaskId.get(task.id) ?? [], scope)) continue
			total += 1
		}
		return total
	}, [taskRows, sessionRows, scope])
}
