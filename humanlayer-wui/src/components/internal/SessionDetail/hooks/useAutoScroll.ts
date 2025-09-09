import { useEffect, useRef, useCallback, RefObject } from 'react'
import { useStore } from '@/AppStore'

const SCROLL_THRESHOLD = 0.025 // 2.5% of visible container height (viewport), not total content

export function useAutoScroll(
  containerRef: RefObject<HTMLDivElement>,
  hasNewContent: boolean,
  contentChanged: boolean,
) {
  const autoScrollEnabled = useStore(state => state.autoScrollEnabled)
  const setAutoScrollEnabled = useStore(state => state.setAutoScrollEnabled)
  const wasAtBottomRef = useRef<boolean | null>(null) // Track if we were at bottom before content change - null = not yet determined

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

  // Initialize wasAtBottomRef when container has content
  useEffect(() => {
    if (!containerRef.current) return

    // Only initialize once when we have actual content to scroll
    if (wasAtBottomRef.current === null && containerRef.current.scrollHeight > 0) {
      const initiallyAtBottom = isAtBottom()
      wasAtBottomRef.current = initiallyAtBottom
      // Set initial auto-scroll state based on position
      setAutoScrollEnabled(initiallyAtBottom)
    }
  })

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
  }, [containerRef]) // Only depend on containerRef to ensure stable listener

  // Auto-scroll when conditions are met
  useEffect(() => {
    // Only auto-scroll if enabled AND we were at the bottom before new content
    // Check wasAtBottomRef === true to avoid auto-scrolling when null (initial state)
    if (autoScrollEnabled && (hasNewContent || contentChanged) && wasAtBottomRef.current === true) {
      // Use setTimeout to ensure DOM updates are complete
      setTimeout(() => {
        scrollToBottom()
        // Only update ref if we're actually at bottom after scrolling
        // This prevents overriding user's scroll-up action during the delay
        const nowAtBottom = isAtBottom()
        if (nowAtBottom) {
          wasAtBottomRef.current = true
        }
      }, 50)
    }
  }, [autoScrollEnabled, hasNewContent, contentChanged, scrollToBottom, isAtBottom])

  return {
    autoScrollEnabled,
    scrollToBottom,
    isAtBottom,
  }
}
