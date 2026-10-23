import { and, eq, not, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { compareSessionsByActivityMinute } from '@/lib/activitySorting'

/**
 * Get active sessions with task names via LEFT JOIN
 * Uses activity-minute ordering to stabilize sort order during parallel execution
 * Ownership filter is intentional: only shows user's own sessions in the Sessions tab
 */
export function useActiveSessions(userId?: string | null) {
	const { sessionsCollection, tasksCollection } = useSync()
	const { data: activeSessions } = useLiveQuery(
		(q) => {
			// Intentional: Sessions tab shows only owned sessions (not shared sessions from other users)
			if (!userId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.leftJoin({ tasks: tasksCollection }, ({ sessions, tasks }) => eq(sessions.task_id, tasks.id))
				.where(({ sessions }) =>
					and(
						not(eq(sessions.archived, true)),
						not(eq(sessions.status, 'draft')),
						eq(sessions.resource_owner_user_id, userId),
					),
				)
				.select(({ sessions, tasks }) => ({
					id: sessions.id,
					status: sessions.status,
					title: sessions.title,
					summary: sessions.summary,
					prompt: sessions.prompt,
					model: sessions.model,
					working_directory: sessions.working_directory,
					created_at: sessions.created_at,
					last_activity_at: sessions.last_activity_at,
					archived: sessions.archived,
					permissions_mode: sessions.permissions_mode,
					task_id: sessions.task_id,
					labels: sessions.labels,
					taskName: tasks?.name,
				}))
		},
		[sessionsCollection, tasksCollection, userId],
	)

	const sortedSessions = useMemo(() => {
		if (!activeSessions) return []
		return [...activeSessions].sort(compareSessionsByActivityMinute)
	}, [activeSessions])

	return sortedSessions
}
