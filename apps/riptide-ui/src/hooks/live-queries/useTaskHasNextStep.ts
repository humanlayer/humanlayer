import { NextStepSuggestionSchema } from '@humanlayer/db/zodschemas/next-step'
import { and, eq, not, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'

/** Full next step data for navigating to draft */
export interface NextStepData {
	nextStepPrompt: string
	nextStepSummary: string
	nextStepType: string
	taskReference: string
	suggestedDirectory?: string
	// Session context for fallbacks
	workingDirectory?: string | null
	permissionsMode?: string | null
	taskId?: string | null
}

export interface TaskHasNextStepResult {
	hasNextStep: boolean
	sessionId: string | null
	sessionCreatedAt: bigint | null
	nextStepData: NextStepData | null
	isReady: boolean
}

type TaskSessionCandidate = {
	id: string
	created_at: bigint
	next_step_suggestions: unknown
	working_directory: string | null
	permissions_mode: string | null
	task_id: string | null
	last_activity_at: bigint | null
}

/**
 * Check if a task's most recent non-archived session has a valid next step suggestion.
 * Returns full next step data for direct navigation to draft launcher.
 */
export function useTaskHasNextStep(taskId: string | undefined): TaskHasNextStepResult {
	const { sessionsCollection } = useSync()

	// Query the most recent non-archived session for this task
	const { data: sessionData, isReady } = useLiveQuery(
		(q) => {
			if (!taskId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.select(({ sessions }) => ({
					id: sessions.id,
					created_at: sessions.created_at,
					next_step_suggestions: sessions.next_step_suggestions,
					working_directory: sessions.working_directory,
					permissions_mode: sessions.permissions_mode,
					task_id: sessions.task_id,
					last_activity_at: sessions.last_activity_at,
				}))
				.where(({ sessions }) => and(eq(sessions.task_id, taskId), not(eq(sessions.archived, true))))
		},
		[sessionsCollection, taskId],
	)

	const result = useMemo(() => {
		const mostRecentSession = (sessionData ?? []).reduce<TaskSessionCandidate | null>((mostRecent, session) => {
			if (!mostRecent) return session

			const mostRecentLastActivityAt =
				mostRecent.last_activity_at == null ? Number.NEGATIVE_INFINITY : Number(mostRecent.last_activity_at)
			const sessionLastActivityAt =
				session.last_activity_at == null ? Number.NEGATIVE_INFINITY : Number(session.last_activity_at)

			return sessionLastActivityAt > mostRecentLastActivityAt ? session : mostRecent
		}, null)

		if (!mostRecentSession) {
			return { hasNextStep: false, sessionId: null, sessionCreatedAt: null, nextStepData: null }
		}

		// Parse next_step_suggestions - handle both parsed array and JSON string (Electric may return string)
		const raw = mostRecentSession.next_step_suggestions
		if (!raw) {
			return { hasNextStep: false, sessionId: null, sessionCreatedAt: null, nextStepData: null }
		}

		let suggestionsArray: unknown[] | null = null
		if (Array.isArray(raw)) {
			suggestionsArray = raw
		} else if (typeof raw === 'string') {
			try {
				suggestionsArray = JSON.parse(raw)
			} catch {
				return { hasNextStep: false, sessionId: null, sessionCreatedAt: null, nextStepData: null }
			}
		}

		if (!suggestionsArray?.[0]) {
			return { hasNextStep: false, sessionId: null, sessionCreatedAt: null, nextStepData: null }
		}

		const parsedSuggestion = NextStepSuggestionSchema.safeParse(suggestionsArray[0])

		// Only consider it a valid next step if extraction type is 'next_step_found'
		if (!parsedSuggestion.success || parsedSuggestion.data.extraction.type !== 'next_step_found') {
			return { hasNextStep: false, sessionId: null, sessionCreatedAt: null, nextStepData: null }
		}

		const extraction = parsedSuggestion.data.extraction

		return {
			hasNextStep: true,
			sessionId: mostRecentSession.id,
			sessionCreatedAt: mostRecentSession.created_at,
			nextStepData: {
				nextStepPrompt: extraction.nextStepPrompt,
				nextStepSummary: extraction.nextStepSummary,
				nextStepType: extraction.nextStepType,
				taskReference: extraction.taskReference,
				suggestedDirectory: extraction.suggestedDirectory,
				// Session context for fallbacks
				workingDirectory: mostRecentSession.working_directory,
				permissionsMode: mostRecentSession.permissions_mode,
				taskId: mostRecentSession.task_id,
			},
		}
	}, [sessionData])

	return {
		...result,
		isReady,
	}
}
