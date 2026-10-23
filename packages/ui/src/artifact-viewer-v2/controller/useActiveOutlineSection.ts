import type { Editor } from '@tiptap/react'
import { useCallback, useRef, type RefObject } from 'react'
import { create } from 'zustand'

import { flattenOutline, type OutlineItem } from '../toc/build-outline'
import { selectActiveOutlineSection, type ObservedHeadingPosition } from '../toc/active-outline-section'

export const ACTIVATION_LINE_PX = 80

const BOTTOM_EPSILON_PX = 2
const SCROLL_SETTLE_MS = 200

function bindOutlineScroll(
	element: HTMLElement,
	handleScroll: () => void,
	scheduleMeasure: () => void,
): () => void {
	let observer: ResizeObserver | null = null
	element.addEventListener('scroll', handleScroll, { passive: true })
	if (typeof ResizeObserver !== 'undefined') {
		observer = new ResizeObserver(scheduleMeasure)
		observer.observe(element)
	}
	return () => {
		element.removeEventListener('scroll', handleScroll)
		observer?.disconnect()
	}
}

interface ActiveOutlineSection {
	setActiveHeadingId: (id: string | null) => void
	documentScrollRef: (el: HTMLElement | null) => void
	scrollElRef: RefObject<HTMLElement | null>
	suppressScrollTracking: () => void
}

export interface ActiveOutlineState {
	activeHeadingId: string | null
}

/** Module-level active-heading state; outline rows subscribe to it directly. */
export const useActiveOutlineStore = create<ActiveOutlineState>(() => ({ activeHeadingId: null }))

/**
 * Keep the active outline row synchronized with the artifact document's own
 * scroll container. This lives beside the controller because both the editor
 * and the resulting document ref now share the controller lifecycle.
 */
export function useActiveOutlineSection({
	editor,
	outlineItems,
}: {
	editor: Editor | null
	outlineItems: OutlineItem[]
}): ActiveOutlineSection {
	const scrollElRef = useRef<HTMLElement | null>(null)
	const cleanupScrollRef = useRef<(() => void) | null>(null)
	const rafRef = useRef<number | null>(null)
	const suppressedRef = useRef(false)
	const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const armSettleTimer = useCallback(() => {
		if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
		settleTimerRef.current = setTimeout(() => {
			settleTimerRef.current = null
			suppressedRef.current = false
		}, SCROLL_SETTLE_MS)
	}, [])

	const suppressScrollTracking = useCallback(() => {
		suppressedRef.current = true
		armSettleTimer()
	}, [armSettleTimer])

	const measure = useCallback(() => {
		const el = scrollElRef.current
		const view = editor?.view
		if (!el || !view) return

		const orderedItems = flattenOutline(outlineItems)
		if (orderedItems.length === 0) return

		const containerTop = el.getBoundingClientRect().top
		const headings: ObservedHeadingPosition[] = []
		for (const item of orderedItems) {
			const dom = view.nodeDOM(item.pos)
			if (dom instanceof HTMLElement) {
				headings.push({ id: item.id, top: dom.getBoundingClientRect().top - containerTop })
			}
		}

		const atBottom =
			el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_EPSILON_PX
		const next = selectActiveOutlineSection({ headings, activationLine: ACTIVATION_LINE_PX, atBottom })
		if (useActiveOutlineStore.getState().activeHeadingId !== next) useActiveOutlineStore.setState({ activeHeadingId: next })
	}, [editor, outlineItems])

	const setActiveHeadingId = useCallback((id: string | null) => {
		if (useActiveOutlineStore.getState().activeHeadingId !== id) useActiveOutlineStore.setState({ activeHeadingId: id })
	}, [])

	const scheduleMeasure = useCallback(() => {
		if (rafRef.current !== null) return
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null
			measure()
		})
	}, [measure])

	const handleScroll = useCallback(() => {
		if (suppressedRef.current) {
			armSettleTimer()
			return
		}
		scheduleMeasure()
	}, [armSettleTimer, scheduleMeasure])

	const documentScrollRef = useCallback(
		(el: HTMLElement | null) => {
			cleanupScrollRef.current?.()
			cleanupScrollRef.current = null
			scrollElRef.current = el
			if (!el) return

			const unbindScroll = bindOutlineScroll(el, handleScroll, scheduleMeasure)
			cleanupScrollRef.current = () => {
				unbindScroll()
				if (rafRef.current !== null) {
					cancelAnimationFrame(rafRef.current)
					rafRef.current = null
				}
				if (settleTimerRef.current) {
					clearTimeout(settleTimerRef.current)
					settleTimerRef.current = null
					suppressedRef.current = false
				}
			}
		},
		[handleScroll, scheduleMeasure],
	)

	return {
		setActiveHeadingId,
		documentScrollRef,
		scrollElRef,
		suppressScrollTracking,
	}
}
