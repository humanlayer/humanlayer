import type { NextStepSuggestion } from '@humanlayer/db/zodschemas/next-step'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { SKILL_ID_TO_SLASH_COMMAND } from '@humanlayer/ui/constants/rpi-skills'
import { useNavigate } from '@tanstack/react-router'
import type { Virtualizer } from '@tanstack/react-virtual'
import { type MutableRefObject, useCallback, useMemo } from 'react'

import type { VirtualStreamItem } from '@/components/conversation-stream/WiredConversationStream'
import { useExistingSessionForNextStep } from '@/hooks/live-queries/useExistingSessionForNextStep'
import { useDismissedNextStepStore } from '@/hooks/stores/dismissedNextStepStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useEventInViewport } from '@/hooks/useEventInViewport'
import { useNextStepIndicatorVisible } from '@/hooks/useNextStepIndicatorVisible'
import { useSmartSessionEntryScroll } from '@/hooks/useSmartSessionEntryScroll'

import type { SessionDetailSession } from './useSessionDetailData'

type DraftSearch = (typeof import('@/routes/_app/sessions/draft').Route)['types']['fullSearchSchema']

/**
 * Next-step and pending-approval navigation for the session detail page:
 * scroll-to targets driven by the virtualizer, viewport tracking for the
 * floating indicators, the smart session-entry scroll, the "Proceed to Next
 * Step" handler, and sibling-session detection for auto-advanced phases.
 */
export function useSessionNextStep({
	sessionId,
	session,
	events,
	hasEvents,
	isSessionReady,
	isSessionLoading,
	approvalsReady,
	nextStepEventIds,
	pendingApprovalEventIds,
	autoAdvanceConfig,
	isAutoAdvanceEnabled,
	virtualizerRef,
	virtualItemsRef,
	scrollContainerRef,
	jumpToBottom,
}: {
	sessionId: string
	session: SessionDetailSession | undefined
	events: ConversationEvent[]
	hasEvents: boolean
	isSessionReady: boolean
	isSessionLoading: boolean
	approvalsReady: boolean
	nextStepEventIds: string[]
	pendingApprovalEventIds: string[]
	autoAdvanceConfig: { targetLabel: string | null }
	isAutoAdvanceEnabled: boolean
	virtualizerRef: MutableRefObject<Virtualizer<HTMLDivElement, Element> | null>
	virtualItemsRef: MutableRefObject<VirtualStreamItem[] | null>
	scrollContainerRef: MutableRefObject<HTMLDivElement | null>
	jumpToBottom: () => void
}) {
	const navigate = useNavigate()

	// Most recent next-step event ID (chronological order; last is most recent)
	const lastNextStepEventId = nextStepEventIds[nextStepEventIds.length - 1] ?? null

	// Reactive: is the most-recent next-step event currently dismissed?
	// Used by <NextStepIndicator dismissedEventId={...} />.
	const dismissedNextStepEventId = useDismissedNextStepStore((s) =>
		lastNextStepEventId && s.dismissedEventIds.has(lastNextStepEventId) ? lastNextStepEventId : null,
	)

	// Dismiss the floating indicator for the current latest next-step event
	const dismissNextStep = useCallback(() => {
		if (lastNextStepEventId) {
			useDismissedNextStepStore.getState().dismiss(lastNextStepEventId)
		}
	}, [lastNextStepEventId])

	// The suggestion payload from the most-recent next-step event (for the hotkey two-step machine)
	const lastNextStepSuggestion = useMemo(() => {
		if (!lastNextStepEventId) return null
		const ev = events.find((e) => e.id === lastNextStepEventId)
		return ev?.nextStepSuggestion ?? null
	}, [events, lastNextStepEventId])

	// Scroll to and focus the given next-step event using the virtualizer.
	// Uses the triple-rAF settle pattern to handle dynamic row measurement.
	const scrollToNextStepEvent = useCallback(
		(eventId: string) => {
			const v = virtualizerRef.current
			const items = virtualItemsRef.current
			if (!v || !items) return
			const idx = items.findIndex((it) => (it.type === 'event' || it.type === 'root') && it.event.id === eventId)
			if (idx < 0) return
			v.scrollToIndex(idx, { align: 'end' })
			useFocusStore.getState().setFocusedEventId(eventId, 'keyboard')
			requestAnimationFrame(() => {
				v.scrollToIndex(idx, { align: 'end' })
				requestAnimationFrame(() => v.scrollToIndex(idx, { align: 'end' }))
			})
		},
		[virtualizerRef, virtualItemsRef],
	)

	// Single source of truth: is the most-recent next-step event in the viewport?
	// Shared by <NextStepIndicator> and useSessionHotkeys.
	const lastNextStepEventInViewport = useEventInViewport(virtualizerRef, scrollContainerRef, lastNextStepEventId)

	const handleScrollToNextStep = useCallback(() => {
		if (!lastNextStepEventId) return
		scrollToNextStepEvent(lastNextStepEventId)
		useDismissedNextStepStore.getState().dismiss(lastNextStepEventId)
	}, [lastNextStepEventId, scrollToNextStepEvent])

	// Oldest pending approval is the first chronologically (events are sorted asc by created_at).
	const oldestPendingApprovalEventId = pendingApprovalEventIds[0] ?? null

	// Single source of truth: is the oldest pending approval in the viewport?
	// Shared by <PendingApprovalIndicator> and useSessionHotkeys.
	const oldestPendingApprovalInViewport = useEventInViewport(
		virtualizerRef,
		scrollContainerRef,
		oldestPendingApprovalEventId,
	)

	// Scroll to and focus the given pending-approval event using the virtualizer.
	// Same triple-rAF settle pattern as scrollToNextStepEvent.
	const scrollToPendingApprovalEvent = useCallback(
		(eventId: string) => {
			const v = virtualizerRef.current
			const items = virtualItemsRef.current
			if (!v || !items) return
			const idx = items.findIndex((it) => (it.type === 'event' || it.type === 'root') && it.event.id === eventId)
			if (idx < 0) return
			v.scrollToIndex(idx, { align: 'end' })
			useFocusStore.getState().setFocusedEventId(eventId, 'keyboard')
			requestAnimationFrame(() => {
				v.scrollToIndex(idx, { align: 'end' })
				requestAnimationFrame(() => v.scrollToIndex(idx, { align: 'end' }))
			})
		},
		[virtualizerRef, virtualItemsRef],
	)

	// Smart session entry: one-shot pending-approval-first / bottom-fallback scroll.
	// See .humanlayer/tasks/core-1119-smart-session-entry-check-for-permission-requests-first.
	useSmartSessionEntryScroll({
		sessionId,
		hasEvents,
		isSessionReady,
		isSessionLoading,
		approvalsReady,
		oldestPendingApprovalEventId,
		events,
		scrollToPendingApprovalEvent,
		jumpToBottom,
	})

	const handleScrollToPendingApproval = useCallback(() => {
		if (!oldestPendingApprovalEventId) return
		scrollToPendingApprovalEvent(oldestPendingApprovalEventId)
	}, [oldestPendingApprovalEventId, scrollToPendingApprovalEvent])

	// Handler for row-level "Proceed to Next Step" button
	const handleRowProceedToNextStep = useCallback(
		(_eventId: string, suggestion: NextStepSuggestion) => {
			if (suggestion.extraction.type !== 'next_step_found') return

			const { nextStepType, suggestedDirectory } = suggestion.extraction

			const slashCommand = SKILL_ID_TO_SLASH_COMMAND[nextStepType]
			const workingDir = suggestedDirectory || session?.working_directory
			const search: DraftSearch = { slashCommand, updateTaskDir: true }
			if (session?.task_id) search.taskId = session.task_id
			if (workingDir) search.workingDirectory = workingDir
			if (session?.permissions_mode) search.permissionsMode = session.permissions_mode

			dismissNextStep()
			navigate({
				to: '/sessions/draft',
				search,
			})
		},
		[session, navigate, dismissNextStep],
	)

	// Check if a sibling session with the next-step target label already exists
	// Only consider siblings created AFTER the current session to handle rewind/redo scenarios
	const { siblingSessionId } = useExistingSessionForNextStep(
		session?.task_id,
		autoAdvanceConfig.targetLabel,
		session?.created_at,
		session?.id,
	)

	// Navigate to existing sibling session instead of creating a draft
	const handleNavigateToSibling = useCallback(() => {
		if (!siblingSessionId) return
		navigate({ to: '/sessions/$sessionId', params: { sessionId: siblingSessionId } })
	}, [siblingSessionId, navigate])

	// Determine if session is running
	const isRunning = session?.status === 'running' || session?.status === 'launching'

	// Derive whether the NextStepIndicator would be visible, so we can add
	// bottom clearance to the conversation virtualizer (paddingEnd) and prevent
	// the floating bar from covering the bottom-most message.
	const { visible: nextStepIndicatorVisible } = useNextStepIndicatorVisible({
		nextStepEventIds,
		dismissedEventId: dismissedNextStepEventId,
		isReadyForInput: session?.status === 'ready_for_input',
		virtualizerRef,
		parentRef: scrollContainerRef,
	})

	// Mirror the indicator's render gate so paddingEnd only applies when the
	// bar would actually render visibly (same condition as the indicator JSX).
	const nextStepVisible =
		nextStepIndicatorVisible &&
		!isRunning &&
		(!isAutoAdvanceEnabled || (isAutoAdvanceEnabled && !siblingSessionId && session?.status === 'ready_for_input'))

	return {
		lastNextStepEventId,
		dismissedNextStepEventId,
		lastNextStepSuggestion,
		lastNextStepEventInViewport,
		scrollToNextStepEvent,
		handleScrollToNextStep,
		oldestPendingApprovalEventId,
		oldestPendingApprovalInViewport,
		scrollToPendingApprovalEvent,
		handleScrollToPendingApproval,
		handleRowProceedToNextStep,
		siblingSessionId,
		handleNavigateToSibling,
		nextStepVisible,
	}
}
