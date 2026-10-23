import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'

import { useSync } from '@/components/providers/SyncProvider'
import { useIsColocated } from '@/hooks/use-colocated'

export function useLocalTaskArtifactDirectory(taskId: string): string | null {
	const { sessionsCollection } = useSync()
	const { user } = useAuth()
	const { localHostId } = useIsColocated(undefined)
	const { data } = useLiveQuery(
		(q) => {
			if (!user?.id || !localHostId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) =>
					and(
						eq(sessions.task_id, taskId),
						eq(sessions.created_by, user.id),
						eq(sessions.host_id, localHostId),
					),
				)
				.orderBy(({ sessions }) => sessions.last_activity_at, 'desc')
				.limit(1)
		},
		[sessionsCollection, taskId, user?.id, localHostId],
	)

	return data?.[0]?.working_directory ?? null
}
