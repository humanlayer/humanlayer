import { useCallback, useRef } from 'react'

/**
 * Hook to protect keyboard navigation from being overridden by mouse events
 * that occur due to scrolling content under a stationary cursor.
 *
 * When keyboard navigation occurs, mouse events are suppressed for a short period
 * to prevent them from overriding the keyboard-set focus.
 *
 * Held in a ref, not state: callers only read it inside event handlers via
 * shouldIgnoreMouseEvent, and startKeyboardNavigation fires on every j/k — as
 * state it would re-render the session detail provider (and everything under
 * it) twice per keypress.
 */
export function useKeyboardNavigationProtection(delay: number = 300) {
	const isKeyboardNavigatingRef = useRef(false)
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const startKeyboardNavigation = useCallback(() => {
		isKeyboardNavigatingRef.current = true

		// Clear any existing timeout
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
		}

		// Re-enable mouse events after the delay
		timeoutRef.current = setTimeout(() => {
			isKeyboardNavigatingRef.current = false
		}, delay)
	}, [delay])

	const shouldIgnoreMouseEvent = useCallback((): boolean => isKeyboardNavigatingRef.current, [])

	return {
		startKeyboardNavigation,
		shouldIgnoreMouseEvent,
	}
}
