import { useEffect, useRef } from 'react'
import keyBy from 'lodash.keyby'

import { ConversationEvent, ConversationEventType } from '@/lib/daemon/types'
import { useConversation } from '@/hooks/useConversation'
import { useSessionSnapshots } from '@/hooks/useSessionSnapshots'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageCircleDashed, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAbsoluteTimestamp, formatTimestamp } from '@/utils/formatting'
import { eventToDisplayObject } from '../eventToDisplayObject'
import { useTaskGrouping } from '../hooks/useTaskGrouping'
import { TaskGroup } from './TaskGroup'
import { copyToClipboard } from '@/utils/clipboard'
import { MessageContent } from '../components/MessageContent'

// TODO(2): Extract keyboard navigation logic to a custom hook
// TODO(2): Extract auto-scroll logic to a separate utility
// TODO(3): Add virtual scrolling for very long conversations

export function ConversationContent({
  sessionId,
  focusedEventId,
  setFocusedEventId,
  onApprove,
  onDeny,
  approvingApprovalId,
  confirmingApprovalId,
  denyingApprovalId,
  setDenyingApprovalId,
  onCancelDeny,
  isSplitView,
  onToggleSplitView,
  focusSource,
  setFocusSource,
  setConfirmingApprovalId,
  expandedToolResult,
  setExpandedToolResult,
  setExpandedToolCall,
  maxEventIndex,
  shouldIgnoreMouseEvent,
}: {
  sessionId: string
  focusedEventId: number | null
  setFocusedEventId: (id: number | null) => void
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string, reason: string) => void
  approvingApprovalId?: string | null
  confirmingApprovalId?: string | null
  denyingApprovalId?: string | null
  setDenyingApprovalId?: (id: string | null) => void
  onCancelDeny?: () => void
  isSplitView?: boolean
  onToggleSplitView?: () => void
  focusSource?: 'mouse' | 'keyboard' | null
  setFocusSource?: (source: 'mouse' | 'keyboard' | null) => void
  setConfirmingApprovalId?: (id: string | null) => void
  expandedToolResult?: ConversationEvent | null
  setExpandedToolResult?: (event: ConversationEvent | null) => void
  setExpandedToolCall?: (event: ConversationEvent | null) => void
  maxEventIndex?: number
  shouldIgnoreMouseEvent?: () => boolean
}) {
  // expandedToolResult is used by parent to control hotkey availability
  void expandedToolResult
  const { events, loading, error, isInitialLoad } = useConversation(sessionId, undefined, 1000)
  const { getSnapshot, refetch } = useSessionSnapshots(sessionId)

  // Filter events based on maxEventIndex (exclude the event at maxEventIndex)
  const filteredEvents = maxEventIndex !== undefined ? events.slice(0, maxEventIndex) : events

  const toolResults = filteredEvents.filter(
    event => event.event_type === ConversationEventType.ToolResult,
  )
  const toolResultsByKey = keyBy(toolResults, 'tool_result_for_id')

  // Use task grouping hook
  const { taskGroups, rootEvents, hasSubTasks, expandedTasks, toggleTaskGroup } =
    useTaskGrouping(filteredEvents)

  // Watch for new Read tool results and refetch snapshots
  useEffect(() => {
    const hasReadToolResults = filteredEvents.some(
      event => event.event_type === ConversationEventType.ToolResult && event.tool_name === 'Read',
    )

    if (hasReadToolResults) {
      refetch()
    }
  }, [filteredEvents, refetch])

  const displayObjects = filteredEvents
    .filter(event => event.event_type !== ConversationEventType.ToolResult)
    .map(event =>
      eventToDisplayObject(
        event,
        onApprove,
        onDeny,
        denyingApprovalId,
        setDenyingApprovalId,
        onCancelDeny,
        approvingApprovalId,
        confirmingApprovalId,
        isSplitView,
        onToggleSplitView,
        event.tool_id ? toolResultsByKey[event.tool_id] : undefined,
        focusedEventId === event.id,
        getSnapshot,
      ),
    )
  const nonEmptyDisplayObjects = displayObjects.filter(displayObject => displayObject !== null)

  // Note: Navigation is handled by the parent component via props

  // Note: Keyboard navigation is handled by parent component

  const containerRef = useRef<HTMLDivElement>(null)
  const previousEventCountRef = useRef(0)
  const previousEventsRef = useRef<ConversationEvent[]>([])

  useEffect(() => {
    if (!loading && containerRef.current && nonEmptyDisplayObjects.length > 0) {
      const hasNewEvents = nonEmptyDisplayObjects.length > previousEventCountRef.current

      // Check if any events have changed (including tool results being added)
      const eventsChanged =
        filteredEvents.length !== previousEventsRef.current.length ||
        filteredEvents.some((event, index) => {
          const prevEvent = previousEventsRef.current[index]
          return (
            !prevEvent ||
            event.id !== prevEvent.id ||
            event.tool_result_content !== prevEvent.tool_result_content
          )
        })

      // Auto-scroll if we have new display events or events have changed
      // _and_ we're not focused on a row
      if ((hasNewEvents || eventsChanged) && !focusedEventId) {
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight
          }
        }, 50)
      }
      previousEventCountRef.current = nonEmptyDisplayObjects.length
      previousEventsRef.current = [...filteredEvents]
    }
  }, [loading, nonEmptyDisplayObjects.length, filteredEvents])

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
      const event = filteredEvents.find(e => e.approval_id === denyingApprovalId)
      if (event && !event.approval_status) {
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
    return <div className="text-destructive">Error loading conversation: {error}</div>
  }

  if (loading && isInitialLoad) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  // No events yet.
  if (filteredEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="text-muted-foreground mb-2">
          <MessageCircleDashed className="w-12 h-12 mx-auto" />
        </div>
        <h3 className="text-lg font-medium text-foreground">No conversation just yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The conversation will appear here once the bot engines begin to fire up.
        </p>
      </div>
    )
  }

  // Early return for no sub-tasks case (most common)
  if (!hasSubTasks) {
    return (
      <div ref={containerRef} data-conversation-container className="overflow-y-auto flex-1">
        <div>
          {nonEmptyDisplayObjects.map((displayObject, index) => (
            <div key={displayObject.id}>
              <div
                data-event-id={displayObject.id}
                onMouseEnter={() => {
                  if (shouldIgnoreMouseEvent?.()) return
                  setFocusedEventId(displayObject.id)
                  setFocusSource?.('mouse')
                }}
                onMouseLeave={() => {
                  if (shouldIgnoreMouseEvent?.()) return
                  setFocusedEventId(null)
                  setConfirmingApprovalId?.(null)
                }}
                onClick={() => {
                  const event = events.find(e => e.id === displayObject.id)
                  if (event?.event_type === ConversationEventType.ToolCall) {
                    const toolResult = event.tool_id
                      ? events.find(
                          e =>
                            e.event_type === ConversationEventType.ToolResult &&
                            e.tool_result_for_id === event.tool_id,
                        )
                      : null
                    if (setExpandedToolResult && setExpandedToolCall) {
                      setExpandedToolResult(toolResult || null)
                      setExpandedToolCall(event)
                    }
                  }
                }}
                className={`group relative p-4 cursor-pointer NoSubTasksConversationContent ${
                  index !== nonEmptyDisplayObjects.length - 1 ? 'border-b' : ''
                } ${focusedEventId === displayObject.id ? '!bg-accent/20' : ''}`}
              >
                {/* Main content container with flexbox */}
                <div className="flex gap-4">
                  {/* Left side: Icon and message content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      {displayObject.iconComponent && (
                        <span
                          className={`text-sm ${displayObject.isThinking ? 'text-muted-foreground' : 'text-accent'} align-middle relative top-[1px]`}
                        >
                          {displayObject.iconComponent}
                        </span>
                      )}
                      <MessageContent
                        subject={displayObject.subject}
                        body={displayObject.body}
                        toolResultContent={displayObject.toolResultContent}
                      />
                    </div>
                  </div>

                  {/* Right side: Actions and timestamp */}
                  <div className="flex items-start gap-2 shrink-0">
                    {/* Copy button - only show for user and assistant messages */}
                    {(() => {
                      const event = events.find(e => e.id === displayObject.id)
                      return event?.event_type === ConversationEventType.Message &&
                        (event.role === 'user' || event.role === 'assistant') ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          onClick={e => {
                            e.stopPropagation()
                            const content = event.content || ''
                            copyToClipboard(content)
                          }}
                          title="Copy message (y)"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      ) : null
                    })()}

                    {/* Timestamp with tooltip */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-muted-foreground/60 uppercase tracking-wider cursor-help">
                          {formatTimestamp(displayObject.created_at)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {formatAbsoluteTimestamp(displayObject.created_at)}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Render with task groups
  return (
    <div ref={containerRef} data-conversation-container className="overflow-y-auto flex-1">
      <div>
        {rootEvents
          .filter(event => event.event_type !== ConversationEventType.ToolResult)
          .map((event, index) => {
            const taskGroup = taskGroups.get(event.tool_id || '')

            if (taskGroup) {
              return (
                <TaskGroup
                  key={event.id}
                  group={taskGroup}
                  isExpanded={expandedTasks.has(event.tool_id!)}
                  onToggle={() => toggleTaskGroup(event.tool_id!)}
                  focusedEventId={focusedEventId}
                  setFocusedEventId={setFocusedEventId}
                  onApprove={onApprove}
                  onDeny={onDeny}
                  approvingApprovalId={approvingApprovalId}
                  confirmingApprovalId={confirmingApprovalId}
                  denyingApprovalId={denyingApprovalId}
                  setDenyingApprovalId={setDenyingApprovalId}
                  onCancelDeny={onCancelDeny}
                  isSplitView={isSplitView}
                  onToggleSplitView={onToggleSplitView}
                  setFocusSource={setFocusSource}
                  setConfirmingApprovalId={setConfirmingApprovalId}
                  toolResultsByKey={toolResultsByKey}
                  setExpandedToolResult={setExpandedToolResult}
                  setExpandedToolCall={setExpandedToolCall}
                  getSnapshot={getSnapshot}
                  shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
                />
              )
            } else {
              const displayObject = eventToDisplayObject(
                event,
                onApprove,
                onDeny,
                denyingApprovalId,
                setDenyingApprovalId,
                onCancelDeny,
                approvingApprovalId,
                confirmingApprovalId,
                isSplitView,
                onToggleSplitView,
                event.tool_id ? toolResultsByKey[event.tool_id] : undefined,
                focusedEventId === event.id,
                getSnapshot,
              )

              if (!displayObject) return null

              return (
                <div key={event.id}>
                  <div
                    data-event-id={displayObject.id}
                    onMouseEnter={() => {
                      if (shouldIgnoreMouseEvent?.()) return
                      setFocusedEventId(displayObject.id)
                      setFocusSource?.('mouse')
                    }}
                    onMouseLeave={() => {
                      if (shouldIgnoreMouseEvent?.()) return
                      setFocusedEventId(null)
                      setConfirmingApprovalId?.(null)
                    }}
                    onClick={() => {
                      const event = events.find(e => e.id === displayObject.id)
                      if (event?.event_type === ConversationEventType.ToolCall) {
                        const toolResult = event.tool_id
                          ? events.find(
                              e =>
                                e.event_type === ConversationEventType.ToolResult &&
                                e.tool_result_for_id === event.tool_id,
                            )
                          : null
                        if (setExpandedToolResult && setExpandedToolCall) {
                          setExpandedToolResult(toolResult || null)
                          setExpandedToolCall(event)
                        }
                      }
                    }}
                    className={`group relative p-4 cursor-pointer ${
                      index !==
                      rootEvents.filter(e => e.event_type !== ConversationEventType.ToolResult).length -
                        1
                        ? 'border-b'
                        : ''
                    } ${focusedEventId === displayObject.id ? '!bg-accent/20 rounded' : ''}`}
                  >
                    {/* Main content container with flexbox */}
                    <div className="flex gap-4">
                      {/* Left side: Icon and message content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          {displayObject.iconComponent && (
                            <span
                              className={`text-sm ${displayObject.isThinking ? 'text-muted-foreground' : 'text-accent'} align-middle relative top-[1px]`}
                            >
                              {displayObject.iconComponent}
                            </span>
                          )}
                          <MessageContent
                            subject={displayObject.subject}
                            body={displayObject.body}
                            toolResultContent={displayObject.toolResultContent}
                          />
                        </div>
                      </div>

                      {/* Right side: Actions and timestamp */}
                      <div className="flex items-start gap-2 shrink-0">
                        {/* Copy button - only show for user and assistant messages */}
                        {(() => {
                          const currentEvent = events.find(e => e.id === displayObject.id)
                          return currentEvent?.event_type === ConversationEventType.Message &&
                            (currentEvent.role === 'user' || currentEvent.role === 'assistant') ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                              onClick={e => {
                                e.stopPropagation()
                                const content = currentEvent.content || ''
                                copyToClipboard(content)
                              }}
                              title="Copy message (y)"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          ) : null
                        })()}

                        {/* Timestamp with tooltip */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground/60 cursor-help">
                              {formatTimestamp(displayObject.created_at)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {formatAbsoluteTimestamp(displayObject.created_at)}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
          })}
      </div>
    </div>
  )
}
