import { useState, useCallback, useRef } from 'react'

/**
 * Hook to protect keyboard navigation from being overridden by mouse events
 * that occur due to scrolling content under a stationary cursor.
 * 
 * When keyboard navigation occurs, mouse events are suppressed for a short period
 * to prevent them from overriding the keyboard-set focus.
 */
export function useKeyboardNavigationProtection(delay: number = 300) {
  const [isKeyboardNavigating, setIsKeyboardNavigating] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startKeyboardNavigation = useCallback(() => {
    console.log('[KeyboardNavProtection] Starting keyboard navigation mode')
    setIsKeyboardNavigating(true)
    
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    // Set a timeout to re-enable mouse events after the delay
    timeoutRef.current = setTimeout(() => {
      console.log('[KeyboardNavProtection] Ending keyboard navigation mode')
      setIsKeyboardNavigating(false)
    }, delay)
  }, [delay])

  const shouldIgnoreMouseEvent = useCallback((): boolean => {
    if (isKeyboardNavigating) {
      console.log('[KeyboardNavProtection] Ignoring mouse event during keyboard navigation')
      return true
    }
    return false
  }, [isKeyboardNavigating])

  return {
    isKeyboardNavigating,
    startKeyboardNavigation,
    shouldIgnoreMouseEvent,
  }
}