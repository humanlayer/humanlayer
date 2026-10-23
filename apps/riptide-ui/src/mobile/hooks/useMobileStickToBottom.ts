import { useCallback, useRef } from 'react'

const AT_BOTTOM_THRESHOLD_PX = 80

/**
 * Lightweight stick-to-bottom for the mobile message list.
 *
 * Mirrors the semantics of desktop's `useIsAtBottom` + `useAutoScrollOnNewEvents`
 * / `useStickToBottomOnStreamingResize` (see `components/conversation-stream/`),
 * but self-contained and DOM-only so it can live in the mobile Pure tree.
 *
 * Usage: attach `scrollRef` to the scroll container and `contentRef` to the
 * element whose height grows as messages/stream rows arrive.
 *
 *   <div ref={scrollRef} className="overflow-y-auto">
 *     <div ref={contentRef}>{rows}</div>
 *   </div>
 *
 * Behaviour:
 *   - On mount (first content measurement) the list is pinned to the bottom.
 *   - While new content arrives, if the user is at/near the bottom the viewport
 *     follows the tail; if they scrolled up, the viewport is left alone.
 *
 * Implemented with callback refs (no `useEffect`): the scroll listener is bound
 * in `scrollRef`, the `ResizeObserver` in `contentRef`, and both are torn down
 * when React calls the callback ref with `null` on unmount.
 */
export function useMobileStickToBottom(): {
	scrollRef: (el: HTMLElement | null) => void
	contentRef: (el: HTMLElement | null) => void
} {
	const scrollElRef = useRef<HTMLElement | null>(null)
	const isAtBottomRef = useRef(true)
	const rafRef = useRef<number | null>(null)
	const observerRef = useRef<ResizeObserver | null>(null)

	const scrollToBottom = useCallback(() => {
		const el = scrollElRef.current
		if (!el) return
		el.scrollTop = el.scrollHeight
		isAtBottomRef.current = true
	}, [])

	const handleScroll = useCallback(() => {
		const el = scrollElRef.current
		if (!el) return
		isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD_PX
	}, [])

	const scrollRef = useCallback(
		(el: HTMLElement | null) => {
			const prev = scrollElRef.current
			if (prev) prev.removeEventListener('scroll', handleScroll)
			scrollElRef.current = el
			if (el) el.addEventListener('scroll', handleScroll, { passive: true })
		},
		[handleScroll],
	)

	const contentRef = useCallback(
		(el: HTMLElement | null) => {
			if (observerRef.current) {
				observerRef.current.disconnect()
				observerRef.current = null
			}
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current)
				rafRef.current = null
			}
			if (!el || typeof ResizeObserver === 'undefined') return

			// The observer fires once on `observe()`, which pins to the bottom on
			// first layout, then again on every content-size change (new rows /
			// streaming text growing the list).
			const observer = new ResizeObserver(() => {
				if (!isAtBottomRef.current || rafRef.current !== null) return
				rafRef.current = requestAnimationFrame(() => {
					rafRef.current = null
					scrollToBottom()
				})
			})
			observer.observe(el)
			observerRef.current = observer
		},
		[scrollToBottom],
	)

	return { scrollRef, contentRef }
}
