import type { Virtualizer } from '@tanstack/react-virtual'
import { type MutableRefObject, useEffect, useState } from 'react'

/**
 * Reports whether the row keyed by `eventId` is currently within the viewport
 * of the virtualizer's scroll container.
 *
 * Source of truth: `virtualizer.getVirtualItems()`. If the target is absent
 * from that list, it is outside the overscan window and therefore outside the
 * viewport. If present, its measured `start`/`end` offsets are compared
 * against the container's `scrollTop`/`scrollTop + clientHeight`.
 *
 * No DOM querying — the hook does not touch `data-event-id` or
 * `data-conversation-container`. This survives row virtualization, where the
 * row's DOM element is unmounted once it scrolls outside the overscan window.
 */
export function useEventInViewport(
	virtualizerRef: MutableRefObject<Virtualizer<HTMLDivElement, Element> | null>,
	parentRef: MutableRefObject<HTMLDivElement | null>,
	eventId: string | null,
): boolean {
	const [inViewport, setInViewport] = useState(false)

	useEffect(() => {
		if (!eventId) {
			setInViewport(false)
			return
		}

		let raf = 0
		let attached: HTMLDivElement | null = null
		let ro: ResizeObserver | null = null
		let run: (() => void) | null = null

		const compute = (el: HTMLDivElement): boolean => {
			const v = virtualizerRef.current
			if (!v) return false
			const target = v.getVirtualItems().find((it) => it.key === eventId)
			if (!target) return false // outside overscan window — not visible
			const top = el.scrollTop
			const bottom = top + el.clientHeight
			// Row overlaps the viewport (1D rectangle intersection)
			return target.start < bottom && target.end > top
		}

		const setup = () => {
			const el = parentRef.current
			if (!el) {
				// Parent ref not yet populated by React on first render; retry next frame.
				raf = requestAnimationFrame(setup)
				return
			}
			attached = el
			run = () => {
				cancelAnimationFrame(raf)
				raf = requestAnimationFrame(() => setInViewport(compute(el)))
			}
			run()
			el.addEventListener('scroll', run, { passive: true })
			ro = new ResizeObserver(run)
			ro.observe(el)
		}

		setup()

		return () => {
			cancelAnimationFrame(raf)
			if (attached && run) attached.removeEventListener('scroll', run)
			ro?.disconnect()
		}
	}, [eventId, virtualizerRef, parentRef])

	return inViewport
}
