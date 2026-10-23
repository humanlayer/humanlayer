import type { Virtualizer } from '@tanstack/react-virtual'
import type { MutableRefObject } from 'react'

import { useEventInViewport } from './useEventInViewport'

export interface UseNextStepIndicatorVisibleArgs {
	/** Array of event IDs that have next step suggestions. */
	nextStepEventIds: string[]
	/** Most-recent dismissed event ID (or null). */
	dismissedEventId: string | null
	/** True when session.status === 'ready_for_input'. */
	isReadyForInput: boolean
	/** Virtualizer ref forwarded from WiredConversationStream. */
	virtualizerRef: MutableRefObject<Virtualizer<HTMLDivElement, Element> | null>
	/** Scroll container ref forwarded from WiredConversationStream. */
	parentRef: MutableRefObject<HTMLDivElement | null>
}

export interface UseNextStepIndicatorVisibleResult {
	visible: boolean
	lastNextStepId: string | null
}

/**
 * Derives whether the floating NextStepIndicator should be visible.
 *
 * Single source of truth shared by NextStepIndicator (which renders the bar)
 * and the session route (which uses it to add bottom clearance to the
 * conversation virtualizer so the bar does not cover the bottom-most message).
 */
export function useNextStepIndicatorVisible({
	nextStepEventIds,
	dismissedEventId,
	isReadyForInput,
	virtualizerRef,
	parentRef,
}: UseNextStepIndicatorVisibleArgs): UseNextStepIndicatorVisibleResult {
	const lastNextStepId = nextStepEventIds[nextStepEventIds.length - 1] ?? null
	const inViewport = useEventInViewport(virtualizerRef, parentRef, lastNextStepId)
	const isDismissed = !!lastNextStepId && dismissedEventId === lastNextStepId
	const visible = !!lastNextStepId && isReadyForInput && !isDismissed && !inViewport

	return { visible, lastNextStepId }
}
