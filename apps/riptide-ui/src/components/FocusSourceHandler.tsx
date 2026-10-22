import { useEffect } from 'react'

import { useFocusStore } from '@/hooks/stores/focusStore'
import { createMouseMoveHandler } from '@/lib/mouse-move-handler'

export function FocusSourceHandler() {
	const focusSource = useFocusStore((state) => state.focusSource)
	const enableMouseFocus = useFocusStore((state) => state.enableMouseFocus)

	useEffect(() => {
		if (focusSource === 'mouse') return

		const handleMouseMove = createMouseMoveHandler(enableMouseFocus)

		document.addEventListener('mousemove', handleMouseMove, { passive: true })

		return () => {
			document.removeEventListener('mousemove', handleMouseMove)
		}
	}, [focusSource, enableMouseFocus])

	return null
}
