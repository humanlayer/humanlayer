import type { NextStepSuggestion } from '@humanlayer/db/zodschemas/next-step'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

import { useExistingSessionForNextStep } from '@/hooks/live-queries/useExistingSessionForNextStep'

interface EventRowNextStepInput {
	event: ConversationEvent | null
	taskId: string | null | undefined
	sessionId: string
	targetLabel: string | null | undefined
	nextStepName: string | null | undefined
	isAutoAdvanceEnabled: boolean
	onProceedToNextStep: (eventId: string, suggestion: NextStepSuggestion) => void
}

/**
 * Next-step navigation state for one conversation event row: resolves an
 * existing sibling session for the suggested step and derives the button
 * label, variant, and disabled state.
 */
export function useEventRowNextStep(input: EventRowNextStepInput) {
	const navigate = useNavigate()
	const hasNextStepSuggestion = input.event?.nextStepSuggestion?.extraction.type === 'next_step_found'
	const { siblingSessionId } = useExistingSessionForNextStep(
		hasNextStepSuggestion ? (input.taskId ?? null) : null,
		hasNextStepSuggestion ? (input.targetLabel ?? null) : null,
		hasNextStepSuggestion ? (input.event?.createdAt.getTime() ?? null) : null,
		hasNextStepSuggestion ? input.sessionId : null,
	)

	const onProceed = input.onProceedToNextStep
	const handleProceedToNextStep = useCallback(
		(nextStepEventId: string, suggestion: NextStepSuggestion) => {
			if (siblingSessionId) {
				navigate({ to: '/sessions/$sessionId', params: { sessionId: siblingSessionId } })
				return
			}
			onProceed(nextStepEventId, suggestion)
		},
		[siblingSessionId, navigate, onProceed],
	)

	const nextStepLabelOverride = siblingSessionId
		? input.nextStepName
			? `View ${input.nextStepName}`
			: undefined
		: input.isAutoAdvanceEnabled
			? 'Auto-advancing...'
			: undefined

	const nextStepVariant = siblingSessionId || input.isAutoAdvanceEnabled ? ('outline' as const) : undefined
	const nextStepDisabled = siblingSessionId ? false : input.isAutoAdvanceEnabled

	return { handleProceedToNextStep, nextStepLabelOverride, nextStepVariant, nextStepDisabled }
}
