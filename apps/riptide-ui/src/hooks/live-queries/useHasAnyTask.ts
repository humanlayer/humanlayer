import { and, eq, not, or, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Whether the current user has any task that would populate the left sidebar —
 * owned tasks UNION shared tasks where the user has created a session, excluding
 * archived tasks and drafts. Mirrors the candidate set in `useTasksByRecency`
 * that drives the sidebar task tree.
 *
 * Intentionally scoped to *my* tasks: the sidebar renders the user's own tasks,
 * so it stays hidden until the user has one. A non-task-creator who can only see
 * a teammate's tasks browses them on the Kanban board (which keys off the
 * filter-independent total), not the sidebar.
 *
 * Returns `isReady` so callers can avoid acting on the (transient) empty state
 * before the live query has hydrated.
 */
export function useHasAnyTask(userId?: string | null): { hasTask: boolean; isReady: boolean } {
	const { tasksCollection, sessionsCollection } = useSync()

	const { data, isReady } = useLiveQuery(
		(q) => {
			if (!userId) return undefined
			return q
				.from({ tasks: tasksCollection })
				.leftJoin({ sessions: sessionsCollection }, ({ tasks, sessions }) => eq(tasks.id, sessions.task_id))
				.where(({ tasks, sessions }) =>
					and(
						not(eq(tasks.archived, true)),
						not(eq(tasks.is_draft, true)),
						or(eq(tasks.resource_owner_user_id, userId), eq(sessions.created_by, userId)),
					),
				)
				.groupBy(({ tasks }) => tasks.id)
				.select(({ tasks }) => ({ id: tasks.id }))
		},
		[tasksCollection, sessionsCollection, userId],
	)

	return { hasTask: (data?.length ?? 0) > 0, isReady }
}

/**
 * Whether the organization has any task at all, independent of the Tasks
 * scope filter. Drives the Tasks first-run Create Task state: zero here means
 * there are genuinely no tasks, as opposed to a filter hiding all of them.
 *
 * Returns `isReady` so callers do not flash Create Task before the live query
 * has hydrated.
 */
export function useHasAnyOrgTask(): { hasTask: boolean; isReady: boolean } {
	const { tasksCollection } = useSync()

	const { data, isReady } = useLiveQuery(
		(q) => q.from({ tasks: tasksCollection }).select(({ tasks }) => ({ id: tasks.id })),
		[tasksCollection],
	)

	return { hasTask: (data?.length ?? 0) > 0, isReady }
}
