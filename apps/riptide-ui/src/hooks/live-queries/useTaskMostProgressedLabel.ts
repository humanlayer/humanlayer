import { RPI_LABELS, type SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import { and, eq, not, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'

export interface TaskMostProgressedLabelResult {
	label: SessionLabel | null
	isReady: boolean
}

/**
 * Get the index of a label in the RPI progression order.
 * Higher index = more progressed. Returns -1 for unknown labels.
 */
function getLabelProgressIndex(label: SessionLabel): number {
	return RPI_LABELS.findIndex((l) => l.name === label.name)
}

/**
 * Get the most progressed RPI label across all sessions for a task.
 * Used for status-at-a-glance in the task table.
 * Excludes archived sessions.
 */
export function useTaskMostProgressedLabel(taskId: string | undefined): TaskMostProgressedLabelResult {
	const { sessionsCollection } = useSync()

	// Fetch all non-archived sessions for this task with their labels
	const { data: sessions, isReady } = useLiveQuery(
		(q) => {
			if (!taskId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.select(({ sessions }) => ({
					labels: sessions.labels,
				}))
				.where(({ sessions }) => and(eq(sessions.task_id, taskId), not(eq(sessions.archived, true))))
		},
		[sessionsCollection, taskId],
	)

	// Find the most progressed label across all sessions
	// TODO: Verify session.labels format - may need JSON.parse() if Electric sends as string
	const label = useMemo(() => {
		if (!sessions || sessions.length === 0) return null

		let mostProgressed: SessionLabel | null = null
		let highestIndex = -1

		for (const session of sessions) {
			const sessionLabels = session.labels as SessionLabel[] | null
			if (!sessionLabels || !Array.isArray(sessionLabels)) continue

			for (const lbl of sessionLabels) {
				const index = getLabelProgressIndex(lbl)
				if (index > highestIndex) {
					highestIndex = index
					mostProgressed = lbl
				}
			}
		}

		return mostProgressed
	}, [sessions])

	return { label, isReady }
}
