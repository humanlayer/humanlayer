import { type RefObject, useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'

/**
 * Observe the element pointed to by `ref` and report whether its content-box
 * width is below `thresholdPx`. Batches measurements on `requestAnimationFrame`
 * so rapid resize events (e.g. panel drags) don't thrash React state.
 */
export function useIsNarrow(ref: RefObject<HTMLElement | null>, thresholdPx: number): boolean {
	const [isNarrow, setIsNarrow] = useState(false)

	useMountEffect(() => {
		const el = ref.current
		if (!el) return

		let rafId: number | null = null
		let lastWidth = el.getBoundingClientRect().width
		setIsNarrow(lastWidth < thresholdPx)

		const observer = new ResizeObserver((entries) => {
			if (rafId !== null) return
			rafId = requestAnimationFrame(() => {
				rafId = null
				const entry = entries[entries.length - 1]
				if (!entry) return
				const width = entry.contentRect.width
				if (width === lastWidth) return
				lastWidth = width
				setIsNarrow(width < thresholdPx)
			})
		})

		observer.observe(el)

		return () => {
			if (rafId !== null) cancelAnimationFrame(rafId)
			observer.disconnect()
		}
	})

	return isNarrow
}
