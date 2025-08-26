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
  User,
  Wrench,
  Globe,
  FileText,
  Terminal,
  Search,
  ListTodo,
  ListChecks,
} from 'lucide-react'
import { CommandToken } from '@/components/internal/CommandToken'
import { formatToolResult } from './formatToolResult'
import { DiffViewToggle } from './components/DiffViewToggle'
import { DenyButtons } from './components/DenyButtons'
import { CustomDiffViewer } from './components/CustomDiffViewer'
import { parseMcpToolName } from '@/utils/formatting'

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

  // logger.log('event', event)
  // Check if this is a thinking message
  const isThinking =
    event.eventType === ConversationEventType.Thinking ||
    (event.role === 'assistant' && event.content?.startsWith('<thinking>'))

  const iconClasses = `w-4 h-4 align-middle relative top-[1px] ${event.eventType === ConversationEventType.ToolCall && !event.isCompleted ? 'pulse-warning' : ''}`

  // Tool Calls
  if (event.eventType === ConversationEventType.ToolCall) {
    iconComponent = getToolIcon(event.toolName, iconClasses)

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
      const displayName = toolInput.subagent_type || 'Task'
      subject = (
        <span>
          <span className="font-bold">{displayName} </span>
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
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.file_path}</span>
        </span>
      )
    }

    if (event.toolName === 'NotebookRead') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.notebook_path}</span>
          {toolInput.cell_id && (
            <span className="text-muted-foreground"> (cell: {toolInput.cell_id})</span>
          )}
        </span>
      )
    }

    if (event.toolName === 'NotebookEdit') {
      const toolInput = JSON.parse(event.toolInputJson!)
      const action = toolInput.edit_mode || 'replace'
      subject = (
        <span>
          <span className="font-bold">{event.toolName} </span>
          <span className="text-muted-foreground">{action} cell in </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.notebook_path}</span>
          {toolInput.cell_id && (
            <span className="text-muted-foreground"> (cell: {toolInput.cell_id})</span>
          )}
        </span>
      )
    }

    if (event.toolName === 'WebSearch') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">Web Search </span>
          <span className="font-mono text-sm text-muted-foreground italic">"{toolInput.query}"</span>
        </span>
      )
    }

    if (event.toolName === 'WebFetch') {
      const toolInput = JSON.parse(event.toolInputJson!)
      subject = (
        <span>
          <span className="font-bold">Web Fetch </span>
          <span className="font-mono text-sm text-muted-foreground">{toolInput.url}</span>
          {toolInput.prompt && (
            <div className="mt-1 text-sm text-muted-foreground italic">"{toolInput.prompt}"</div>
          )}
        </span>
      )
    }

    if (event.toolName === 'ExitPlanMode') {
      const toolInput = JSON.parse(event.toolInputJson!)
      const planLines = toolInput.plan.split('\n').filter((l: string) => l.trim())
      const lineCount = planLines.length

      subject = (
        <span>
          <span className="font-bold">Exit Plan Mode </span>
          <span className="text-sm text-muted-foreground">({lineCount} lines)</span>
        </span>
      )
    }

    // MCP tool handling
    if (event.toolName?.startsWith('mcp__')) {
      const { service, method } = parseMcpToolName(event.toolName)
      const formattedMethod = method.replace(/_/g, ' ')

      const toolInput = event.toolInputJson ? JSON.parse(event.toolInputJson) : {}

      subject = (
        <span>
          <span className="font-bold">
            {service} - {formattedMethod}{' '}
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
    // Keep the original tool icon instead of overriding with UserCheck
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

    if (event.toolName === 'NotebookEdit') {
      const toolInput = JSON.parse(event.toolInputJson!)
      const action = toolInput.edit_mode || 'replace'

      previewFile = (
        <div className={`border ${getBorderClass()} rounded p-4 mt-4`}>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" />
            <span className="font-medium text-sm">Notebook Cell {action}</span>
          </div>
          <div className="font-mono text-xs text-muted-foreground mb-2">{toolInput.notebook_path}</div>
          {toolInput.cell_id && (
            <div className="text-xs text-muted-foreground mb-2">Cell ID: {toolInput.cell_id}</div>
          )}
          {toolInput.cell_type && (
            <div className="text-xs text-muted-foreground mb-2">Cell Type: {toolInput.cell_type}</div>
          )}
          {action !== 'delete' && (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-1">New Content:</div>
              <pre className="bg-muted/50 p-2 rounded text-xs overflow-x-auto">
                <code>{toolInput.new_source}</code>
              </pre>
            </div>
          )}
        </div>
      )
    }

    if (event.toolName === 'ExitPlanMode') {
      const toolInput = JSON.parse(event.toolInputJson!)

      previewFile = (
        <div className="mt-2">
          <MarkdownRenderer content={toolInput.plan} sanitize={false} />
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
            <DenyButtons onCancel={onCancelDeny} isDenying={isDenying} />
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

  const InfoExpand = (
    <span className={`text-xs text-muted-foreground/50 ml-2 ${isFocused ? 'visible' : 'invisible'}`}>
      <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
    </span>
  )

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
                Denial Reason: {toolResult.toolResultContent || 'No reason provided'}
                {InfoExpand}
              </span>
            </div>
          </>
        )
      } else {
        // Normal tool result display
        const resultDisplay = formatToolResult(event.toolName || '', toolResult, event)
        if (resultDisplay) {
          // Append to existing subject with indentation
          subject = (
            <>
              {subject}
              <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
                <span className="text-muted-foreground/50">⎿</span>
                <span>
                  {resultDisplay}
                  {InfoExpand}
                </span>
              </div>
            </>
          )
        }
      }
    } else if (
      isFocused &&
      event.toolName === 'WebFetch' &&
      event.approvalStatus !== ApprovalStatus.Pending
    ) {
      // Show expand hint for WebFetch which has rich content even without results (but not when pending)
      subject = (
        <>
          {subject}
          <span className="text-xs text-muted-foreground/50 ml-2">
            <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
          </span>
        </>
      )
    }
  }

  if (subject === null) {
    // logger.warn('Unknown subject for event', event)
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
export function getToolIcon(toolName: string | undefined, className = 'w-3.5 h-3.5'): React.ReactNode {
  if (!toolName) return <Wrench className={className} />

  // Handle MCP tools
  if (toolName.startsWith('mcp__')) {
    return <Globe className={className} />
  }

  // Handle regular tools
  switch (toolName) {
    case 'Edit':
    case 'MultiEdit':
      return <FilePenLine className={className} />
    case 'Read':
      return <FileText className={className} />
    case 'Write':
      return <FilePenLine className={className} />
    case 'Bash':
      return <Terminal className={className} />
    case 'Grep':
      return <Search className={className} />
    case 'TodoWrite':
      return <ListTodo className={className} />
    case 'WebSearch':
      return <Globe className={className} />
    case 'WebFetch':
      return <Globe className={className} />
    case 'ExitPlanMode':
      return <ListChecks className={className} />
    case 'NotebookRead':
    case 'NotebookEdit':
      return <FileText className={className} />
    default:
      return <Wrench className={className} />
  }
}

// Helper function for timestamp formatting
function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString()
}
