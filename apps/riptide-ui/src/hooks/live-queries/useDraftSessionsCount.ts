import { and, count, eq, not, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Get the count of draft sessions owned by the user
 * Ownership filter is intentional: not syncing other users' draft sessions
 */
export function useDraftSessionsCount(userId?: string | null) {
	const { sessionsCollection } = useSync()
	const { data } = useLiveQuery(
		(q) => {
			// Intentional: Drafts tab count shows only owned sessions (not syncing shared drafts)
			if (!userId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.select(({ sessions }) => ({ count: count(sessions.id) }))
				.where(({ sessions }) =>
					and(
						not(eq(sessions.archived, true)),
						eq(sessions.status, 'draft'),
						eq(sessions.resource_owner_user_id, userId),
					),
				)
		},
		[sessionsCollection, userId],
	)

	return data?.[0]?.count ?? 0
}
