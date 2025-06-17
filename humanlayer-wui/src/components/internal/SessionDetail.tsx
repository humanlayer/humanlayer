import { createStarryNight } from '@wooorm/starry-night'
import textMd from '@wooorm/starry-night/text.md'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

import { ConversationEvent, ConversationEventType, SessionInfo } from '@/lib/daemon/types'
import { Card, CardContent } from '../ui/card'
import { useHotkeys } from 'react-hotkeys-hook'
import { useFormattedConversation, useConversation } from '@/hooks/useConversation'
import { Skeleton } from '../ui/skeleton'
import { Suspense, useEffect, useRef } from 'react'
import { Bot, MessageCircleDashed, Wrench } from 'lucide-react'

/* I, Sundeep, don't know how I feel about what's going on here. */
let starryNight: any | null = null

interface SessionDetailProps {
  session: SessionInfo
  onClose: () => void
}

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
          <span className="font-mono text-sm text-gray-800">{toolInput.path}</span>
        </span>
      )
    }

    if (event.tool_name === 'Read') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">{event.tool_name} </span>
          <span className="font-mono text-sm text-gray-800">{toolInput.file_path}</span>
        </span>
      )
    }
  }

  if (event.event_type === ConversationEventType.Message) {
    const subjectTree = starryNight?.highlight(event.content?.split('\n')[0], 'text.md')
    const bodyTree = starryNight?.highlight(event.content?.split('\n').slice(1).join('\n'), 'text.md')

    subject = <span>{toJsxRuntime(subjectTree, { Fragment, jsx, jsxs })}</span>
    body = <span>{toJsxRuntime(bodyTree, { Fragment, jsx, jsxs })}</span>
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

function ConversationContent({ sessionId }: { sessionId: string }) {
  const { formattedEvents, loading, error } = useFormattedConversation(sessionId)
  const { events } = useConversation(sessionId)
  const displayObjects = events.map(eventToDisplayObject)
  const nonEmptyDisplayObjects = displayObjects.filter(displayObject => displayObject !== null)

  console.log('formattedEvents', formattedEvents)
  console.log('raw events', events)
  console.log('displayObjects', displayObjects)
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
    return <div className="text-red-500">Error loading conversation: {error}</div>
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
        <div className="text-gray-400 mb-2">
          <MessageCircleDashed className="w-12 h-12 mx-auto" />
        </div>
        <h3 className="text-lg font-medium text-gray-900">No conversation yet</h3>
        <p className="mt-1 text-sm text-gray-500">The conversation will appear here once it starts.</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="max-h-[calc(100vh-375px)] overflow-y-auto">
      <div className="space-y-4">
        {nonEmptyDisplayObjects.map((displayObject, index) => (
          <div
            key={displayObject.id}
            className={`pb-4 ${index !== nonEmptyDisplayObjects.length - 1 ? 'border-b' : ''}`}
          >
            <div className="flex items-center gap-2 mb-2">
              {displayObject.iconComponent && (
                <span className="text-sm text-gray-500">{displayObject.iconComponent}</span>
              )}

              <span className="whitespace-pre-wrap">{displayObject.subject}</span>
              {/* <span className="font-medium">{displayObject.role}</span> */}
              {/* <span className="text-sm text-gray-500">{displayObject.timestamp.toLocaleTimeString()}</span> */}
            </div>
            {displayObject.body && <p className="whitespace-pre-wrap">{displayObject.body}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionDetail({ session, onClose }: SessionDetailProps) {
  useHotkeys('escape', onClose)
  console.log('session', session)

  return (
    <section className="flex flex-col gap-4">
      <hgroup className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{session.query} </h2>
        <small className="text-gray-500 font-mono text-sm uppercase">
          {session.status} / {session.id} / {session.model}
        </small>
      </hgroup>
      <div className="flex flex-col gap-4">
        <Card>
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
              <ConversationContent sessionId={session.id} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export default SessionDetail
