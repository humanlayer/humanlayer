import type { SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import { and, eq, gt, not, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { bigintToNumber } from '@/utils/session-transforms'

export interface ExistingSessionForNextStepResult {
	siblingSessionId: string | null
	isReady: boolean
}

/**
 * Check if a non-archived sibling session with the given target label exists on a task.
 * Returns the session ID if found, null otherwise. Reactive via Electric sync.
 */
export function useExistingSessionForNextStep(
	taskId: string | null | undefined,
	targetLabel: string | null,
	createdAfter?: bigint | number | string | Date | null,
	excludeSessionId?: string | null,
): ExistingSessionForNextStepResult {
	const { sessionsCollection } = useSync()
	const cutoffMs = bigintToNumber(createdAfter)

	const { data: sessions, isReady } = useLiveQuery(
		(q) => {
			if (!taskId || !targetLabel) return undefined

			let query = q
				.from({ sessions: sessionsCollection })
				.select(({ sessions }) => ({
					id: sessions.id,
					labels: sessions.labels,
				}))
				.where(({ sessions }) => and(eq(sessions.task_id, taskId), not(eq(sessions.archived, true))))

			if (excludeSessionId) {
				query = query.where(({ sessions }) => not(eq(sessions.id, excludeSessionId)))
			}

			if (cutoffMs !== undefined) {
				query = query.where(({ sessions }) => gt(sessions.created_at, BigInt(cutoffMs)))
			}

			return query
		},
		[sessionsCollection, taskId, targetLabel, cutoffMs, excludeSessionId],
	)

	const siblingSessionId = useMemo(() => {
		if (!sessions || !targetLabel) return null
		const match = sessions.find((s) => {
			const labels = (Array.isArray(s.labels) ? s.labels : []) as SessionLabel[]
			return labels.some((l) => l.name === targetLabel)
		})

		return match?.id ?? null
	}, [sessions, targetLabel])

	return { siblingSessionId, isReady }
}
