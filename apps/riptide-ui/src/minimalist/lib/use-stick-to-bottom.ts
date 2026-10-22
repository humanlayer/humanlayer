import { useLayoutEffect, useRef, useState } from 'react'

/** How close to the bottom still counts as reading the latest. */
const NEAR = 80

/** How long after a click or key press growth counts as the reader's doing. */
const SETTLE_MS = 500

/**
 * Keep a scroll container pinned to its bottom as content arrives, unless the reader
 * has scrolled up to look at something. The first render always lands at the bottom.
 * `ref` goes on the container; `away` is true while they're scrolled up; `jump`
 * takes them back down and pins again.
 *
 * Only scrolling up unpins. Reflows move the scroll position too (the side panel opens,
 * the window narrows), and a smooth jump passes far from the bottom on its way down;
 * neither is the reader leaving.
 */
export function useStickToBottom(contentKey: unknown) {
	const [element, setElement] = useState<HTMLElement | null>(null)
	const pinned = useRef(true)
	const [away, setAway] = useState(false)
	useLayoutEffect(() => {
		if (!element) return
		let lastTop = element.scrollTop
		const onScroll = () => {
			const near = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR
			if (near) pinned.current = true
			else if (element.scrollTop < lastTop) pinned.current = false
			lastTop = element.scrollTop
			setAway(!pinned.current)
		}
		// Growth right after a click or key press is the reader opening something; follow
		// it and the thing they opened scrolls away from under them.
		let touched = 0
		const onTouch = () => {
			touched = performance.now()
		}
		element.addEventListener('scroll', onScroll, { passive: true })
		element.addEventListener('pointerdown', onTouch, { passive: true })
		element.addEventListener('keydown', onTouch)
		// A narrower view, or content that fills in late (a card that loads after the
		// thread), pushes the bottom out of sight without a new message.
		const resized = new ResizeObserver(() => {
			if (pinned.current && performance.now() - touched > SETTLE_MS) element.scrollTop = element.scrollHeight
		})
		resized.observe(element)
		for (const child of element.children) resized.observe(child)
		return () => {
			element.removeEventListener('scroll', onScroll)
			element.removeEventListener('pointerdown', onTouch)
			element.removeEventListener('keydown', onTouch)
			resized.disconnect()
		}
	}, [element])
	useLayoutEffect(() => {
		if (element && pinned.current) element.scrollTop = element.scrollHeight
	}, [element, contentKey])
	const jump = () => {
		if (!element) return
		pinned.current = true
		setAway(false)
		const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
		element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
	}
	return { ref: setElement, away, jump }
}
