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

  // Reset state when component mounts (handles re-entering sessions)
  useEffect(() => {
    console.log('[useAutoScroll] Component mounted - resetting state')
    wasAtBottomRef.current = null
    // Don't reset autoScrollEnabled here - let initialization handle it
  }, []) // Only on mount

  // Initialize wasAtBottomRef when container has content
  useEffect(() => {
    if (!containerRef.current) {
      console.log('[useAutoScroll] Init effect - no container')
      return
    }

    // Only initialize once when we have actual content to scroll
    if (wasAtBottomRef.current === null && containerRef.current.scrollHeight > 0) {
      // Check if this is a new session (very little content) vs existing session
      const hasMinimalContent =
        containerRef.current.scrollHeight <= containerRef.current.clientHeight * 1.5
      const initiallyAtBottom = isAtBottom()

      // For new sessions with minimal content, default to true
      // For existing sessions, check actual position
      const shouldAutoScroll = hasMinimalContent ? true : initiallyAtBottom

      wasAtBottomRef.current = shouldAutoScroll
      console.log('[useAutoScroll] INITIALIZED', {
        hasMinimalContent,
        initiallyAtBottom,
        shouldAutoScroll,
        scrollHeight: containerRef.current.scrollHeight,
        scrollTop: containerRef.current.scrollTop,
        clientHeight: containerRef.current.clientHeight,
        distanceFromBottom:
          containerRef.current.scrollHeight -
          containerRef.current.scrollTop -
          containerRef.current.clientHeight,
        threshold: containerRef.current.clientHeight * SCROLL_THRESHOLD,
      })
      // Set initial auto-scroll state based on position
      setAutoScrollEnabled(shouldAutoScroll)
    } else if (wasAtBottomRef.current !== null) {
      // console.log('[useAutoScroll] Already initialized, wasAtBottomRef:', wasAtBottomRef.current)
    }
  }) // This runs on every render to catch when content becomes available

  // Handle scroll events to detect user scrolling
  useEffect(() => {
    console.log(
      '[useAutoScroll] Scroll handler effect running, containerRef.current:',
      containerRef.current,
    )

    // Use a timer to retry if container isn't ready yet
    const setupScrollHandler = () => {
      const container = containerRef.current
      if (!container) {
        console.log('[useAutoScroll] Container not ready, will retry in 100ms')
        const retryTimer = setTimeout(setupScrollHandler, 100)
        return () => clearTimeout(retryTimer)
      }

      console.log('[useAutoScroll] Attaching scroll handler to container')

      const handleScroll = () => {
        // Calculate if at bottom directly in the handler to avoid dependency issues
        const scrollHeight = container.scrollHeight
        const scrollTop = container.scrollTop
        const clientHeight = container.clientHeight
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight
        const threshold = clientHeight * (SCROLL_THRESHOLD / 100)
        const atBottom = distanceFromBottom <= threshold

        console.log('[useAutoScroll] Scroll event', {
          atBottom,
          wasAtBottomRef: wasAtBottomRef.current,
          scrollTop,
          scrollHeight,
          clientHeight,
          distanceFromBottom,
          threshold,
        })

        if (atBottom) {
          // User is at bottom - enable auto-scroll
          wasAtBottomRef.current = true
          setAutoScrollEnabled(true)
          console.log('[useAutoScroll] Enabled auto-scroll (at bottom)')
        } else {
          // User scrolled up - disable auto-scroll
          wasAtBottomRef.current = false
          setAutoScrollEnabled(false)
          console.log('[useAutoScroll] Disabled auto-scroll (scrolled up)')
        }
      }

      container.addEventListener('scroll', handleScroll, { passive: true })
      console.log('[useAutoScroll] Scroll handler attached to container:', container)

      return () => {
        console.log('[useAutoScroll] Removing scroll handler')
        container.removeEventListener('scroll', handleScroll)
      }
    }

    const cleanup = setupScrollHandler()
    return cleanup
  }, [setAutoScrollEnabled]) // Only depend on stable setAutoScrollEnabled function

  // Auto-scroll when conditions are met
  useEffect(() => {
    console.log('[useAutoScroll] Auto-scroll effect triggered', {
      autoScrollEnabled,
      hasNewContent,
      contentChanged,
      wasAtBottomRef: wasAtBottomRef.current,
      willAutoScroll:
        autoScrollEnabled && (hasNewContent || contentChanged) && wasAtBottomRef.current === true,
    })

    // Only auto-scroll if enabled AND we were at the bottom before new content
    // Check wasAtBottomRef === true to avoid auto-scrolling when null (initial state)
    if (autoScrollEnabled && (hasNewContent || contentChanged) && wasAtBottomRef.current === true) {
      console.log('[useAutoScroll] Scheduling auto-scroll in 50ms')
      // Use setTimeout to ensure DOM updates are complete
      setTimeout(() => {
        console.log('[useAutoScroll] Executing auto-scroll')
        scrollToBottom()
        // Only update ref if we're actually at bottom after scrolling
        // This prevents overriding user's scroll-up action during the delay
        const nowAtBottom = isAtBottom()
        console.log('[useAutoScroll] After auto-scroll - at bottom?', nowAtBottom)
        if (nowAtBottom) {
          wasAtBottomRef.current = true
          console.log('[useAutoScroll] Kept wasAtBottomRef as true')
        } else {
          console.log(
            '[useAutoScroll] User must have scrolled during delay - not updating wasAtBottomRef',
          )
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
