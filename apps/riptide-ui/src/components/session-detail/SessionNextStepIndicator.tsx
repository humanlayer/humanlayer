import { NextStepIndicator } from '@/components/NextStepIndicator'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'

/**
 * Render gate + label resolution for the floating NextStepIndicator on the
 * session detail page. Hidden while running; when auto-advance is enabled it
 * only renders once a sibling session exists ("View: <next step>") or the
 * session is waiting for input ("Auto-advancing...").
 */
export function SessionNextStepIndicator() {
	const { session, conversation, isRunning, autoAdvance, nextStep, virtualizerRef, scrollContainerRef } =
		useSessionDetail()
	const { nextStepEventIds, mostRecentNextStepLabel } = conversation
	const { isAutoAdvanceEnabled } = autoAdvance
	const autoAdvanceNextStepName = autoAdvance.autoAdvanceConfig.nextStepName
	const { siblingSessionId, dismissedNextStepEventId, handleScrollToNextStep } = nextStep

	const shouldRender =
		!isRunning &&
		(!isAutoAdvanceEnabled || (isAutoAdvanceEnabled && !siblingSessionId && session.status === 'ready_for_input'))
	if (!shouldRender) return null

	return (
		<NextStepIndicator
			nextStepEventIds={nextStepEventIds}
			dismissedEventId={dismissedNextStepEventId}
			isRunning={isRunning}
			isReadyForInput={session.status === 'ready_for_input'}
			nextStepLabel={
				isAutoAdvanceEnabled && !siblingSessionId
					? undefined
					: siblingSessionId && autoAdvanceNextStepName
						? undefined
						: mostRecentNextStepLabel
			}
			labelOverride={
				isAutoAdvanceEnabled && !siblingSessionId
					? 'Auto-advancing...'
					: siblingSessionId && autoAdvanceNextStepName
						? `View: ${autoAdvanceNextStepName}`
						: undefined
			}
			onScrollToNextStep={handleScrollToNextStep}
			virtualizerRef={virtualizerRef}
			parentRef={scrollContainerRef}
		/>
	)
}
