import { and, count, eq, not, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Get the count of draft tasks owned by the user
 * Ownership filter is intentional: not syncing other users' draft tasks
 */
export function useDraftTasksCount(userId?: string | null): number {
	const { tasksCollection } = useSync()
	const { data } = useLiveQuery(
		(q) => {
			// Intentional: Drafts tab count shows only owned task drafts (not syncing shared drafts)
			if (!userId) return undefined
			return q
				.from({ tasks: tasksCollection })
				.select(({ tasks }) => ({ count: count(tasks.id) }))
				.where(({ tasks }) =>
					and(
						not(eq(tasks.archived, true)),
						eq(tasks.is_draft, true),
						eq(tasks.resource_owner_user_id, userId),
					),
				)
		},
		[tasksCollection, userId],
	)

	return data?.[0]?.count ?? 0
}
