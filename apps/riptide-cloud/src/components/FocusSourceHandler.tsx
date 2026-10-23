import { useEffect } from 'react'

import { useFocusStore } from '@/hooks/stores/focusStore'

const MOUSE_MOVE_THRESHOLD = 5

export function createMouseMoveHandler(enableMouseFocus: () => void): (event: MouseEvent) => void {
	let lastPosition: { x: number; y: number } | null = null

	return (event: MouseEvent) => {
		const currentPosition = { x: event.clientX, y: event.clientY }

		if (lastPosition === null) {
			lastPosition = currentPosition
			return
		}

		const dx = Math.abs(currentPosition.x - lastPosition.x)
		const dy = Math.abs(currentPosition.y - lastPosition.y)

		if (dx > MOUSE_MOVE_THRESHOLD || dy > MOUSE_MOVE_THRESHOLD) {
			lastPosition = currentPosition
			enableMouseFocus()
		}
	}
}

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
