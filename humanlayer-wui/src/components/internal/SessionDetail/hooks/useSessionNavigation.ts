import { useState, useCallback, useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ConversationEvent, ConversationEventType } from '@/lib/daemon/types'

interface NavigableItem {
  id: number
  type: 'event' | 'taskgroup' | 'subevent'
}

interface UseSessionNavigationProps {
  events: ConversationEvent[]
  hasSubTasks: boolean
  expandedTasks: Set<string>
  toggleTaskGroup: (taskId: string) => void
  expandedToolResult?: ConversationEvent | null
  setExpandedToolResult?: (event: ConversationEvent | null) => void
  setExpandedToolCall?: (event: ConversationEvent | null) => void
  disabled?: boolean
  startKeyboardNavigation?: () => void
}

export function useSessionNavigation({
  events,
  hasSubTasks,
  expandedTasks,
  toggleTaskGroup,
  expandedToolResult,
  setExpandedToolResult,
  setExpandedToolCall,
  disabled = false,
  startKeyboardNavigation,
}: UseSessionNavigationProps) {
  const [focusedEventId, setFocusedEventId] = useState<number | null>(null)
  const [focusSource, setFocusSource] = useState<'mouse' | 'keyboard' | null>(null)

  // Helper to check if element is in viewport
  const isElementInView = useCallback((element: Element, container: Element) => {
    const elementRect = element.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    return elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom
  }, [])

  // Build navigable items list based on current state
  const buildNavigableItems = useCallback((): NavigableItem[] => {
    const items: NavigableItem[] = []

    if (!hasSubTasks) {
      // Simple case: just regular events
      events
        .filter(event => event.eventType !== ConversationEventType.ToolResult && event.id !== undefined)
        .forEach(event => items.push({ id: event.id!, type: 'event' }))
    } else {
      // Complex case: handle task groups
      const rootEvents = events.filter(e => !e.parentToolUseId)
      const subEventsByParent = new Map<string, ConversationEvent[]>()

      events.forEach(event => {
        if (event.parentToolUseId) {
          const siblings = subEventsByParent.get(event.parentToolUseId) || []
          siblings.push(event)
          subEventsByParent.set(event.parentToolUseId, siblings)
        }
      })

      rootEvents
        .filter(event => event.eventType !== ConversationEventType.ToolResult && event.id !== undefined)
        .forEach(event => {
          // Check if this is a task group
          const isTaskGroup =
            event.toolName === 'Task' && event.toolId && subEventsByParent.has(event.toolId)

          if (isTaskGroup) {
            items.push({ id: event.id!, type: 'taskgroup' })

            // If expanded, add sub-events
            if (expandedTasks.has(event.toolId!)) {
              const subEvents = subEventsByParent.get(event.toolId!) || []
              subEvents
                .filter(e => e.eventType !== ConversationEventType.ToolResult && e.id !== undefined)
                .forEach(subEvent => {
                  items.push({ id: subEvent.id!, type: 'subevent' })
                })
            }
          } else {
            items.push({ id: event.id!, type: 'event' })
          }
        })
    }

    return items
  }, [events, hasSubTasks, expandedTasks])

  const navigableItems = buildNavigableItems()

  // Navigation functions
  const focusNextEvent = useCallback(() => {
    if (navigableItems.length === 0) return

    const currentIndex = focusedEventId
      ? navigableItems.findIndex(item => item.id === focusedEventId)
      : -1

    if (currentIndex === -1) {
      // When no event is focused, j should do nothing (stay at bottom)
      // User must press k first to start navigating from bottom
      return
    } else if (currentIndex < navigableItems.length - 1) {
      startKeyboardNavigation?.()
      setFocusedEventId(navigableItems[currentIndex + 1].id)
      setFocusSource('keyboard')
    }
  }, [focusedEventId, navigableItems, startKeyboardNavigation])

  const focusPreviousEvent = useCallback(() => {
    if (navigableItems.length === 0) return

    const currentIndex = focusedEventId
      ? navigableItems.findIndex(item => item.id === focusedEventId)
      : -1

    if (currentIndex === -1) {
      // Start from the bottom when first pressing k
      startKeyboardNavigation?.()
      setFocusedEventId(navigableItems[navigableItems.length - 1].id)
      setFocusSource('keyboard')
    } else if (currentIndex > 0) {
      startKeyboardNavigation?.()
      setFocusedEventId(navigableItems[currentIndex - 1].id)
      setFocusSource('keyboard')
    }
  }, [focusedEventId, navigableItems, startKeyboardNavigation])

  // Keyboard navigation
  useHotkeys('j, ArrowDown', focusNextEvent, { enabled: !expandedToolResult && !disabled })
  useHotkeys('k, ArrowUp', focusPreviousEvent, { enabled: !expandedToolResult && !disabled })

  // I key to expand task groups or inspect tool results
  useHotkeys(
    'i',
    () => {
      if (!focusedEventId) return

      startKeyboardNavigation?.()

      const focusedEvent = events.find(e => e.id === focusedEventId)
      if (!focusedEvent || focusedEvent.eventType !== ConversationEventType.ToolCall) return

      // Handle task group expansion for Task events with sub-events
      if (focusedEvent.toolName === 'Task' && focusedEvent.toolId && hasSubTasks) {
        const subEventsByParent = new Map<string, ConversationEvent[]>()
        events.forEach(event => {
          if (event.parentToolUseId) {
            const siblings = subEventsByParent.get(event.parentToolUseId) || []
            siblings.push(event)
            subEventsByParent.set(event.parentToolUseId, siblings)
          }
        })

        const hasSubEvents = subEventsByParent.has(focusedEvent.toolId)
        if (hasSubEvents) {
          toggleTaskGroup(focusedEvent.toolId)
          return
        }
      }

      // Handle tool result inspection (existing behavior)
      if (setExpandedToolResult && setExpandedToolCall) {
        const toolResult = focusedEvent.toolId
          ? events.find(
              e =>
                e.eventType === ConversationEventType.ToolResult &&
                e.toolResultForId === focusedEvent.toolId,
            )
          : null

        setExpandedToolResult(toolResult || null)
        setExpandedToolCall(focusedEvent)
      }
    },
    { enabled: !expandedToolResult && !disabled },
  )

  // Scroll focused element into view (only for keyboard navigation)
  useEffect(() => {
    if (focusedEventId && focusSource === 'keyboard') {
      const container = document.querySelector('[data-conversation-container]')
      const focusedElement = container?.querySelector(`[data-event-id="${focusedEventId}"]`)

      if (container && focusedElement && !isElementInView(focusedElement, container)) {
        focusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [focusedEventId, focusSource, isElementInView])

  return {
    focusedEventId,
    setFocusedEventId,
    focusSource,
    setFocusSource,
    navigableItems,
  }
}
