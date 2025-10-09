import * as React from 'react'
import type {
  ConversationEvent,
  ConversationEventEventTypeEnum,
  ConversationEventRoleEnum,
} from '@humanlayer/hld-sdk'
import { ConversationEventType, ConversationRole } from '@/lib/daemon'
import { SentryErrorBoundary } from '@/components/ErrorBoundary'
import {
  Bot,
  User,
  Copy,
  Terminal,
  Wrench,
  ListTodo,
  Globe,
  Search,
  FilePenLine,
  ListChecks,
  FileText,
  List,
  Brain,
  AlertCircle,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAbsoluteTimestamp, formatTimestamp } from '@/utils/formatting'
import { copyToClipboard } from '@/utils/clipboard'
import { hasTextSelection } from '@/utils/selection'
import { Button } from '@/components/ui/button'
import {
  UserMessageContent,
  AssistantMessageContent,
  UnknownMessageContent,
  BashToolCallContent,
  BashOutputToolCallContent,
  ReadToolCallContent,
  WriteToolCallContent,
  EditToolCallContent,
  MultiEditToolCallContent,
  NotebookReadToolCallContent,
  NotebookEditToolCallContent,
  ExitPlanModeToolCallContent,
  GrepToolCallContent,
  GlobToolCallContent,
  LSToolCallContent,
  TaskToolCallContent,
  TodoWriteToolCallContent,
  WebSearchToolCallContent,
  WebFetchToolCallContent,
  ApprovalWrapper,
  MCPToolCallContent,
  UnknownToolCallContent,
} from './EventContent'
import { BashToolInput, parseToolInput, ToolName } from './EventContent/types'
import type {
  ReadToolInput,
  WriteToolInput,
  EditToolInput,
  MultiEditToolInput,
  NotebookReadToolInput,
  NotebookEditToolInput,
  ExitPlanModeToolInput,
} from './EventContent'

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

interface WebSearchToolInput {
  query: string
  allowed_domains?: string[]
  blocked_domains?: string[]
}

interface WebFetchToolInput {
  url: string
  prompt?: string
}

const getIcon = (
  type: ConversationEventEventTypeEnum,
  role: ConversationEventRoleEnum | undefined,
  isCompleted: boolean | undefined,
  toolName?: string,
  isThinking?: boolean,
) => {
  const iconClasses = `w-4 h-4 align-middle relative top-[1px] ${type === ConversationEventType.ToolCall && !isCompleted ? 'pulse-warning' : ''}`

  if (type === ConversationEventType.ToolCall) {
    if (toolName?.startsWith('mcp__')) {
      return <Globe className={iconClasses} />
    }

    // Handle tool-specific icons
    switch (toolName) {
      case 'Edit':
      case 'MultiEdit':
        return <FilePenLine className={iconClasses} />
      case 'Read':
        return <FileText className={iconClasses} />
      case 'Write':
        return <FilePenLine className={iconClasses} />
      case 'Bash':
        return <Terminal className={iconClasses} />
      case 'LS':
        return <List className={iconClasses} />
      case 'Glob':
      case 'Grep':
        return <Search className={iconClasses} />
      case 'TodoWrite':
        return <ListTodo className={iconClasses} />
      case 'WebSearch':
        return <Globe className={iconClasses} />
      case 'WebFetch':
        return <Globe className={iconClasses} />
      case 'ExitPlanMode':
        return <ListChecks className={iconClasses} />
      case 'NotebookRead':
      case 'NotebookEdit':
        return <FileText className={iconClasses} />
      default:
        return <Wrench className={iconClasses} />
    }
  }

  if (role === ConversationRole.User) {
    return <User className={iconClasses} />
  }

  if (role === ConversationRole.Assistant) {
    if (isThinking) {
      return <Brain className={iconClasses} />
    }

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
  eventType,
  onClick,
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
  isGroupItem,
}: {
  children: React.ReactNode
  eventId: number
  eventType: ConversationEventEventTypeEnum
  onClick?: () => void
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
  isGroupItem?: boolean
}) {
  let outerContainerClasses = ['group', 'p-4', 'transition-colors', 'duration-200', 'border-l-2']

  // Add cursor-pointer for clickable tool calls
  if (eventType === ConversationEventType.ToolCall && onClick) {
    outerContainerClasses.push('cursor-pointer hover:bg-muted/5')
  }

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

  if (isGroupItem) {
    outerContainerClasses = outerContainerClasses.filter(c => c !== 'border-b' && c !== 'p-4')
    outerContainerClasses.push('p-2')
    outerContainerClasses.push('pl-4')
  }

  return (
    <div
      ref={ref}
      className={outerContainerClasses.join(' ')}
      data-event-id={eventId}
      onClick={() => {
        // Only handle click for tool calls with a handler
        if (eventType === ConversationEventType.ToolCall && onClick) {
          // Don't open modal if user has selected text
          if (hasTextSelection()) {
            return
          }
          onClick()
        }
      }}
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
  isGroupItem?: boolean
  fileSnapshot?: string // For Write tool diff preview
  // Modal expansion props
  setExpandedToolResult?: (event: ConversationEvent | null) => void
  setExpandedToolCall?: (event: ConversationEvent | null) => void
  // Approval-related props
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string, reason: string) => void
  approvingApprovalId?: string | null
  denyingApprovalId?: string | null
  setDenyingApprovalId?: (approvalId: string | null) => void
  onCancelDeny?: () => void
}

function ConversationEventRowInner({
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
  setExpandedToolResult,
  setExpandedToolCall,
  isGroupItem,
  onApprove,
  onDeny,
  approvingApprovalId,
  denyingApprovalId,
  setDenyingApprovalId,
  onCancelDeny,
}: ConversationEventRowProps) {
  const isThinking = Boolean(
    event.eventType === ConversationEventType.Thinking ||
      (event.role === ConversationRole.Assistant && event.content?.startsWith('<thinking>')),
  )
  const IconComponent = getIcon(
    event.eventType,
    event.role,
    event.isCompleted,
    event.toolName,
    isThinking,
  )

  let messageContent = null

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
            isGroupItem={isGroupItem}
          />
        )
      }
    } else if (event.toolName === ToolName.BashOutput) {
      const toolInput = parseToolInput<Record<string, any>>(event.toolInputJson)
      messageContent = (
        <BashOutputToolCallContent
          toolName={event.toolName}
          toolInput={toolInput}
          isCompleted={event.isCompleted}
          toolResultContent={toolResult?.toolResultContent}
          isFocused={isFocused}
          isGroupItem={isGroupItem}
        />
      )
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
            isGroupItem={isGroupItem}
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
            isGroupItem={isGroupItem}
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
            isGroupItem={isGroupItem}
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
            isGroupItem={isGroupItem}
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
            isGroupItem={isGroupItem}
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
            isGroupItem={isGroupItem}
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
            isGroupItem={isGroupItem}
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
            isGroupItem={isGroupItem}
          />
        )
      }
    } else if (event.toolName === ToolName.WebSearch) {
      const toolInput = parseToolInput<WebSearchToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <WebSearchToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
            isGroupItem={isGroupItem}
          />
        )
      }
    } else if (event.toolName === ToolName.WebFetch) {
      const toolInput = parseToolInput<WebFetchToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <WebFetchToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
            isGroupItem={isGroupItem}
          />
        )
      }
    } else if (event.toolName === ToolName.MultiEdit) {
      const toolInput = parseToolInput<MultiEditToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <MultiEditToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
            fileSnapshot={fileSnapshot ? { content: fileSnapshot } : undefined}
            isGroupItem={isGroupItem}
          />
        )
      }
    } else if (event.toolName === ToolName.NotebookRead) {
      const toolInput = parseToolInput<NotebookReadToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <NotebookReadToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
            isGroupItem={isGroupItem}
          />
        )
      }
    } else if (event.toolName === ToolName.NotebookEdit) {
      const toolInput = parseToolInput<NotebookEditToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <NotebookEditToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
            isGroupItem={isGroupItem}
          />
        )
      }
    } else if (event.toolName === ToolName.ExitPlanMode) {
      const toolInput = parseToolInput<ExitPlanModeToolInput>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <ExitPlanModeToolCallContent
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
            isGroupItem={isGroupItem}
          />
        )
      }
    } else if (event.toolName?.startsWith('mcp__')) {
      // Handle MCP tools generically
      const toolInput = parseToolInput<Record<string, any>>(event.toolInputJson)
      if (toolInput) {
        messageContent = (
          <MCPToolCallContent
            toolName={event.toolName}
            toolInput={toolInput}
            approvalStatus={event.approvalStatus}
            isCompleted={event.isCompleted}
            toolResultContent={toolResult?.toolResultContent}
            isFocused={isFocused}
            isGroupItem={isGroupItem}
          />
        )
      }
    } else {
      // Fallback for unmigrated tools
      // Log warning for unmigrated tool in development
      if (import.meta.env.DEV) {
        console.warn(`Unmigrated tool: ${event.toolName}`)
      }
      // Parse tool input generically
      const toolInput = parseToolInput<Record<string, any>>(event.toolInputJson)
      messageContent = (
        <UnknownToolCallContent
          toolName={event.toolName}
          toolInput={toolInput}
          isCompleted={event.isCompleted}
          toolResultContent={toolResult?.toolResultContent}
          isFocused={isFocused}
          isGroupItem={isGroupItem}
        />
      )
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

  // Check if we need approval UI
  const needsApproval =
    event.eventType === ConversationEventType.ToolCall &&
    event.approvalStatus === 'pending' &&
    event.approvalId &&
    onApprove &&
    onDeny

  return (
    <ConversationEventRowShell
      ref={ref}
      eventId={event.id}
      eventType={event.eventType}
      onClick={
        event.eventType === ConversationEventType.ToolCall &&
        setExpandedToolResult &&
        setExpandedToolCall
          ? () => {
              setExpandedToolResult(toolResult || null)
              setExpandedToolCall(event)
            }
          : undefined
      }
      shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
      setFocusedEventId={setFocusedEventId}
      setFocusSource={setFocusSource}
      isFocused={isFocused}
      isLast={isLast}
      isThinking={isThinking}
      responseEditorIsFocused={responseEditorIsFocused}
      isGroupItem={isGroupItem}
      IconComponent={IconComponent}
      createdAt={event.createdAt}
      showCopyButton={showCopyButton}
      copyContent={event.content || ''}
    >
      {needsApproval ? (
        <ApprovalWrapper
          event={event}
          approvalStatus={event.approvalStatus}
          onApprove={() => onApprove(event.approvalId!)}
          onDeny={(reason: string) => onDeny(event.approvalId!, reason)}
          isApproving={approvingApprovalId === event.approvalId}
          isDenying={denyingApprovalId === event.approvalId}
          onStartDeny={() => setDenyingApprovalId?.(event.approvalId!)}
          onCancelDeny={onCancelDeny}
        >
          {messageContent}
        </ApprovalWrapper>
      ) : (
        messageContent
      )}
    </ConversationEventRowShell>
  )
}

// Custom error fallback component for ConversationEventRow
function ConversationEventRowErrorFallback({
  error,
  resetError,
}: {
  error: Error
  resetError: () => void
}) {
  return (
    <div className="flex flex-col space-y-2 p-3 text-sm text-muted-foreground">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4" />
          <span>Error rendering event</span>
        </div>
        <Button onClick={resetError} variant="outline" size="sm" className="h-6 text-xs">
          Reload Session
        </Button>
      </div>
      <div className="text-xs text-destructive">{error.message}</div>
    </div>
  )
}

// Export wrapped version with error boundary
export function ConversationEventRow(props: ConversationEventRowProps) {
  return (
    <SentryErrorBoundary
      fallback={ConversationEventRowErrorFallback}
      componentName="ConversationEventRow"
      handleRefresh={() => {
        // Extract session ID from URL and reload
        const sessionId = window.location.hash.match(/sessions\/([^/?]+)/)?.[1]
        if (sessionId) {
          window.location.href = `/#/sessions/${sessionId}`
        } else {
          window.location.href = '/#/'
        }
      }}
      refreshButtonText="Reload Session"
    >
      <ConversationEventRowInner {...props} />
    </SentryErrorBoundary>
  )
}
