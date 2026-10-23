const MOUSE_MOVE_THRESHOLD = 5

/**
 * Creates a stateful mousemove handler that seeds the first cursor position and
 * only calls enableMouseFocus after the pointer moves more than MOUSE_MOVE_THRESHOLD pixels.
 * Exported for unit testing.
 */
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
