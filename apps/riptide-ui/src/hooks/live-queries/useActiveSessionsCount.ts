import { and, count, eq, not, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Get the count of active sessions owned by the user
 * Ownership filter is intentional: only counts user's own sessions for the Sessions tab
 */
export function useActiveSessionsCount(userId?: string | null) {
	const { sessionsCollection } = useSync()
	const { data } = useLiveQuery(
		(q) => {
			// Intentional: Sessions tab count shows only owned sessions (not shared sessions)
			if (!userId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.select(({ sessions }) => ({ count: count(sessions.id) }))
				.where(({ sessions }) =>
					and(
						not(eq(sessions.archived, true)),
						not(eq(sessions.status, 'draft')),
						eq(sessions.resource_owner_user_id, userId),
					),
				)
		},
		[sessionsCollection, userId],
	)

	return data?.[0]?.count ?? 0
}
