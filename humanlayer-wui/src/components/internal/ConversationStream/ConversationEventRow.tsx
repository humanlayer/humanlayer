import * as React from 'react'
import type {
  ConversationEvent,
  ConversationEventEventTypeEnum,
  ConversationEventRoleEnum,
} from '@humanlayer/hld-sdk'
import { ConversationEventType, ConversationRole } from '@/lib/daemon'
import { Bot, User, Copy, Terminal, Wrench } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAbsoluteTimestamp, formatTimestamp } from '@/utils/formatting'
import { copyToClipboard } from '@/utils/clipboard'
import { Button } from '@/components/ui/button'
import {
  UserMessageContent,
  AssistantMessageContent,
  UnknownMessageContent,
  BashToolCallContent,
  ReadToolCallContent,
  WriteToolCallContent,
  EditToolCallContent,
  GrepToolCallContent,
  GlobToolCallContent,
  LSToolCallContent,
  TaskToolCallContent,
  TodoWriteToolCallContent,
} from './EventContent'
import { BashToolInput, parseToolInput, ToolName } from './EventContent/types'
import type { ReadToolInput, WriteToolInput, EditToolInput } from './EventContent'

// Interface definitions for search tools
interface GrepToolInput {
  pattern: string
  path?: string
  output_mode?: 'content' | 'files_with_matches' | 'count'
  glob?: string
  type?: string
  '-A'?: number
  '-B'?: number
  '-C'?: number
  '-i'?: boolean
  '-n'?: boolean
  head_limit?: number
  multiline?: boolean
}

interface GlobToolInput {
  pattern: string
  path?: string
}

interface LSToolInput {
  path: string
  recursive?: boolean
}

interface TaskToolInput {
  description: string
  prompt: string
  subagent_type: string
}

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

interface TodoWriteToolInput {
  todos: TodoItem[]
}

const getIcon = (
  type: ConversationEventEventTypeEnum,
  role: ConversationEventRoleEnum | undefined,
  isCompleted: boolean | undefined,
  toolName?: string,
) => {
  const iconClasses = `w-4 h-4 align-middle relative top-[1px] ${type === ConversationEventType.ToolCall && !isCompleted ? 'pulse-warning' : ''}`

  if (type === ConversationEventType.ToolCall) {
    // Handle tool-specific icons
    if (toolName === 'Bash') {
      return <Terminal className={iconClasses} />
    }
    // Default tool icon
    return <Wrench className={iconClasses} />
  }

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
          onClick={e => {
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
  toolResult?: ConversationEvent
  setFocusedEventId: (eventId: number | null) => void
  setFocusSource: (source: 'mouse' | 'keyboard' | null) => void
  shouldIgnoreMouseEvent: () => boolean
  isFocused: boolean
  isLast: boolean
  responseEditorIsFocused: boolean
  fileSnapshot?: string // For Write tool diff preview
}

export function ConversationEventRow({
  event,
  toolResult,
  ref,
  setFocusedEventId,
  setFocusSource,
  shouldIgnoreMouseEvent,
  isFocused,
  isLast,
  responseEditorIsFocused,
  fileSnapshot,
}: ConversationEventRowProps) {
  const IconComponent = getIcon(event.eventType, event.role, event.isCompleted, event.toolName)

  let messageContent = null
  const isThinking = Boolean(
    event.eventType === ConversationEventType.Thinking ||
      (event.role === ConversationRole.Assistant && event.content?.startsWith('<thinking>')),
  )

  /* Determine EventContent type */

  if (event.eventType === ConversationEventType.ToolCall) {
    // Handle tool calls
    if (event.toolName === ToolName.Bash) {
      const toolInput = parseToolInput<BashToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <BashToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
          />
        )
      }
    } else if (event.toolName === ToolName.Read) {
      const toolInput = parseToolInput<ReadToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <ReadToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
          />
        )
      }
    } else if (event.toolName === ToolName.Write) {
      const toolInput = parseToolInput<WriteToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <WriteToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
            fileSnapshot={fileSnapshot}
          />
        )
      }
    } else if (event.toolName === ToolName.Edit) {
      const toolInput = parseToolInput<EditToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <EditToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
          />
        )
      }
    } else if (event.toolName === ToolName.Grep) {
      const toolInput = parseToolInput<GrepToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <GrepToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
          />
        )
      }
    } else if (event.toolName === ToolName.Glob) {
      const toolInput = parseToolInput<GlobToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <GlobToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
          />
        )
      }
    } else if (event.toolName === ToolName.LS) {
      const toolInput = parseToolInput<LSToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <LSToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
          />
        )
      }
    } else if (event.toolName === ToolName.Task) {
      const toolInput = parseToolInput<TaskToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <TaskToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
          />
        )
      }
    } else if (event.toolName === ToolName.TodoWrite) {
      const toolInput = parseToolInput<TodoWriteToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <TodoWriteToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
          />
        )
      }
    }
  } else if (event.role === ConversationRole.User) {
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
