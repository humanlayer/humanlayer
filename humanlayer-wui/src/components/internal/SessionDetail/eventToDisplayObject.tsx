import { createStarryNight } from '@wooorm/starry-night'
import jsonGrammar from '@wooorm/starry-night/source.json'
import textMd from '@wooorm/starry-night/text.md'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import ReactDiffViewer from 'react-diff-viewer-continued'

import { ConversationEvent, ConversationEventType, ApprovalStatus } from '@/lib/daemon/types'
import { Button } from '@/components/ui/button'
import { Bot, FilePenLine, UserCheck, User, Wrench, Globe } from 'lucide-react'
import { CommandToken } from '@/components/internal/CommandToken'
import { formatToolResult } from './formatToolResult'
import { DiffViewToggle } from './components/DiffViewToggle'
import { DenyForm } from './components/DenyForm'

// TODO(2): Break this monster function into smaller, focused display components
// TODO(2): Extract tool-specific rendering logic
// TODO(2): Separate approval UI logic
// TODO(1): Fix the global starryNight variable anti-pattern
// TODO(3): Add proper TypeScript types for display objects

/* I, Sundeep, don't know how I feel about what's going on here. */
let starryNight: any | null = null

// TODO(3): This should be part of starryNight initialization
function starryNightJson(json: string) {
  try {
    const formatted = JSON.stringify(JSON.parse(json), null, 2)
    const tree = starryNight?.highlight(formatted, 'source.json')
    return tree ? toJsxRuntime(tree, { Fragment, jsx, jsxs }) : <span>{json}</span>
  } catch {
    return null
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
) {
  let subject = null
  let body = null
  let iconComponent = null
  let toolResultContent = null

  const iconClasses = `w-4 h-4 align-middle relative top-[1px] ${event.event_type === ConversationEventType.ToolCall && !event.is_completed ? 'pulse-warning' : ''}`

  // Tool Calls
  if (event.event_type === ConversationEventType.ToolCall) {
    iconComponent = <Wrench className={iconClasses} />

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

    if (event.tool_name === 'Glob') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">{event.tool_name} </span>
          <span className="font-mono text-sm text-muted-foreground">
            <span className="font-bold">{toolInput.pattern}</span> against{' '}
            <span className="font-bold">{toolInput.path}</span>
          </span>
        </span>
      )
    }

    if (event.tool_name === 'Bash') {
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">{event.tool_name} </span>
          <span className="font-mono text-sm text-muted-foreground">
            <CommandToken>{toolInput.command}</CommandToken>
          </span>
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
          <span className="font-mono text-sm text-muted-foreground">to {toolInput.file_path}</span>
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

    if (event.tool_name === 'Write') {
      iconComponent = <FilePenLine className={iconClasses} />
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <div className="mb-2">
            <span className="font-bold mr-2">{event.tool_name}</span>
            <small className="text-xs text-muted-foreground">{toolInput.file_path}</small>
          </div>
          <div className="font-mono text-sm text-muted-foreground">{toolInput.content}</div>
        </span>
      )
    }

    if (event.tool_name === 'WebSearch') {
      iconComponent = <Globe className={iconClasses} />
      const toolInput = JSON.parse(event.tool_input_json!)
      subject = (
        <span>
          <span className="font-bold">Web Search </span>
          <span className="font-mono text-sm text-muted-foreground italic">"{toolInput.query}"</span>
        </span>
      )
    }
  }

  // Approvals
  if (event.approval_status) {
    const approvalStatusToColor = {
      [ApprovalStatus.Pending]: 'text-[var(--terminal-warning)]',
      [ApprovalStatus.Approved]: 'text-[var(--terminal-success)]',
      [ApprovalStatus.Denied]: 'text-[var(--terminal-error)]',
      [ApprovalStatus.Resolved]: 'text-[var(--terminal-success)]',
    }
    iconComponent = <UserCheck className={iconClasses} />
    let previewFile = null

    // In a pending state for a Write tool call, let's display the file contents a little differently
    if (event.tool_name === 'Write' && event.approval_status === ApprovalStatus.Pending) {
      const toolInput = JSON.parse(event.tool_input_json!)
      previewFile = (
        <div className="border border-dashed border-muted-foreground rounded p-2 mt-4">
          <div className="mb-2">
            <span className="font-bold mr-2">Write</span>
            <span className="font-mono text-sm text-muted-foreground">
              to <span className="font-bold">{toolInput.file_path}</span>
            </span>
          </div>
          <div className="font-mono text-sm text-muted-foreground">{toolInput.content}</div>
        </div>
      )
    }

    if (event.tool_name === 'Edit' && event.approval_status === ApprovalStatus.Pending) {
      const toolInput = JSON.parse(event.tool_input_json!)
      previewFile = (
        <div className="border border-dashed border-muted-foreground rounded p-4 mt-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <span className="font-bold mr-2">Edit</span>
              <span className="font-mono text-sm text-muted-foreground">
                to <span className="font-bold">{toolInput.file_path}</span>
              </span>
            </div>
            <DiffViewToggle
              isSplitView={isSplitView ?? true}
              onToggle={onToggleSplitView ?? (() => {})}
            />
          </div>
          <ReactDiffViewer
            oldValue={toolInput.old_string}
            newValue={toolInput.new_string}
            splitView={isSplitView ?? true}
            // For the moment hiding, as line numbers can be confusing
            // when not passing the entire file contents.
            hideLineNumbers={true}
          />
        </div>
      )
    }

    if (event.tool_name === 'MultiEdit' && event.approval_status === ApprovalStatus.Pending) {
      const toolInput = JSON.parse(event.tool_input_json!)
      previewFile = (
        <div className="border border-dashed border-muted-foreground rounded p-4 mt-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <span className="font-bold mr-2">MultiEdit</span>
              <span className="font-mono text-sm text-muted-foreground">
                {toolInput.edits.length} edit{toolInput.edits.length === 1 ? '' : 's'} to{' '}
                <span className="font-bold">{toolInput.file_path}</span>
              </span>
            </div>
            <DiffViewToggle
              isSplitView={isSplitView ?? true}
              onToggle={onToggleSplitView ?? (() => {})}
            />
          </div>
          {toolInput.edits.map((edit: any, index: number) => (
            <div key={index} className="mb-8 last:mb-0">
              {toolInput.edits.length > 1 && (
                <div className="mb-2 text-sm font-medium text-muted-foreground">
                  Edit {index + 1} of {toolInput.edits.length}
                </div>
              )}
              <ReactDiffViewer
                oldValue={edit.old_string}
                newValue={edit.new_string}
                splitView={isSplitView ?? true}
                // For the moment hiding, as line numbers can be confusing
                // when not passing the entire file contents.
                hideLineNumbers={true}
              />
            </div>
          ))}
        </div>
      )
    }

    subject = (
      <span>
        <span className={`font-bold ${approvalStatusToColor[event.approval_status]}`}>
          {event.tool_name}
        </span>
        {event.approval_status === ApprovalStatus.Pending && (
          <span className="ml-2 text-sm text-muted-foreground">(pending)</span>
        )}
        <div className="font-mono text-sm text-muted-foreground">
          Assistant would like to use <span className="font-bold">{event.tool_name}</span>
        </div>
        {!previewFile && <div className="mt-4">{starryNightJson(event.tool_input_json!)}</div>}
        {previewFile}
      </span>
    )

    // Add approve/deny buttons for pending approvals
    if (event.approval_status === ApprovalStatus.Pending && event.approval_id && onApprove && onDeny) {
      const isDenying = denyingApprovalId === event.approval_id
      const isApproving = approvingApprovalId === event.approval_id

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
                  onApprove(event.approval_id!)
                }}
                disabled={isApproving}
              >
                {isApproving
                  ? 'Approving...'
                  : confirmingApprovalId === event.approval_id
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
                    onStartDeny?.(event.approval_id!)
                  }}
                >
                  Deny <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">D</kbd>
                </Button>
              )}
            </>
          ) : (
            <DenyForm approvalId={event.approval_id!} onDeny={onDeny} onCancel={onCancelDeny} />
          )}
        </div>
      )
    }
  }

  if (event.event_type === ConversationEventType.Message) {
    // For assistant messages, show full content without truncation
    if (event.role === 'assistant') {
      const fullContent = event.content || ''
      const contentTree = starryNight?.highlight(fullContent, 'text.md')

      subject = contentTree ? (
        <span>{toJsxRuntime(contentTree, { Fragment, jsx, jsxs })}</span>
      ) : (
        <span>{fullContent}</span>
      )
      body = null // Everything is in subject for assistant messages
    } else {
      // For user messages, keep the existing split behavior
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
  }

  if (event.role === 'assistant') {
    iconComponent = <Bot className={iconClasses} />
  }

  if (event.role === 'user') {
    iconComponent = <User className={iconClasses} />
  }

  // Display tool result content for tool calls
  if (event.event_type === ConversationEventType.ToolCall && toolResult) {
    // For denied approvals, show the denial comment in red
    if (event.approval_status === ApprovalStatus.Denied) {
      subject = (
        <>
          {subject}
          <div className="mt-1 text-sm font-mono flex items-start gap-1">
            <span className="text-muted-foreground/50">⎿</span>
            <span className="text-destructive">
              Denied: {toolResult.tool_result_content || 'No reason provided'}
            </span>
          </div>
        </>
      )
    } else {
      // Normal tool result display
      const resultDisplay = formatToolResult(event.tool_name || '', toolResult)
      if (resultDisplay) {
        // Append to existing subject with indentation
        subject = (
          <>
            {subject}
            <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
              <span className="text-muted-foreground/50">⎿</span>
              <span>
                {resultDisplay}
                {isFocused && <span className="text-xs text-muted-foreground/50 ml-2">[i] expand</span>}
              </span>
            </div>
          </>
        )
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
    isCompleted: event.is_completed,
    iconComponent,
    body,
    created_at: event.created_at,
    toolResultContent,
  }
}

// TODO(2): Initialize starryNight properly on module load
if (!starryNight) {
  createStarryNight([textMd, jsonGrammar]).then(sn => (starryNight = sn))
}
