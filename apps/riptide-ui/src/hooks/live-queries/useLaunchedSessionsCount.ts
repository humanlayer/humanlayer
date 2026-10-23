import { and, count, eq, not, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

export function useLaunchedSessionsCount(userId?: string | null) {
	const { sessionsCollection } = useSync()
	const { data } = useLiveQuery(
		(q) => {
			if (!userId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.select(({ sessions }) => ({ count: count(sessions.id) }))
				.where(({ sessions }) =>
					and(not(eq(sessions.status, 'draft')), eq(sessions.resource_owner_user_id, userId)),
				)
		},
		[sessionsCollection, userId],
	)

	return data?.[0]?.count ?? 0
}
