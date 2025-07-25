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
        .filter(
          event => event.event_type !== ConversationEventType.ToolResult && event.id !== undefined,
        )
        .forEach(event => items.push({ id: event.id!, type: 'event' }))
    } else {
      // Complex case: handle task groups
      const rootEvents = events.filter(e => !e.parent_tool_use_id)
      const subEventsByParent = new Map<string, ConversationEvent[]>()

      events.forEach(event => {
        if (event.parent_tool_use_id) {
          const siblings = subEventsByParent.get(event.parent_tool_use_id) || []
          siblings.push(event)
          subEventsByParent.set(event.parent_tool_use_id, siblings)
        }
      })

      rootEvents
        .filter(
          event => event.event_type !== ConversationEventType.ToolResult && event.id !== undefined,
        )
        .forEach(event => {
          // Check if this is a task group
          const isTaskGroup =
            event.tool_name === 'Task' && event.tool_id && subEventsByParent.has(event.tool_id)

          if (isTaskGroup) {
            items.push({ id: event.id!, type: 'taskgroup' })

            // If expanded, add sub-events
            if (expandedTasks.has(event.tool_id!)) {
              const subEvents = subEventsByParent.get(event.tool_id!) || []
              subEvents
                .filter(e => e.event_type !== ConversationEventType.ToolResult && e.id !== undefined)
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
      if (!focusedEvent || focusedEvent.event_type !== ConversationEventType.ToolCall) return

      // Handle task group expansion for Task events with sub-events
      if (focusedEvent.tool_name === 'Task' && focusedEvent.tool_id && hasSubTasks) {
        const subEventsByParent = new Map<string, ConversationEvent[]>()
        events.forEach(event => {
          if (event.parent_tool_use_id) {
            const siblings = subEventsByParent.get(event.parent_tool_use_id) || []
            siblings.push(event)
            subEventsByParent.set(event.parent_tool_use_id, siblings)
          }
        })

        const hasSubEvents = subEventsByParent.has(focusedEvent.tool_id)
        if (hasSubEvents) {
          toggleTaskGroup(focusedEvent.tool_id)
          return
        }
      }

      // Handle tool result inspection (existing behavior)
      if (setExpandedToolResult && setExpandedToolCall) {
        const toolResult = focusedEvent.tool_id
          ? events.find(
              e =>
                e.event_type === ConversationEventType.ToolResult &&
                e.tool_result_for_id === focusedEvent.tool_id,
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
