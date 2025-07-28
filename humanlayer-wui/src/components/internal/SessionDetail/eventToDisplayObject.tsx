import React from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'

import {
  ConversationEvent,
  ConversationEventType,
  ApprovalStatus,
  FileSnapshotInfo,
} from '@/lib/daemon/types'
import { Button } from '@/components/ui/button'
import {
  Bot,
  Brain,
  FilePenLine,
  UserCheck,
  User,
  Wrench,
  Globe,
  FileText,
  Terminal,
  Search,
  ListTodo,
} from 'lucide-react'
import { CommandToken } from '@/components/internal/CommandToken'
import { formatToolResult } from './formatToolResult'
import { DiffViewToggle } from './components/DiffViewToggle'
import { DenyForm } from './components/DenyForm'
import { CustomDiffViewer } from './components/CustomDiffViewer'

// TODO(2): Break this monster function into smaller, focused display components
// TODO(2): Extract tool-specific rendering logic
// TODO(2): Separate approval UI logic
// TODO(3): Add proper TypeScript types for display objects

function formatJson(json: string): React.ReactNode {
  try {
    const formatted = JSON.stringify(JSON.parse(json), null, 2)
    return <MarkdownRenderer content={`\`\`\`json\n${formatted}\n\`\`\``} sanitize={false} />
  } catch {
    return <span className="text-muted-foreground">{json}</span>
  }
}

/* This will almost certainly become something else over time, but for the moment while we get a feel for the data, this is okay */
export function eventToDisplayObject(
  event: ConversationEvent,
  onApprove?: (approvalId: string) => void,
  onDeny?: (approvalId: string, reason: string) => void,
  denyingApprovalId?: string | null,
  onStartDeny?: (approvalId: string) => void,
  onCancelDeny?: () => void,
  approvingApprovalId?: string | null,
  confirmingApprovalId?: string | null,
  isSplitView?: boolean,
  onToggleSplitView?: () => void,
  toolResult?: ConversationEvent,
  isFocused?: boolean,
  getSnapshot?: (filePath: string) => FileSnapshotInfo | undefined,
) {
  let subject = null
  let body = null
  let iconComponent = null
  let toolResultContent = null

  // console.log('event', event)
  // Check if this is a thinking message
  const isThinking =
    event.eventType === ConversationEventType.Thinking ||
    (event.role === 'assistant' && event.content?.startsWith('<thinking>'))

  const iconClasses = `w-4 h-4 align-middle relative top-[1px] ${event.eventType === ConversationEventType.ToolCall && !event.isCompleted ? 'pulse-warning' : ''}`

  // Tool Calls
  if (event.eventType === ConversationEventType.ToolCall) {
    iconComponent = <Wrench className={iconClasses} />

    // Claude Code converts "LS" to "List"
    if (event.toolName === 'LS') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">List </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.path}</span>
        </span>
      )
    }

    if (event.toolName === 'Read') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.file_path}</span>
        </span>
      )
    }

    if (event.toolName === 'Glob') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">
            <span className="font-bold">{toolInput.pattern}</span> against{' '}
            <span className="font-bold">{toolInput.path}</span>
          </span>
        </span>
      )
    }

    if (event.toolName === 'Bash') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <div className="flex items-baseline gap-2">
            <span className="font-bold">{event.toolName} </span>
            {toolInput.description && (
              <span className="text-sm text-muted-foreground">{toolInput.description}</span>
            )}
          </div>
          <div className="mt-1 font-mono text-sm text-muted-foreground">
            <CommandToken>{toolInput.command}</CommandToken>
          </div>
        </span>
      )
    }

    if (event.toolName === 'Task') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.description}</span>
        </span>
      )
    }

    if (event.toolName === 'TodoWrite') {
      const toolInput = JSON.parse(event.toolInputJson!)
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

    if (event.toolName === 'Edit') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">to {toolInput.file_path}</span>
        </span>
      )
    }

    if (event.toolName === 'MultiEdit') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">
            {toolInput.edits.length} edit{toolInput.edits.length === 1 ? '' : 's'} to{' '}
            {toolInput.file_path}
          </span>
        </span>
      )
    }

    if (event.toolName === 'Grep') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.pattern}</span>
        </span>
      )
    }

    if (event.toolName === 'Write') {
      iconComponent = <FilePenLine className={iconClasses} />
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.file_path}</span>
        </span>
      )
    }

    if (event.toolName === 'WebSearch') {
      iconComponent = <Globe className={iconClasses} />
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">Web Search </span>
          <span className="font-mono text-sm text-muted-foreground italic">"{toolInput.query}"</span>
        </span>
      )
    }

    // MCP tool handling
    if (event.toolName?.startsWith('mcp__')) {
      // Parse the MCP tool name: mcp__service__method
      const parts = event.toolName.split('__')
      const service = parts[1] || 'unknown'
      const method = parts.slice(2).join('__') || 'unknown' // Handle methods with __ in name

      const toolInput = event.toolInputJson ? JSON.parse(event.toolInputJson) : {}

      subject = (
        <span>
          <span className="font-bold">
            {service} - {method}{' '}
          </span>
          <span className="font-mono text-sm text-muted-foreground">
            {/* Show first parameter if it's simple (string/number) */}
            {toolInput && typeof toolInput === 'object' && Object.keys(toolInput).length > 0 && (
              <span className="text-muted-foreground/70">
                (
                {Object.entries(toolInput)
                  .slice(0, 2) // Show max 2 params
                  .map(([key, value]) => {
                    if (typeof value === 'string' || typeof value === 'number') {
                      return `${key}: "${value}"`
                    }
                    return `${key}: ...`
                  })
                  .join(', ')}
                {Object.keys(toolInput).length > 2 && ', ...'})
              </span>
            )}
          </span>
        </span>
      )
    }
  }

  // Store the formatted subject before approval handling overwrites it
  const formattedToolSubject = subject

  // Approvals
  if (event.approvalStatus) {
    const approvalStatusToColor: Record<string, string> = {
      [ApprovalStatus.Pending]: 'text-[var(--terminal-warning)]',
      [ApprovalStatus.Approved]: 'text-[var(--terminal-success)]',
      [ApprovalStatus.Denied]: 'text-[var(--terminal-error)]',
      resolved: 'text-[var(--terminal-success)]', // Add resolved status
    }
    iconComponent = <UserCheck className={iconClasses} />
    let previewFile = null

    // Get border class based on approval status
    const getBorderClass = () => {
      switch (event.approvalStatus) {
        case ApprovalStatus.Pending:
          return 'border-dashed border-muted-foreground'
        case ApprovalStatus.Approved:
          return 'border-solid border-[var(--terminal-success)]'
        case ApprovalStatus.Denied:
          return 'border-solid border-[var(--terminal-error)]'
        default:
          return 'border-dashed border-muted-foreground'
      }
    }

    // For Write tool calls, display the file contents in a nice format
    if (event.toolName === 'Write') {
      const toolInput = JSON.parse(event.toolInputJson!)
      const snapshot = getSnapshot?.(toolInput.file_path)

      previewFile = (
        <div className={`border ${getBorderClass()} rounded p-4 mt-4`}>
          <div className="mb-4">
            {event.approvalStatus ? (
              <span className="font-mono text-sm text-muted-foreground">
                <span className="font-bold">{toolInput.file_path}</span>
              </span>
            ) : (
              <>
                <span className="font-bold mr-2">Write</span>
                <span className="font-mono text-sm text-muted-foreground">
                  to <span className="font-bold">{toolInput.file_path}</span>
                </span>
              </>
            )}
          </div>
          <CustomDiffViewer
            fileContents={snapshot?.content || ''}
            edits={[{ oldValue: snapshot?.content || '', newValue: toolInput.content }]}
            splitView={false}
          />
          {snapshot && (
            <div className="mt-2 text-xs text-muted-foreground">
              Overwriting file from: {formatTimestamp(snapshot.created_at)}
            </div>
          )}
        </div>
      )
    }

    if (event.toolName === 'Edit') {
      const toolInput = JSON.parse(event.toolInputJson!)
      const snapshot = getSnapshot?.(toolInput.file_path)

      previewFile = (
        <div className={`border ${getBorderClass()} rounded p-4 mt-4`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              {event.approvalStatus ? (
                <span className="font-mono text-sm text-muted-foreground">
                  <span className="font-bold">{toolInput.file_path}</span>
                </span>
              ) : (
                <>
                  <span className="font-bold mr-2">Edit</span>
                  <span className="font-mono text-sm text-muted-foreground">
                    to <span className="font-bold">{toolInput.file_path}</span>
                  </span>
                </>
              )}
            </div>
            {event.approvalStatus === ApprovalStatus.Pending && (
              <DiffViewToggle
                isSplitView={isSplitView ?? false}
                onToggle={onToggleSplitView ?? (() => {})}
              />
            )}
          </div>
          <CustomDiffViewer
            fileContents={snapshot?.content}
            edits={[{ oldValue: toolInput.old_string, newValue: toolInput.new_string }]}
            splitView={isSplitView ?? false}
          />
          {snapshot && (
            <div className="mt-2 text-xs text-muted-foreground">
              Snapshot from: {formatTimestamp(snapshot.created_at)}
            </div>
          )}
        </div>
      )
    }

    if (event.toolName === 'MultiEdit') {
      const toolInput = JSON.parse(event.toolInputJson!)
      const snapshot = getSnapshot?.(toolInput.file_path)
      const allEdits = toolInput.edits.map((e: any) => ({
        oldValue: e.old_string,
        newValue: e.new_string,
      }))

      previewFile = (
        <div className={`border ${getBorderClass()} rounded p-4 mt-4`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              {event.approvalStatus ? (
                <span className="font-mono text-sm text-muted-foreground">
                  {toolInput.edits.length} edit{toolInput.edits.length === 1 ? '' : 's'} to{' '}
                  <span className="font-bold">{toolInput.file_path}</span>
                </span>
              ) : (
                <>
                  <span className="font-bold mr-2">MultiEdit</span>
                  <span className="font-mono text-sm text-muted-foreground">
                    {toolInput.edits.length} edit{toolInput.edits.length === 1 ? '' : 's'} to{' '}
                    <span className="font-bold">{toolInput.file_path}</span>
                  </span>
                </>
              )}
            </div>
            {event.approvalStatus === ApprovalStatus.Pending && (
              <DiffViewToggle
                isSplitView={isSplitView ?? false}
                onToggle={onToggleSplitView ?? (() => {})}
              />
            )}
          </div>
          <CustomDiffViewer
            fileContents={snapshot?.content}
            edits={allEdits}
            splitView={isSplitView ?? false}
          />
          {snapshot && (
            <div className="mt-2 text-xs text-muted-foreground">
              Snapshot from: {formatTimestamp(snapshot.created_at)}
            </div>
          )}
        </div>
      )
    }

    // If we have a formatted subject from tool-specific rendering, use it
    if (formattedToolSubject) {
      subject = (
        <span>
          <div className="flex items-baseline gap-2">
            <span className={`${approvalStatusToColor[event.approvalStatus]}`}>
              {formattedToolSubject}
            </span>
            {event.approvalStatus === ApprovalStatus.Pending && (
              <span className="text-sm text-muted-foreground">(needs approval)</span>
            )}
          </div>
          {previewFile}
        </span>
      )
    } else {
      // Fallback to original behavior for tools without special formatting
      subject = (
        <span>
          <span className={`font-bold ${approvalStatusToColor[event.approvalStatus]}`}>
            {event.toolName}
          </span>
          {event.approvalStatus === ApprovalStatus.Pending && (
            <span className="ml-2 text-sm text-muted-foreground">(needs approval)</span>
          )}
          {!previewFile && <div className="mt-4">{formatJson(event.toolInputJson!)}</div>}
          {previewFile}
        </span>
      )
    }

    // Add approve/deny buttons for pending approvals
    if (event.approvalStatus === ApprovalStatus.Pending && event.approvalId && onApprove && onDeny) {
      const isDenying = denyingApprovalId === event.approvalId
      const isApproving = approvingApprovalId === event.approvalId

      body = (
        <div className="mt-4 flex gap-2 justify-end">
          {!isDenying ? (
            <>
              <Button
                className={`cursor-pointer`}
                size="sm"
                variant={isApproving ? 'outline' : 'default'}
                onClick={e => {
                  e.stopPropagation()
                  onApprove(event.approvalId!)
                }}
                disabled={isApproving}
              >
                {isApproving
                  ? 'Approving...'
                  : confirmingApprovalId === event.approvalId
                    ? 'Approve?'
                    : 'Approve'}{' '}
                <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">A</kbd>
              </Button>
              {!isApproving && (
                <Button
                  className="cursor-pointer"
                  size="sm"
                  variant="destructive"
                  onClick={e => {
                    e.stopPropagation()
                    onStartDeny?.(event.approvalId!)
                  }}
                >
                  Deny <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">D</kbd>
                </Button>
              )}
            </>
          ) : (
            <DenyForm approvalId={event.approvalId!} onDeny={onDeny} onCancel={onCancelDeny} />
          )}
        </div>
      )
    }
  }

  if (event.eventType === ConversationEventType.Thinking) {
    // Thinking messages are always from assistant
    const fullContent = (event.content || '').trim()

    subject = (
      <div className="text-muted-foreground italic">
        <MarkdownRenderer content={fullContent} />
      </div>
    )
    body = null // Everything is in subject for thinking messages
  }

  if (event.eventType === ConversationEventType.Message) {
    // For assistant messages, show full content without truncation
    if (event.role === 'assistant') {
      const fullContent = event.content || ''

      subject = (
        <div className={isThinking ? 'text-muted-foreground' : ''}>
          <MarkdownRenderer content={fullContent} />
        </div>
      )
      body = null // Everything is in subject for assistant messages
    } else {
      // For user messages, keep the existing split behavior
      const subjectText = event.content?.split('\n')[0] || ''
      const bodyText = event.content?.split('\n').slice(1).join('\n') || ''

      subject = <MarkdownRenderer content={subjectText} />
      body = <MarkdownRenderer content={bodyText} />
    }
  }

  if (event.eventType === ConversationEventType.Thinking) {
    iconComponent = <Brain className={iconClasses} />
  } else if (event.role === 'assistant') {
    iconComponent = <Bot className={iconClasses} />
  }

  if (event.role === 'user') {
    iconComponent = <User className={iconClasses} />
  }

  // Display tool result content for tool calls
  if (event.eventType === ConversationEventType.ToolCall) {
    if (toolResult) {
      // For denied approvals, show the denial comment in red
      if (event.approvalStatus === ApprovalStatus.Denied) {
        subject = (
          <>
            {subject}
            <div className="mt-1 text-sm font-mono flex items-start gap-1">
              <span className="text-muted-foreground/50">⎿</span>
              <span className="text-destructive">
                Denied: {toolResult.toolResultContent || 'No reason provided'}
              </span>
            </div>
          </>
        )
      } else {
        // Normal tool result display
        const resultDisplay = formatToolResult(event.toolName || '', toolResult)
        if (resultDisplay) {
          // Append to existing subject with indentation
          subject = (
            <>
              {subject}
              <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
                <span className="text-muted-foreground/50">⎿</span>
                <span>
                  {resultDisplay}
                  {isFocused && (
                    <span className="text-xs text-muted-foreground/50 ml-2">
                      <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
                    </span>
                  )}
                </span>
              </div>
            </>
          )
        }
      }
    }
  }

  if (subject === null) {
    // console.warn('Unknown subject for event', event)
    subject = <span>Unknown Subject</span>
  }

  // TODO(3): Add proper return type interface
  return {
    id: event.id,
    role: event.role,
    subject,
    isCompleted: event.isCompleted,
    iconComponent,
    body,
    created_at: event.createdAt,
    toolResultContent,
    isThinking,
  }
}

// Export icon mapping function for reuse in modal
export function getToolIcon(toolName: string | undefined): React.ReactNode {
  if (!toolName) return <Wrench className="w-3.5 h-3.5" />

  // Handle MCP tools
  if (toolName.startsWith('mcp__')) {
    return <Globe className="w-3.5 h-3.5" />
  }

  // Handle regular tools
  switch (toolName) {
    case 'Edit':
    case 'MultiEdit':
      return <FilePenLine className="w-3.5 h-3.5" />
    case 'Read':
      return <FileText className="w-3.5 h-3.5" />
    case 'Write':
      return <FilePenLine className="w-3.5 h-3.5" />
    case 'Bash':
      return <Terminal className="w-3.5 h-3.5" />
    case 'Grep':
      return <Search className="w-3.5 h-3.5" />
    case 'TodoWrite':
      return <ListTodo className="w-3.5 h-3.5" />
    case 'WebSearch':
      return <Globe className="w-3.5 h-3.5" />
    default:
      return <Wrench className="w-3.5 h-3.5" />
  }
}

// Helper function for timestamp formatting
function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString()
}
