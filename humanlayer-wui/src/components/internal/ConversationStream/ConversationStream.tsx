import { useEffect, useRef } from 'react'
import keyBy from 'lodash.keyby'

import { ConversationEvent, ConversationEventType } from '@/lib/daemon/types'
import { useConversation } from '@/hooks/useConversation'
import { useSessionSnapshots } from '@/hooks/useSessionSnapshots'
import { Skeleton } from '@/components/ui/skeleton'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAbsoluteTimestamp, formatTimestamp } from '@/utils/formatting'
import { eventToDisplayObject } from '../SessionDetail/eventToDisplayObject'
import { useTaskGrouping } from '../SessionDetail/hooks/useTaskGrouping'
import { TaskGroup } from '../SessionDetail/views/TaskGroup'
import { copyToClipboard } from '@/utils/clipboard'
import { MessageContent } from '../SessionDetail/components/MessageContent'
import { hasTextSelection } from '@/utils/selection'
import { useStore } from '@/AppStore'
import { useAutoScroll } from '../SessionDetail/hooks/useAutoScroll'
import { ConversationEventRow } from './ConversationEventRow'
import { TaskGroupEventRow } from './TaskGroupEventRow'

// TODO(2): Extract keyboard navigation logic to a custom hook
// TODO(3): Add virtual scrolling for very long conversations

export function ConversationStream({
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
  expandedTasks,
  toggleTaskGroup,
  useNewRenderer,
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
  expandedTasks?: Set<string>
  toggleTaskGroup?: (taskId: string) => void
  useNewRenderer?: boolean
}) {
  // expandedToolResult is used by parent to control hotkey availability
  void expandedToolResult
  const { events, loading, error, isInitialLoad } = useConversation(sessionId, undefined, 1000)
  const { getSnapshot, refetch } = useSessionSnapshots(sessionId)
  const responseEditor = useStore(state => state.responseEditor)

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

  // Watch for new Read tool results and refetch snapshots
  useEffect(() => {
    const hasReadToolResults = filteredEvents.some(
      event => event.eventType === ConversationEventType.ToolResult && event.toolName === 'Read',
    )

    if (hasReadToolResults) {
      refetch()
    }
  }, [filteredEvents, refetch])

  const displayObjects = filteredEvents
    .filter(event => event.eventType !== ConversationEventType.ToolResult)
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
        event.toolId ? toolResultsByKey[event.toolId] : undefined,
        focusedEventId === event.id,
        getSnapshot,
        responseEditor?.getText(),
      ),
    )
  const nonEmptyDisplayObjects = displayObjects.filter(displayObject => displayObject !== null)

  // Note: Navigation is handled by the parent component via props

  // Note: Keyboard navigation is handled by parent component

  const containerRef = useRef<HTMLDivElement>(null)
  const previousEventCountRef = useRef(0)
  const previousEventsRef = useRef<ConversationEvent[]>([])

  // Use the auto-scroll hook
  useAutoScroll(
    containerRef,
    nonEmptyDisplayObjects.length > previousEventCountRef.current,
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

  // No events yet - return null so only the loader shows
  if (filteredEvents.length === 0) {
    return null
  }

  // New renderer path using ConversationEventRow component
  if (useNewRenderer) {
    // Use task grouping with the new renderer
    const eventsToRender = hasSubTasks
      ? rootEvents.filter(event => event.eventType !== ConversationEventType.ToolResult)
      : filteredEvents.filter(event => event.eventType !== ConversationEventType.ToolResult)

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

  // Early return for no sub-tasks case (most common)
  if (!hasSubTasks) {
    return (
      <div
        ref={containerRef}
        data-conversation-container
        className="overflow-y-auto flex-1 flex flex-col"
      >
        <div>
          {nonEmptyDisplayObjects.map((displayObject, index) => (
            /* For reference, this is effectively the start of ConversationEventRow */
            <div key={displayObject.id}>
              <div
                data-event-id={displayObject.id}
                onMouseEnter={() => {
                  if (shouldIgnoreMouseEvent?.()) return
                  if (displayObject.id !== undefined) {
                    setFocusedEventId(displayObject.id)
                    setFocusSource?.('mouse')
                  }
                }}
                onMouseLeave={() => {
                  if (shouldIgnoreMouseEvent?.()) return
                  setFocusedEventId(null)
                  setConfirmingApprovalId?.(null)
                }}
                onClick={() => {
                  // Don't open modal if user has selected text
                  if (hasTextSelection()) {
                    return
                  }

                  const event = events.find(e => e.id === displayObject.id)
                  if (event?.eventType === ConversationEventType.ToolCall) {
                    const toolResult = event.toolId
                      ? events.find(
                          e =>
                            e.eventType === ConversationEventType.ToolResult &&
                            e.toolResultForId === event.toolId,
                        )
                      : null
                    if (setExpandedToolResult && setExpandedToolCall) {
                      // Don't clear focus - the modal will preserve and restore it
                      setExpandedToolResult(toolResult || null)
                      setExpandedToolCall(event)
                    }
                  }
                }}
                className={`group relative p-4 cursor-pointer NoSubTasksConversationContent transition-colors duration-200 border-l-2 ${
                  index !== nonEmptyDisplayObjects.length - 1 ? 'border-b' : ''
                } ${
                  focusedEventId === displayObject.id
                    ? responseEditor?.isFocused
                      ? 'border-l-[var(--terminal-accent-dim)] bg-accent/5'
                      : 'border-l-[var(--terminal-accent)] bg-accent/10'
                    : 'border-l-transparent'
                }`}
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
                  <div className="flex items-start gap-2 w-[160px] justify-end">
                    {/* Copy button - only show for user and assistant messages */}
                    {(() => {
                      const event = events.find(e => e.id === displayObject.id)
                      return event?.eventType === ConversationEventType.Message &&
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
                        <span className="text-xs text-muted-foreground/60 uppercase tracking-wider cursor-help text-right block">
                          {displayObject.created_at ? formatTimestamp(displayObject.created_at) : ''}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {displayObject.created_at
                          ? formatAbsoluteTimestamp(displayObject.created_at)
                          : 'Unknown time'}
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
    <div
      ref={containerRef}
      data-conversation-container
      className="overflow-y-auto flex-1 flex flex-col"
    >
      <div>
        {rootEvents
          .filter(event => event.eventType !== ConversationEventType.ToolResult)
          .map((event, index) => {
            const taskGroup = taskGroups.get(event.toolId || '')

            if (taskGroup) {
              return (
                <TaskGroup
                  key={event.id}
                  group={taskGroup}
                  isExpanded={actualExpandedTasks.has(event.toolId!)}
                  onToggle={() => actualToggleTaskGroup(event.toolId!)}
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
                event.toolId ? toolResultsByKey[event.toolId] : undefined,
                focusedEventId === event.id,
                getSnapshot,
                responseEditor?.getText(),
              )

              if (!displayObject) return null

              return (
                <div key={event.id}>
                  <div
                    data-event-id={displayObject.id}
                    onMouseEnter={() => {
                      if (shouldIgnoreMouseEvent?.()) return
                      if (displayObject.id !== undefined) {
                        setFocusedEventId(displayObject.id)
                        setFocusSource?.('mouse')
                      }
                    }}
                    onMouseLeave={() => {
                      if (shouldIgnoreMouseEvent?.()) return
                      setFocusedEventId(null)
                      setConfirmingApprovalId?.(null)
                    }}
                    onClick={() => {
                      // Don't open modal if user has selected text
                      if (hasTextSelection()) {
                        return
                      }

                      const event = events.find(e => e.id === displayObject.id)
                      if (event?.eventType === ConversationEventType.ToolCall) {
                        const toolResult = event.toolId
                          ? events.find(
                              e =>
                                e.eventType === ConversationEventType.ToolResult &&
                                e.toolResultForId === event.toolId,
                            )
                          : null
                        if (setExpandedToolResult && setExpandedToolCall) {
                          setExpandedToolResult(toolResult || null)
                          setExpandedToolCall(event)
                        }
                      }
                    }}
                    className={`group relative p-4 cursor-pointer transition-colors duration-200 border-l-2 ${
                      index !==
                      rootEvents.filter(e => e.eventType !== ConversationEventType.ToolResult).length -
                        1
                        ? 'border-b'
                        : ''
                    } ${
                      focusedEventId === displayObject.id
                        ? responseEditor?.isFocused
                          ? 'border-l-[var(--terminal-accent-dim)] bg-accent/5'
                          : 'border-l-[var(--terminal-accent)] bg-accent/10'
                        : 'border-l-transparent'
                    }`}
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
                      <div className="flex items-start gap-2 w-[160px] justify-end">
                        {/* Copy button - only show for user and assistant messages */}
                        {(() => {
                          const currentEvent = events.find(e => e.id === displayObject.id)
                          return currentEvent?.eventType === ConversationEventType.Message &&
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
                            <span className="text-xs text-muted-foreground/60 cursor-help text-right block">
                              {displayObject.created_at
                                ? formatTimestamp(displayObject.created_at)
                                : ''}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {displayObject.created_at
                              ? formatAbsoluteTimestamp(displayObject.created_at)
                              : 'Unknown time'}
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
