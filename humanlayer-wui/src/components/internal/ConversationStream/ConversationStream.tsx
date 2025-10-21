import { useEffect, useRef, useState } from 'react'
import keyBy from 'lodash.keyby'

import { ConversationEvent, ConversationEventType, Session } from '@/lib/daemon/types'
import { useConversation } from '@/hooks/useConversation'
import { useSessionSnapshots } from '@/hooks/useSessionSnapshots'
import { Skeleton } from '@/components/ui/skeleton'
import { useTaskGrouping } from '../SessionDetail/hooks/useTaskGrouping'
import { useStore } from '@/AppStore'
import { useAutoScroll } from '../SessionDetail/hooks/useAutoScroll'
import { useSearchMatching } from '../SessionDetail/hooks/useSearchMatching'
import { ConversationEventRow } from './ConversationEventRow'
import { TaskGroupEventRow } from './TaskGroupEventRow'

// TODO(2): Extract keyboard navigation logic to a custom hook
// TODO(3): Add virtual scrolling for very long conversations

export function ConversationStream({
  session,
  focusedEventId,
  setFocusedEventId,
  onApprove,
  onDeny,
  approvingApprovalId,
  denyingApprovalId,
  setDenyingApprovalId,
  onCancelDeny,
  focusSource,
  setFocusSource,
  expandedToolResult,
  setExpandedToolResult,
  setExpandedToolCall,
  maxEventIndex,
  shouldIgnoreMouseEvent,
  expandedTasks,
  toggleTaskGroup,
}: {
  session: Session
  focusedEventId: number | null
  setFocusedEventId: (id: number | null) => void
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string, reason: string) => void
  approvingApprovalId?: string | null
  confirmingApprovalId?: string | null
  denyingApprovalId?: string | null
  setDenyingApprovalId?: (id: string | null) => void
  onCancelDeny?: () => void
  focusSource?: 'mouse' | 'keyboard' | null
  setFocusSource?: (source: 'mouse' | 'keyboard' | null) => void
  expandedToolResult?: ConversationEvent | null
  setExpandedToolResult?: (event: ConversationEvent | null) => void
  setExpandedToolCall?: (event: ConversationEvent | null) => void
  maxEventIndex?: number
  shouldIgnoreMouseEvent?: () => boolean
  expandedTasks?: Set<string>
  toggleTaskGroup?: (taskId: string) => void
}) {
  // expandedToolResult is used by parent to control hotkey availability
  void expandedToolResult
  const sessionId = session.id
  const { events, loading, error, isInitialLoad } = useConversation(sessionId, undefined, 1000)
  const { refetch } = useSessionSnapshots(sessionId)
  const responseEditor = useStore(state => state.responseEditor)
  const [showSkeleton, setShowSkeleton] = useState(false)

  // Add search matching
  useSearchMatching()

  // Filter events based on maxEventIndex (exclude the event at maxEventIndex)
  const filteredEvents = maxEventIndex !== undefined ? events.slice(0, maxEventIndex) : events

  const toolResults = filteredEvents.filter(
    event => event.eventType === ConversationEventType.ToolResult,
  )
  const toolResultsByKey = keyBy(toolResults, 'toolResultForId')

  // Use task grouping hook - use props if provided, otherwise use local hook
  const localTaskGrouping = useTaskGrouping(filteredEvents)
  const { taskGroups, rootEvents, hasSubTasks } = localTaskGrouping
  const actualExpandedTasks = expandedTasks ?? localTaskGrouping.expandedTasks
  const actualToggleTaskGroup = toggleTaskGroup ?? localTaskGrouping.toggleTaskGroup

  // Add delay before showing skeleton to prevent flashing
  useEffect(() => {
    if (loading && isInitialLoad) {
      const timer = setTimeout(() => {
        setShowSkeleton(true)
      }, 200) // 200ms delay before showing skeleton
      return () => clearTimeout(timer)
    } else {
      setShowSkeleton(false)
    }
  }, [loading, isInitialLoad])

  // Watch for new Read tool results and refetch snapshots
  useEffect(() => {
    const hasReadToolResults = filteredEvents.some(
      event => event.eventType === ConversationEventType.ToolResult && event.toolName === 'Read',
    )

    if (hasReadToolResults) {
      refetch()
    }
  }, [filteredEvents, refetch])

  // Filter out tool results for rendering
  const eventsToRender = hasSubTasks
    ? rootEvents.filter(event => event.eventType !== ConversationEventType.ToolResult)
    : filteredEvents.filter(event => event.eventType !== ConversationEventType.ToolResult)

  // Note: Navigation is handled by the parent component via props

  // Note: Keyboard navigation is handled by parent component

  const containerRef = useRef<HTMLDivElement>(null)
  const previousEventCountRef = useRef(0)
  const previousEventsRef = useRef<ConversationEvent[]>([])

  // Use the auto-scroll hook
  useAutoScroll(
    containerRef,
    eventsToRender.length > previousEventCountRef.current,
    filteredEvents.length !== previousEventsRef.current.length ||
      filteredEvents.some((event, index) => {
        const prevEvent = previousEventsRef.current[index]
        return (
          !prevEvent ||
          event.id !== prevEvent.id ||
          event.toolResultContent !== prevEvent.toolResultContent
        )
      }),
  )

  // Update refs after checking
  useEffect(() => {
    if (!loading) {
      previousEventCountRef.current = eventsToRender.length
      previousEventsRef.current = [...filteredEvents]
    }
  }, [loading, eventsToRender.length, filteredEvents])

  // Scroll focused event into view (only for keyboard navigation)
  useEffect(() => {
    if (focusedEventId && containerRef.current && focusSource === 'keyboard') {
      const focusedElement = containerRef.current.querySelector(`[data-event-id="${focusedEventId}"]`)
      if (focusedElement) {
        const elementRect = focusedElement.getBoundingClientRect()
        const containerRect = containerRef.current.getBoundingClientRect()
        const inView =
          elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom
        if (!inView) {
          focusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      }
    }
  }, [focusedEventId, focusSource])

  // Scroll deny form into view when opened
  useEffect(() => {
    if (denyingApprovalId && containerRef.current) {
      // Find the event that contains this approval
      const event = filteredEvents.find(e => e.approvalId === denyingApprovalId)
      if (event && !event.approvalStatus) {
        const eventElement = containerRef.current.querySelector(`[data-event-id="${event.id}"]`)
        if (eventElement) {
          const elementRect = eventElement.getBoundingClientRect()
          const containerRect = containerRef.current.getBoundingClientRect()
          const inView =
            elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom
          if (!inView) {
            // Scroll the deny form into view
            setTimeout(() => {
              eventElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }, 100) // Small delay to ensure form is rendered
          }
        }
      }
    }
  }, [denyingApprovalId, filteredEvents])

  if (error) {
    console.log('error', error)
    return <div className="text-destructive">Error loading conversation: {error}</div>
  }

  if (loading && isInitialLoad && showSkeleton) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  // No events yet - return null so only the loader shows
  if (filteredEvents.length === 0) {
    return null
  }

  // Render using the new ConversationEventRow component
  return (
    <div
      ref={containerRef}
      data-conversation-container
      className="overflow-y-auto flex-1 flex flex-col"
    >
      {eventsToRender.map((event, index) => {
        const taskGroup = event.toolId ? taskGroups.get(event.toolId) : undefined

        if (taskGroup) {
          return (
            <TaskGroupEventRow
              key={event.id}
              group={taskGroup}
              session={session}
              isExpanded={actualExpandedTasks.has(event.toolId!)}
              onToggle={() => actualToggleTaskGroup(event.toolId!)}
              toolResult={undefined}
              toolResultsByKey={toolResultsByKey}
              focusedEventId={focusedEventId}
              setFocusedEventId={setFocusedEventId}
              setFocusSource={setFocusSource || (() => {})}
              shouldIgnoreMouseEvent={shouldIgnoreMouseEvent || (() => false)}
              isFocused={focusedEventId === event.id}
              isLast={index === eventsToRender.length - 1}
              responseEditorIsFocused={responseEditor?.isFocused || false}
              setExpandedToolResult={setExpandedToolResult}
              setExpandedToolCall={setExpandedToolCall}
              onApprove={onApprove}
              onDeny={onDeny}
              approvingApprovalId={approvingApprovalId}
              denyingApprovalId={denyingApprovalId}
              setDenyingApprovalId={setDenyingApprovalId}
              onCancelDeny={onCancelDeny}
            />
          )
        }

        return (
          <ConversationEventRow
            key={event.id}
            event={event}
            eventId={event.id.toString()}
            toolResult={event.toolId ? toolResultsByKey[event.toolId] : undefined}
            setFocusedEventId={setFocusedEventId}
            setFocusSource={setFocusSource || (() => {})}
            shouldIgnoreMouseEvent={shouldIgnoreMouseEvent || (() => false)}
            isFocused={focusedEventId === event.id}
            isLast={index === eventsToRender.length - 1}
            responseEditorIsFocused={responseEditor?.isFocused || false}
            setExpandedToolResult={setExpandedToolResult}
            setExpandedToolCall={setExpandedToolCall}
            onApprove={onApprove}
            onDeny={onDeny}
            approvingApprovalId={approvingApprovalId}
            denyingApprovalId={denyingApprovalId}
            setDenyingApprovalId={setDenyingApprovalId}
            onCancelDeny={onCancelDeny}
          />
        )
      })}
    </div>
  )
}
