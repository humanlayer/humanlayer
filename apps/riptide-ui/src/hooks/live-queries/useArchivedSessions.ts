import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { compareSessionsByActivityMinute } from '@/lib/activitySorting'

/**
 * Get archived sessions with task names via LEFT JOIN
 * Ownership filter is intentional: not syncing other users' archived sessions
 */
export function useArchivedSessions(userId?: string | null) {
	const { sessionsCollection, tasksCollection } = useSync()
	const { data: archivedSessions } = useLiveQuery(
		(q) => {
			// Intentional: Archive tab shows only owned sessions (not syncing shared archived sessions)
			if (!userId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.leftJoin({ tasks: tasksCollection }, ({ sessions, tasks }) => eq(sessions.task_id, tasks.id))
				.where(({ sessions }) => and(eq(sessions.archived, true), eq(sessions.resource_owner_user_id, userId)))
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

	return useMemo(() => {
		const sessions = archivedSessions ?? []
		return [...sessions].sort(compareSessionsByActivityMinute)
	}, [archivedSessions])
}
