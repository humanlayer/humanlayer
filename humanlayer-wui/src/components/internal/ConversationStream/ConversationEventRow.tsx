import * as React from 'react'
import type {
  ConversationEvent,
  ConversationEventEventTypeEnum,
  ConversationEventRoleEnum,
} from '@humanlayer/hld-sdk'
import { ConversationEventType, ConversationRole } from '@/lib/daemon'
import { Bot, User, Copy } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAbsoluteTimestamp, formatTimestamp } from '@/utils/formatting'
import { copyToClipboard } from '@/utils/clipboard'
import { Button } from '@/components/ui/button'
import { UserMessageContent, AssistantMessageContent, UnknownMessageContent } from './MessageContent'

const getIcon = (
  type: ConversationEventEventTypeEnum,
  role: ConversationEventRoleEnum | undefined,
  isCompleted: boolean | undefined,
) => {
  const iconClasses = `w-4 h-4 align-middle relative top-[1px] ${type === ConversationEventType.ToolCall && !isCompleted ? 'pulse-warning' : ''}`

  if (role === ConversationRole.User) {
    return <User className={iconClasses} />
  }

  if (role === ConversationRole.Assistant) {
    return <Bot className={iconClasses} />
  }
}

function TimestampWithTooltip({ createdAt }: { createdAt?: Date }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-xs text-muted-foreground/60 uppercase tracking-wider cursor-help text-right block">
          {createdAt ? formatTimestamp(createdAt) : ''}
        </span>
      </TooltipTrigger>
      <TooltipContent>{createdAt ? formatAbsoluteTimestamp(createdAt) : 'Unknown time'}</TooltipContent>
    </Tooltip>
  )
}

function CopyButton({ content }: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          onClick={(e) => {
            e.stopPropagation()
            copyToClipboard(content)
          }}
        >
          <Copy className="w-3 h-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy message (y)</TooltipContent>
    </Tooltip>
  )
}

function ConversationEventRowShell({
  children,
  eventId,
  shouldIgnoreMouseEvent,
  setFocusedEventId,
  setFocusSource,
  isFocused,
  isLast,
  isThinking,
  responseEditorIsFocused,
  ref,
  IconComponent,
  createdAt,
  showCopyButton,
  copyContent,
}: {
  children: React.ReactNode
  eventId: number
  shouldIgnoreMouseEvent: () => boolean
  setFocusedEventId: (eventId: number | null) => void
  setFocusSource: (source: 'mouse' | 'keyboard' | null) => void
  isFocused: boolean
  isLast: boolean
  isThinking: boolean
  responseEditorIsFocused: boolean
  ref: React.Ref<HTMLDivElement> | undefined
  IconComponent: React.ReactNode
  createdAt?: Date
  showCopyButton?: boolean
  copyContent?: string
}) {
  let outerContainerClasses = ['group', 'p-4', 'transition-colors', 'duration-200', 'border-l-2']

  /* Focused state, if the reponseEditor is focused, we use the dimmed color */
  if (isFocused) {
    if (responseEditorIsFocused) {
      outerContainerClasses.push('border-l-[var(--terminal-accent-dim)] bg-accent/5')
    } else {
      outerContainerClasses.push('border-l-[var(--terminal-accent)] bg-accent/10')
    }
  } else {
    outerContainerClasses.push('border-l-transparent')
  }

  if (!isLast) {
    outerContainerClasses.push('border-b')
  }

  return (
    <div
      ref={ref}
      className={outerContainerClasses.join(' ')}
      data-event-id={eventId}
      onMouseEnter={() => {
        if (shouldIgnoreMouseEvent()) return
        setFocusedEventId(eventId)
        setFocusSource('mouse')
      }}
      onMouseLeave={() => {
        if (shouldIgnoreMouseEvent()) return
        setFocusedEventId(null)
        setFocusSource(null)
      }}
    >
      <div className="flex items-start gap-4">
        {/* Left side: Icon and message content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-sm ${isThinking ? 'text-muted-foreground' : 'text-accent'} align-middle relative top-[1px]`}
            >
              {IconComponent}
            </span>
            {children}
          </div>
        </div>

        {/* Right side: Actions and Timestamp */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {showCopyButton && copyContent && <CopyButton content={copyContent} />}
          <TimestampWithTooltip createdAt={createdAt} />
        </div>
      </div>
    </div>
  )
}


export interface ConversationEventRowProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>
  event: ConversationEvent
  setFocusedEventId: (eventId: number | null) => void
  setFocusSource: (source: 'mouse' | 'keyboard' | null) => void
  shouldIgnoreMouseEvent: () => boolean
  isFocused: boolean
  isLast: boolean
  responseEditorIsFocused: boolean
}

export function ConversationEventRow({
  event,
  ref,
  setFocusedEventId,
  setFocusSource,
  shouldIgnoreMouseEvent,
  isFocused,
  isLast,
  responseEditorIsFocused,
}: ConversationEventRowProps) {
  const IconComponent = getIcon(event.eventType, event.role, event.isCompleted)

  let messageContent = null
  const isThinking = Boolean(
    event.eventType === ConversationEventType.Thinking ||
      (event.role === ConversationRole.Assistant && event.content?.startsWith('<thinking>')),
  )

  /* Determine MessageContent type */

  if (event.role === ConversationRole.User) {
    messageContent = <UserMessageContent eventContent={event.content || ''} />
  } else if (event.role === ConversationRole.Assistant) {
    messageContent = (
      <AssistantMessageContent eventContent={event.content || ''} isThinking={isThinking} />
    )
  }

  if (messageContent === null) {
    messageContent = <UnknownMessageContent />
  }

  // Only show copy button for user and assistant messages
  const showCopyButton =
    event.eventType === ConversationEventType.Message &&
    (event.role === ConversationRole.User || event.role === ConversationRole.Assistant)

  return (
    <ConversationEventRowShell
      ref={ref}
      eventId={event.id}
      shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
      setFocusedEventId={setFocusedEventId}
      setFocusSource={setFocusSource}
      isFocused={isFocused}
      isLast={isLast}
      isThinking={isThinking}
      responseEditorIsFocused={responseEditorIsFocused}
      IconComponent={IconComponent}
      createdAt={event.createdAt}
      showCopyButton={showCopyButton}
      copyContent={event.content || ''}
    >
      {messageContent}
    </ConversationEventRowShell>
  )
}
