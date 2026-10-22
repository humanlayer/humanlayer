import { and, eq, not, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'

export interface TaskStatuses {
	needsApprovalCount: number
	mostRecentSessionFailed: boolean
	lostCount: number
	runningCount: number
	pendingCount: number
	waitingForWorkspaceCount: number
	interruptRequestedCount: number
	isReady: boolean
}

/**
 * Get status indicators for a specific task
 * Used for status-at-a-glance indicators in the task table
 * Excludes archived and draft sessions from all checks
 */
export function useTaskStatuses(taskId: string | undefined): TaskStatuses {
	const { sessionsCollection } = useSync()

	const { data: sessions, isReady } = useLiveQuery(
		(q) => {
			if (!taskId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.select(({ sessions }) => ({
					status: sessions.status,
					last_activity_at: sessions.last_activity_at,
				}))
				.where(({ sessions }) => and(eq(sessions.task_id, taskId), not(eq(sessions.archived, true))))
		},
		[sessionsCollection, taskId],
	)

	const derived = useMemo(() => {
		let needsApprovalCount = 0
		let lostCount = 0
		let runningCount = 0
		let pendingCount = 0
		let waitingForWorkspaceCount = 0
		let interruptRequestedCount = 0
		let mostRecentStatus: string | null = null
		let mostRecentLastActivityAt = Number.NEGATIVE_INFINITY

		for (const session of sessions ?? []) {
			switch (session.status) {
				case 'needs_approval':
					needsApprovalCount += 1
					break
				case 'running':
				case 'waiting_for_usage_limit':
					runningCount += 1
					break
				case 'lost':
					lostCount += 1
					break
				case 'ready_for_launch':
				case 'launching':
				case 'resuming':
					pendingCount += 1
					break
				case 'waiting_for_workspace':
					waitingForWorkspaceCount += 1
					break
				case 'interrupt_requested':
					interruptRequestedCount += 1
					break
			}

			const lastActivityAt =
				session.last_activity_at == null ? Number.NEGATIVE_INFINITY : Number(session.last_activity_at)

			if (lastActivityAt > mostRecentLastActivityAt) {
				mostRecentLastActivityAt = lastActivityAt
				mostRecentStatus = session.status
			}
		}

		return {
			needsApprovalCount,
			mostRecentSessionFailed: mostRecentStatus === 'failed',
			lostCount,
			runningCount,
			pendingCount,
			waitingForWorkspaceCount,
			interruptRequestedCount,
		}
	}, [sessions])

	return {
		...derived,
		isReady,
	}
}
