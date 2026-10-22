import { type MutableRefObject, useRef } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'

/**
 * Tracks whether the user is within `threshold` pixels of the bottom of a scrollable container.
 *
 * Returns a MutableRefObject so consumers can read the latest value without forcing re-renders;
 * the value is updated on every scroll event via a passive listener.
 *
 * Used to gate sticky-bottom (follow-tail) auto-scroll: when the user is at the bottom and a new
 * event arrives, the viewport is pinned to the tail; when scrolled up, new events do not pull
 * the viewport.
 */
export function useIsAtBottom(
	parentRef: MutableRefObject<HTMLElement | null>,
	threshold = 60,
): { isAtBottomRef: MutableRefObject<boolean> } {
	const isAtBottomRef = useRef(true)

	useMountEffect(() => {
		const el = parentRef.current
		if (!el) return

		const update = () => {
			isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
		}

		const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
		resizeObserver?.observe(el)
		el.addEventListener('scroll', update, { passive: true })
		return () => {
			resizeObserver?.disconnect()
			el.removeEventListener('scroll', update)
		}
	})

	return { isAtBottomRef }
}
