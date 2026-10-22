import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { useEffect, useRef } from 'react'

import { selectSmartEntryTarget } from './selectSmartEntryTarget'
import { useExpansionStore } from './stores/expansionStore'

export interface UseSmartSessionEntryScrollOptions {
	sessionId: string
	hasEvents: boolean
	isSessionReady: boolean
	isSessionLoading: boolean
	approvalsReady: boolean
	oldestPendingApprovalEventId: string | null
	events: ConversationEvent[]
	scrollToPendingApprovalEvent: (eventId: string) => void
	jumpToBottom: () => void
}

/**
 * One-shot session-entry scroll. Fires exactly once per `sessionId` when the
 * gate is first satisfied, and re-arms whenever `sessionId` changes so that
 * in-app navigation between two /sessions/$sessionId URLs (sidebar task tree,
 * session-table rows, mod+shift+enter sibling hotkey) lands the
 * user at the smart-entry target on every arrival, not just the first mount.
 *
 * Scrolls to and keyboard-focuses the oldest pending approval (expanding its
 * parent sub-agent group first if nested); falls back to jumpToBottom() when
 * there are no pending approvals.
 *
 * The ref guard prevents re-firing when jumpToBottom's identity changes on each
 * new event (its rootEvents dep) — that decision belongs to useAutoScrollOnNewEvents.
 */
export function useSmartSessionEntryScroll(opts: UseSmartSessionEntryScrollOptions): void {
	const {
		sessionId,
		hasEvents,
		isSessionReady,
		isSessionLoading,
		approvalsReady,
		oldestPendingApprovalEventId,
		events,
		scrollToPendingApprovalEvent,
		jumpToBottom,
	} = opts

	const hasScrolledOnEntryRef = useRef(false)
	const entryScrollScheduledRef = useRef(false)
	const prevSessionIdRef = useRef(sessionId)

	useEffect(() => {
		// Re-arm the one-shot guard whenever the user navigates from one session
		// to another inside the same long-lived DesktopSessionDetailPage instance.
		// Pattern mirrors useAutoScrollOnNewEvents: read previous → write current → compare → act.
		if (prevSessionIdRef.current !== sessionId) {
			prevSessionIdRef.current = sessionId
			hasScrolledOnEntryRef.current = false
			entryScrollScheduledRef.current = false
		}
		if (hasScrolledOnEntryRef.current || entryScrollScheduledRef.current) return
		if (!(hasEvents && isSessionReady && !isSessionLoading && approvalsReady)) return
		const target = selectSmartEntryTarget(oldestPendingApprovalEventId, events)
		entryScrollScheduledRef.current = true
		// Paint the selected session before the virtualizer performs entry scrolling.
		let secondFrame = 0
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => {
				entryScrollScheduledRef.current = false
				if (hasScrolledOnEntryRef.current) return
				hasScrolledOnEntryRef.current = true
				if (target.kind === 'pending-approval') {
					if (target.parentToolUseId !== undefined) {
						useExpansionStore.getState().expand(target.parentToolUseId)
						requestAnimationFrame(() => scrollToPendingApprovalEvent(target.eventId))
					} else {
						scrollToPendingApprovalEvent(target.eventId)
					}
				} else {
					jumpToBottom()
				}
			})
		})
		return () => {
			cancelAnimationFrame(firstFrame)
			cancelAnimationFrame(secondFrame)
			entryScrollScheduledRef.current = false
		}
	}, [
		sessionId,
		hasEvents,
		isSessionReady,
		isSessionLoading,
		approvalsReady,
		oldestPendingApprovalEventId,
		events,
		scrollToPendingApprovalEvent,
		jumpToBottom,
	])
}
