import { useEffect, useRef, useCallback, RefObject } from 'react'
import { useStore } from '@/AppStore'

const SCROLL_THRESHOLD = 0.1 // 10% of visible container height (viewport), not total content

export function useAutoScroll(
  containerRef: RefObject<HTMLDivElement>,
  hasNewContent: boolean,
  contentChanged: boolean,
) {
  const autoScrollEnabled = useStore(state => state.autoScrollEnabled)
  const setAutoScrollEnabled = useStore(state => state.setAutoScrollEnabled)
  const wasAtBottomRef = useRef<boolean>(true) // Track if we were at bottom before content change

  // Check if container is scrolled to bottom (within threshold)
  const isAtBottom = useCallback(() => {
    if (!containerRef.current) return false
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    // Threshold is relative to viewport: if viewport is 800px, threshold is 80px
    const threshold = clientHeight * SCROLL_THRESHOLD
    return scrollHeight - scrollTop - clientHeight < threshold
  }, [containerRef])

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (!containerRef.current) return
    containerRef.current.scrollTop = containerRef.current.scrollHeight
  }, [containerRef])

  // Handle scroll events to detect user scrolling
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const atBottom = isAtBottom()

      if (atBottom) {
        // User is at bottom - enable auto-scroll
        wasAtBottomRef.current = true
        setAutoScrollEnabled(true)
      } else {
        // User scrolled up - disable auto-scroll
        wasAtBottomRef.current = false
        setAutoScrollEnabled(false)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [containerRef, isAtBottom, setAutoScrollEnabled])

  // Auto-scroll when conditions are met
  useEffect(() => {
    // Only auto-scroll if enabled AND we were at the bottom before new content
    if (autoScrollEnabled && (hasNewContent || contentChanged) && wasAtBottomRef.current) {
      // Use setTimeout to ensure DOM updates are complete
      setTimeout(() => {
        scrollToBottom()
        // After scrolling, we're at bottom again
        wasAtBottomRef.current = true
      }, 50)
    }
  }, [autoScrollEnabled, hasNewContent, contentChanged, scrollToBottom])

  return {
    autoScrollEnabled,
    scrollToBottom,
    isAtBottom,
  }
}
