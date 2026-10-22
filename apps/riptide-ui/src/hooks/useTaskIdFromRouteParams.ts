import { eq, useLiveQuery } from '@tanstack/react-db'
import { useParams } from '@tanstack/react-router'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Gets the task_id from route params.
 * Supports both direct taskId param and sessionId param (queries session for task_id).
 */
export function useTaskIdFromRouteParams(): string | undefined {
	const params = useParams({ strict: false })
	const directTaskId = 'taskId' in params ? (params.taskId as string) : undefined
	const sessionId = 'sessionId' in params ? (params.sessionId as string) : undefined

	const { sessionsCollection } = useSync()

	const { data: sessionData } = useLiveQuery(
		(q) =>
			!directTaskId && sessionId
				? q
						.from({ sessions: sessionsCollection })
						.where(({ sessions }) => eq(sessions.id, sessionId))
						.select(({ sessions }) => ({
							task_id: sessions.task_id,
						}))
				: undefined,
		[sessionsCollection, sessionId, directTaskId],
	)

	return directTaskId ?? sessionData?.[0]?.task_id ?? undefined
}
