import { and, eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Finds the current user's most recently active session host for one task.
 * Activity is scoped to the session creator so shared-task collaborators do
 * not change each other's launch defaults.
 */
export function useTaskLastUsedHost(taskId: string | null, userId: string | null | undefined) {
	const { sessionsCollection } = useSync()
	const sessions = useLiveQuery(
		(q) => {
			if (!taskId || !userId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => and(eq(sessions.task_id, taskId), eq(sessions.created_by, userId)))
				.orderBy(({ sessions }) => sessions.last_activity_at, 'desc')
				.limit(1)
				.select(({ sessions }) => ({
					host_id: sessions.host_id,
				}))
		},
		[sessionsCollection, taskId, userId],
	)

	const hostId = sessions.data?.[0]?.host_id ?? null

	return { hostId, isReady: sessions.isReady }
}
