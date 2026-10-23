import { and, eq, not, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useUnreadTaskIds } from '@/hooks/live-queries/useUnreadTaskIds'
import { useUnreadStore } from '@/hooks/stores/unreadStore'

import { getHorizontalTabPresentation, getHorizontalTabRoute } from './horizontalTabPresentation'

export function useHorizontalTabPresentation(href: string) {
	const { sessionsCollection, tasksCollection } = useSync()
	const unreadSessionIds = useUnreadStore((state) => state.unreadSessionIds)
	const unreadTaskIds = useUnreadTaskIds()
	const route = useMemo(() => getHorizontalTabRoute(href), [href])
	const taskId = route.kind === 'task' ? route.taskId : undefined
	const sessionId = route.kind === 'session' ? route.sessionId : undefined

	const { data: taskRows } = useLiveQuery(
		(q) => (taskId ? q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId)) : undefined),
		[tasksCollection, taskId],
	)
	const { data: sessionRows } = useLiveQuery(
		(q) =>
			sessionId
				? q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, sessionId))
				: undefined,
		[sessionsCollection, sessionId],
	)
	const { data: taskSessionRows } = useLiveQuery(
		(q) =>
			taskId
				? q
						.from({ sessions: sessionsCollection })
						.where(({ sessions }) =>
							and(
								eq(sessions.task_id, taskId),
								not(eq(sessions.archived, true)),
								not(eq(sessions.status, 'draft')),
							),
						)
						.select(({ sessions }) => ({
							status: sessions.status,
							lastActivityAt: sessions.last_activity_at,
						}))
				: undefined,
		[sessionsCollection, taskId],
	)

	const task = taskRows?.[0]
	const session = sessionRows?.[0]
	return useMemo(
		() =>
			getHorizontalTabPresentation({
				href,
				task,
				session: session
					? {
							title: session.title,
							summary: session.summary,
							status: session.status,
							lastActivityAt: session.last_activity_at,
						}
					: undefined,
				taskSessions: taskSessionRows ?? [],
				isUnread: sessionId ? unreadSessionIds.has(sessionId) : false,
				isTaskUnread: taskId ? unreadTaskIds.has(taskId) : false,
			}),
		[href, session, sessionId, task, taskId, taskSessionRows, unreadSessionIds, unreadTaskIds],
	)
}
