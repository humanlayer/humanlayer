import { createStarryNight } from '@wooorm/starry-night'
import jsonGrammar from '@wooorm/starry-night/source.json'
import textMd from '@wooorm/starry-night/text.md'
import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import keyBy from 'lodash.keyby'

import { ConversationEvent, ConversationEventType } from '@/lib/daemon/types'
import { useConversation } from '@/hooks/useConversation'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageCircleDashed } from 'lucide-react'
import { formatAbsoluteTimestamp } from '@/utils/formatting'
import { eventToDisplayObject } from '../eventToDisplayObject'

// TODO(2): Extract keyboard navigation logic to a custom hook
// TODO(2): Extract auto-scroll logic to a separate utility
// TODO(3): Add virtual scrolling for very long conversations
// TODO(1): Fix the starryNight initialization duplication

/* I, Sundeep, don't know how I feel about what's going on here. */
let starryNight: any | null = null

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
}) {
  const { events, loading, error, isInitialLoad } = useConversation(sessionId, undefined, 1000)
  const toolResults = events.filter(event => event.event_type === ConversationEventType.ToolResult)
  const toolResultsByKey = keyBy(toolResults, 'tool_result_for_id')

  const displayObjects = events
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
      ),
    )
  const nonEmptyDisplayObjects = displayObjects.filter(displayObject => displayObject !== null)

  // Navigation handlers
  const focusNextEvent = () => {
    if (nonEmptyDisplayObjects.length === 0) return

    const currentIndex = focusedEventId
      ? nonEmptyDisplayObjects.findIndex(obj => obj.id === focusedEventId)
      : -1

    // If nothing focused, focus first item
    if (currentIndex === -1) {
      setFocusedEventId(nonEmptyDisplayObjects[0].id)
      setFocusSource?.('keyboard')
    }
    // If not at the end, move to next
    else if (currentIndex < nonEmptyDisplayObjects.length - 1) {
      setFocusedEventId(nonEmptyDisplayObjects[currentIndex + 1].id)
      setFocusSource?.('keyboard')
    }
    // If at the end, do nothing
  }

  const focusPreviousEvent = () => {
    if (nonEmptyDisplayObjects.length === 0) return

    const currentIndex = focusedEventId
      ? nonEmptyDisplayObjects.findIndex(obj => obj.id === focusedEventId)
      : -1

    // If nothing focused, focus last item
    if (currentIndex === -1) {
      setFocusedEventId(nonEmptyDisplayObjects[nonEmptyDisplayObjects.length - 1].id)
      setFocusSource?.('keyboard')
    }
    // If not at the beginning, move to previous
    else if (currentIndex > 0) {
      setFocusedEventId(nonEmptyDisplayObjects[currentIndex - 1].id)
      setFocusSource?.('keyboard')
    }
    // If at the beginning, do nothing
  }

  // Keyboard navigation (disabled when modal is open)
  useHotkeys('j', focusNextEvent, { enabled: !expandedToolResult })
  useHotkeys('k', focusPreviousEvent, { enabled: !expandedToolResult })

  const containerRef = useRef<HTMLDivElement>(null)
  const previousEventCountRef = useRef(0)
  const previousEventsRef = useRef<ConversationEvent[]>([])

  useEffect(() => {
    if (!loading && containerRef.current && nonEmptyDisplayObjects.length > 0) {
      const hasNewEvents = nonEmptyDisplayObjects.length > previousEventCountRef.current

      // Check if any events have changed (including tool results being added)
      const eventsChanged =
        events.length !== previousEventsRef.current.length ||
        events.some((event, index) => {
          const prevEvent = previousEventsRef.current[index]
          return (
            !prevEvent ||
            event.id !== prevEvent.id ||
            event.tool_result_content !== prevEvent.tool_result_content
          )
        })

      // Auto-scroll if we have new display events or events have changed
      if (hasNewEvents || eventsChanged) {
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight
          }
        }, 50)
      }
      previousEventCountRef.current = nonEmptyDisplayObjects.length
      previousEventsRef.current = [...events]
    }

    if (!starryNight) {
      createStarryNight([textMd, jsonGrammar]).then(sn => (starryNight = sn))
    }
  }, [loading, nonEmptyDisplayObjects.length, events])

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
      const event = events.find(e => e.approval_id === denyingApprovalId)
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
  }, [denyingApprovalId, events])

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
  if (events.length === 0) {
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

  return (
    <div ref={containerRef} data-conversation-container className="overflow-y-auto flex-1">
      <div>
        {nonEmptyDisplayObjects.map((displayObject, index) => (
          <div key={displayObject.id}>
            <div
              data-event-id={displayObject.id}
              onMouseEnter={() => {
                setFocusedEventId(displayObject.id)
                setFocusSource?.('mouse')
              }}
              onMouseLeave={() => {
                setFocusedEventId(null)
                setConfirmingApprovalId?.(null)
              }}
              className={`pt-1 pb-3 px-2 cursor-pointer ${
                index !== nonEmptyDisplayObjects.length - 1 ? 'border-b' : ''
              } ${focusedEventId === displayObject.id ? '!bg-accent/20 -mx-2 px-4 rounded' : ''}`}
            >
              {/* Timestamp at top */}
              <div className="flex justify-end mb-1">
                <span className="text-xs text-muted-foreground/60">
                  {formatAbsoluteTimestamp(displayObject.created_at)}
                </span>
              </div>

              <div className="flex items-baseline gap-2">
                {displayObject.iconComponent && (
                  <span className="text-sm text-accent align-middle relative top-[1px]">
                    {displayObject.iconComponent}
                  </span>
                )}
                <span className="whitespace-pre-wrap text-accent max-w-[90%]">
                  {displayObject.subject}
                </span>
              </div>
              {displayObject.toolResultContent && (
                <p className="whitespace-pre-wrap text-foreground">{displayObject.toolResultContent}</p>
              )}
              {displayObject.body && (
                <p className="whitespace-pre-wrap text-foreground">{displayObject.body}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
