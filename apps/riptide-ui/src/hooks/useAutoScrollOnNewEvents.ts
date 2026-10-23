import { type MutableRefObject, useEffect, useRef } from 'react'

import { recordSendScrollDiagnostic } from '@/lib/send-scroll-diagnostics'

/**
 * When the visible item count grows AND the user is at the bottom (per `isAtBottomRef`),
 * call `jumpToBottom()` to keep the viewport pinned to the tail.
 *
 * `itemCount` should reflect the virtualizer's visible item count (root events + expanded
 * sub-agent rows), not just `rootEvents.length`. Sub-agent events streamed under an expanded agent
 * group grow `virtualItems.length` without changing `rootEvents.length`; watching only
 * root events lets content extend below the viewport, making the user appear to drift up
 * (CORE-1179).
 *
 * Stateless: there is no persistent "is sticky" flag. Each item-count change re-evaluates
 * the at-bottom signal. If the user scrolls up between arrivals, the next growth will not
 * pull the viewport; if they scroll back to the bottom, the next growth re-engages
 * tail-following.
 */
export function useAutoScrollOnNewEvents({
	itemCount,
	isAtBottomRef,
	jumpToBottom,
	growthBaselineKey,
}: {
	itemCount: number
	isAtBottomRef: MutableRefObject<boolean>
	jumpToBottom: () => void
	/**
	 * When this key changes identity, the count baseline resets without scrolling.
	 * Callers pass a value derived from expand/collapse state so growth caused by
	 * expanding a group near the tail does not yank the viewport to the bottom —
	 * only genuine data growth (streamed events) engages tail-follow.
	 */
	growthBaselineKey?: unknown
}): void {
	const prevLengthRef = useRef(itemCount)
	const prevKeyRef = useRef(growthBaselineKey)

	useEffect(() => {
		const prev = prevLengthRef.current
		prevLengthRef.current = itemCount
		const baselineReset = prevKeyRef.current !== growthBaselineKey
		prevKeyRef.current = growthBaselineKey
		if (itemCount !== prev) {
			recordSendScrollDiagnostic('visible_item_count_changed', {
				previousItemCount: prev,
				itemCount,
				isAtBottom: isAtBottomRef.current,
				willJumpToBottom: !baselineReset && itemCount > prev && isAtBottomRef.current,
			})
		}
		if (!baselineReset && itemCount > prev && isAtBottomRef.current) {
			jumpToBottom()
		}
	}, [itemCount, growthBaselineKey, isAtBottomRef, jumpToBottom])
}
