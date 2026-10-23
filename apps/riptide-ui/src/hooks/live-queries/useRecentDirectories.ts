import { and, eq, max, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Fetches unique working directories from sessions, ordered by most recent usage.
 * Used to populate the directory selector dropdown with recently used paths.
 *
 * @param hostId - Optional host ID to filter directories by. If undefined, returns empty array.
 * @returns Array of unique directory paths ordered by recency (most recent first), limited to 100.
 */
export function useRecentDirectories(hostId: string | undefined, userId?: string | null): string[] {
	const { sessionsCollection } = useSync()

	const { data } = useLiveQuery(
		(q) => {
			if (!hostId || !userId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => and(eq(sessions.host_id, hostId), eq(sessions.created_by, userId)))
				.groupBy(({ sessions }) => sessions.working_directory)
				.select(({ sessions }) => ({
					working_directory: sessions.working_directory,
					last_used: max(sessions.last_activity_at),
				}))
		},
		[sessionsCollection, hostId, userId],
	)

	return useMemo(() => {
		const recentDirectories = data ?? []
		// TanStack DB 0.6 requires an order-by index for ordered snapshots with limits.
		// This grouped aggregate query (`orderBy(max(...)).limit(...)`) cannot provide one,
		// so we sort and cap client-side instead of asking the live query engine to paginate it.
		// Filter out null AND empty string working directories in JS
		return [...recentDirectories]
			.sort((a, b) => {
				const aLastUsed = Number(a.last_used ?? 0n)
				const bLastUsed = Number(b.last_used ?? 0n)
				if (bLastUsed !== aLastUsed) {
					return bLastUsed - aLastUsed
				}
				return (a.working_directory ?? '').localeCompare(b.working_directory ?? '')
			})
			.map((row) => row.working_directory)
			.filter((dir): dir is string => dir !== null && dir !== '')
			.slice(0, 100)
	}, [data])
}
