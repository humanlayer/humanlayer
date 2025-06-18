import { createStarryNight } from '@wooorm/starry-night'
import textMd from '@wooorm/starry-night/text.md'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

import { ConversationEvent, ConversationEventType, SessionInfo } from '@/lib/daemon/types'
import { Card, CardContent } from '../ui/card'
import { useHotkeys } from 'react-hotkeys-hook'
import { useFormattedConversation, useConversation } from '@/hooks/useConversation'
import { Skeleton } from '../ui/skeleton'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Bot, MessageCircleDashed, Wrench } from 'lucide-react'

/* I, Sundeep, don't know how I feel about what's going on here. */
let starryNight: any | null = null

interface SessionDetailProps {
  session: SessionInfo
  onClose: () => void
}

/* This will almost certainly become something else over time, but for the moment while we get a feel for the data, this is okay */
function eventToDisplayObject(event: ConversationEvent) {
  let subject = <span>Unknown Subject</span>
  let body = null
  let iconComponent = null

  // For the moment, don't display tool results.
  if (event.event_type === ConversationEventType.ToolResult) {
    return null
  }

  if (event.event_type === ConversationEventType.ToolCall) {
    iconComponent = <Wrench className="w-4 h-4" />

    // Claude Code converts "LS" to "List"
    if (event.tool_name === 'LS') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">List </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.path}</span>
        </span>
      )
    }

    if (event.tool_name === 'Read') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">{event.tool_name} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.file_path}</span>
        </span>
      )
    }

    if (event.tool_name === 'Task') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">{event.tool_name} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.description}</span>
        </span>
      )
    }

    if (event.tool_name === 'TodoWrite') {
      const toolInput = JSON.parse(event.tool_input_json!)
      const todos = toolInput.todos
      const completedCount = todos.filter((todo: any) => todo.status === 'completed').length
      const pendingCount = todos.filter((todo: any) => todo.status === 'pending').length

      subject = (
        <span>
          <span className="font-bold">Update TODOs </span>
          <span className="font-mono text-sm text-muted-foreground">
            {completedCount} completed, {pendingCount} pending
          </span>
        </span>
      )
    }

    if (event.tool_name === 'Edit') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">{event.tool_name} </span>
          <span className="font-mono text-sm text-muted-foreground">Edit to {toolInput.file_path}</span>
        </span>
      )
    }

    if (event.tool_name === 'MultiEdit') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">{event.tool_name} </span>
          <span className="font-mono text-sm text-muted-foreground">
            {toolInput.edits.length} edit{toolInput.edits.length === 1 ? '' : 's'} to{' '}
            {toolInput.file_path}
          </span>
        </span>
      )
    }

    if (event.tool_name === 'Grep') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">{event.tool_name} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.pattern}</span>
        </span>
      )
    }
  }

  if (event.event_type === ConversationEventType.Message) {
    const subjectText = event.content?.split('\n')[0] || ''
    const bodyText = event.content?.split('\n').slice(1).join('\n') || ''

    const subjectTree = starryNight?.highlight(subjectText, 'text.md')
    const bodyTree = starryNight?.highlight(bodyText, 'text.md')

    subject = subjectTree ? (
      <span>{toJsxRuntime(subjectTree, { Fragment, jsx, jsxs })}</span>
    ) : (
      <span>{subjectText}</span>
    )
    body = bodyTree ? (
      <span>{toJsxRuntime(bodyTree, { Fragment, jsx, jsxs })}</span>
    ) : (
      <span>{bodyText}</span>
    )
  }

  if (event.role === 'assistant') {
    iconComponent = <Bot className="w-4 h-4" />
  }

  return {
    id: event.id,
    role: event.role,
    subject,
    isCompleted: event.is_completed,
    iconComponent,
    body,
  }
}

function EventMetaInfo({ event }: { event: ConversationEvent }) {
  return (
    <div className="bg-muted/20 rounded p-4 mt-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="font-medium text-muted-foreground">Event ID:</span>
          <span className="ml-2 font-mono">{event.id}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Sequence:</span>
          <span className="ml-2 font-mono">{event.sequence}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Type:</span>
          <span className="ml-2 font-mono">{event.event_type}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Role:</span>
          <span className="ml-2 font-mono">{event.role || 'N/A'}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Created:</span>
          <span className="ml-2 font-mono text-xs">{new Date(event.created_at).toLocaleString()}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Completed:</span>
          <span className="ml-2">{event.is_completed ? '✓' : '⏳'}</span>
        </div>
        {event.tool_name && (
          <>
            <div>
              <span className="font-medium text-muted-foreground">Tool:</span>
              <span className="ml-2 font-mono">{event.tool_name}</span>
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Tool ID:</span>
              <span className="ml-2 font-mono text-xs">{event.tool_id}</span>
            </div>
          </>
        )}
        {event.approval_status && (
          <div>
            <span className="font-medium text-muted-foreground">Approval:</span>
            <span className="ml-2 font-mono">{event.approval_status}</span>
          </div>
        )}
      </div>

      {event.tool_input_json && (
        <div className="mt-3">
          <span className="font-medium text-muted-foreground">Tool Input:</span>
          <pre className="mt-1 text-xs bg-background rounded p-2 overflow-x-auto">
            {JSON.stringify(JSON.parse(event.tool_input_json), null, 2)}
          </pre>
        </div>
      )}

      {event.tool_result_content && (
        <div className="mt-3">
          <span className="font-medium text-muted-foreground">Tool Result:</span>
          <pre className="mt-1 text-xs bg-background rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
            {event.tool_result_content}
          </pre>
        </div>
      )}
    </div>
  )
}

function ConversationContent({
  sessionId,
  focusedEventId,
  setFocusedEventId,
  expandedEventId,
  setExpandedEventId,
  isWideView,
}: {
  sessionId: string
  focusedEventId: number | null
  setFocusedEventId: (id: number | null) => void
  expandedEventId: number | null
  setExpandedEventId: (id: number | null) => void
  isWideView: boolean
}) {
  const { formattedEvents, loading, error } = useFormattedConversation(sessionId)
  const { events } = useConversation(sessionId)
  console.log('raw events', events)
  const displayObjects = events.map(eventToDisplayObject)
  const nonEmptyDisplayObjects = displayObjects.filter(displayObject => displayObject !== null)

  // Navigation handlers
  const focusNextEvent = () => {
    if (nonEmptyDisplayObjects.length === 0) return

    const currentIndex = focusedEventId
      ? nonEmptyDisplayObjects.findIndex(obj => obj.id === focusedEventId)
      : -1

    if (currentIndex === -1 || currentIndex === nonEmptyDisplayObjects.length - 1) {
      setFocusedEventId(nonEmptyDisplayObjects[0].id)
    } else {
      setFocusedEventId(nonEmptyDisplayObjects[currentIndex + 1].id)
    }
  }

  const focusPreviousEvent = () => {
    if (nonEmptyDisplayObjects.length === 0) return

    const currentIndex = focusedEventId
      ? nonEmptyDisplayObjects.findIndex(obj => obj.id === focusedEventId)
      : -1

    if (currentIndex === -1 || currentIndex === 0) {
      setFocusedEventId(nonEmptyDisplayObjects[nonEmptyDisplayObjects.length - 1].id)
    } else {
      setFocusedEventId(nonEmptyDisplayObjects[currentIndex - 1].id)
    }
  }

  // Keyboard navigation
  useHotkeys('j', focusNextEvent)
  useHotkeys('k', focusPreviousEvent)

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loading && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }

    if (!starryNight) {
      createStarryNight([textMd]).then(sn => (starryNight = sn))
    }
  }, [loading, formattedEvents])

  if (error) {
    return <div className="text-destructive">Error loading conversation: {error}</div>
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  // No events yet.
  if (formattedEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="text-muted-foreground mb-2">
          <MessageCircleDashed className="w-12 h-12 mx-auto" />
        </div>
        <h3 className="text-lg font-medium text-foreground">No conversation yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The conversation will appear here once it starts.
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="max-h-[calc(100vh-375px)] overflow-y-auto">
      <div>
        {nonEmptyDisplayObjects.map((displayObject, index) => (
          <div key={displayObject.id}>
            <div
              onMouseEnter={() => setFocusedEventId(displayObject.id)}
              onMouseLeave={() => setFocusedEventId(null)}
              onClick={() =>
                setExpandedEventId(expandedEventId === displayObject.id ? null : displayObject.id)
              }
              className={`py-3 px-2 cursor-pointer ${
                index !== nonEmptyDisplayObjects.length - 1 ? 'border-b' : ''
              } ${focusedEventId === displayObject.id ? '!bg-accent/20 -mx-2 px-4 rounded' : ''}`}
            >
              <div className="flex items-center gap-2">
                {displayObject.iconComponent && (
                  <span className="text-sm text-accent">{displayObject.iconComponent}</span>
                )}

                <span className="whitespace-pre-wrap text-accent">{displayObject.subject}</span>
                {/* <span className="font-medium">{displayObject.role}</span> */}
                {/* <span className="text-sm text-muted-foreground">{displayObject.timestamp.toLocaleTimeString()}</span> */}
              </div>
              {displayObject.body && (
                <p className="whitespace-pre-wrap text-foreground">{displayObject.body}</p>
              )}
            </div>

            {/* Expanded content for slim view */}
            {!isWideView && expandedEventId === displayObject.id && (
              <EventMetaInfo event={events.find(e => e.id === displayObject.id)!} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionDetail({ session, onClose }: SessionDetailProps) {
  const [focusedEventId, setFocusedEventId] = useState<number | null>(null)
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null)
  const [isWideView, setIsWideView] = useState(false)

  // Get events for sidebar access
  const { events } = useConversation(session.id)

  // Screen width detection for responsive layout
  useEffect(() => {
    const checkScreenWidth = () => {
      setIsWideView(window.innerWidth >= 1024) // lg breakpoint
    }

    checkScreenWidth()
    window.addEventListener('resize', checkScreenWidth)
    return () => window.removeEventListener('resize', checkScreenWidth)
  }, [])

  // Enter key to expand/collapse focused event
  useHotkeys('enter', () => {
    if (focusedEventId) {
      setExpandedEventId(expandedEventId === focusedEventId ? null : focusedEventId)
    }
  })

  // Clear focus/expansion on escape, then close if nothing focused
  useHotkeys('escape', () => {
    if (expandedEventId) {
      setExpandedEventId(null)
    } else if (focusedEventId) {
      setFocusedEventId(null)
    } else {
      onClose()
    }
  })

  return (
    <section className="flex flex-col gap-4">
      <hgroup className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-foreground font-mono">{session.query} </h2>
        <small className="text-muted-foreground font-mono text-xs uppercase tracking-wider">
          {`${session.status}${session.model ? `/ ${session.model}` : ''}`}
        </small>
      </hgroup>
      <div className={`flex gap-4 ${isWideView ? 'flex-row' : 'flex-col'}`}>
        <Card className={isWideView ? 'flex-1' : 'w-full'}>
          <CardContent>
            <Suspense
              fallback={
                <div className="space-y-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              }
            >
              <ConversationContent
                sessionId={session.id}
                focusedEventId={focusedEventId}
                setFocusedEventId={setFocusedEventId}
                expandedEventId={expandedEventId}
                setExpandedEventId={setExpandedEventId}
                isWideView={isWideView}
              />
            </Suspense>
          </CardContent>
        </Card>

        {/* Sidebar for wide view */}
        {isWideView && focusedEventId && (
          <Card className="w-[40%]">
            <CardContent>
              <EventMetaInfo event={events.find(e => e.id === focusedEventId)!} />
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}

export default SessionDetail
