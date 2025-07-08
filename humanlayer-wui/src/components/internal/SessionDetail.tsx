import { createStarryNight } from '@wooorm/starry-night'
import jsonGrammar from '@wooorm/starry-night/source.json'
import textMd from '@wooorm/starry-night/text.md'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import React, { Suspense, useEffect, useRef, useState, Component, ReactNode } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import keyBy from 'lodash.keyby'

import {
  ConversationEvent,
  ConversationEventType,
  SessionInfo,
  ApprovalStatus,
  SessionStatus,
} from '@/lib/daemon/types'
import { Card, CardContent } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useConversation } from '@/hooks/useConversation'
import { Skeleton } from '../ui/skeleton'
import { useStore } from '@/AppStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  Bot,
  CheckCircle,
  CircleDashed,
  FilePenLine,
  Hourglass,
  MessageCircleDashed,
  SquareSplitHorizontal,
  SquareSplitVertical,
  UserCheck,
  User,
  Wrench,
  ChevronDown,
} from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { daemonClient } from '@/lib/daemon/client'
import { truncate, formatAbsoluteTimestamp } from '@/utils/formatting'
import { CommandToken } from './CommandToken'

/* I, Sundeep, don't know how I feel about what's going on here. */
let starryNight: any | null = null

// Format tool result content into abbreviated display
function formatToolResult(toolName: string, toolResult: ConversationEvent): React.ReactNode {
  const content = toolResult.tool_result_content || ''

  // Handle empty content
  if (!content.trim()) {
    return <span className="text-muted-foreground italic">No output</span>
  }

  // More specific error detection to avoid false positives
  const isError =
    // Common error patterns
    (content.toLowerCase().includes('error:') ||
      content.toLowerCase().includes('failed:') ||
      content.toLowerCase().includes('failed to') ||
      content.toLowerCase().includes('exception:') ||
      content.toLowerCase().includes('traceback') ||
      // Security/permission errors
      content.toLowerCase().includes('was blocked') ||
      content.toLowerCase().includes('permission denied') ||
      content.toLowerCase().includes('access denied') ||
      content.toLowerCase().includes('not allowed') ||
      content.toLowerCase().includes('forbidden')) &&
    // Exclude false positives
    !content.toLowerCase().includes('no error') &&
    !content.toLowerCase().includes('error: 0') &&
    !content.toLowerCase().includes('error code 0')

  let abbreviated: string

  switch (toolName) {
    case 'Read': {
      // Count lines with the arrow format (e.g., "     1→content")
      // Subtract 5 for the system reminder message appended at the end
      const lineCount = Math.max(0, content.split('\n').length - 5)
      abbreviated = `Read ${lineCount} lines`
      break
    }

    case 'Bash': {
      const lines = content.split('\n').filter(l => l.trim())
      if (!content || lines.length === 0) {
        abbreviated = 'Command completed'
      } else if (lines.length === 1) {
        abbreviated = truncate(lines[0], 80)
      } else {
        abbreviated = `${truncate(lines[0], 60)} ... (${lines.length} lines)`
      }
      break
    }

    case 'Edit': {
      if (content.includes('has been updated')) {
        abbreviated = 'File updated'
      } else if (content.includes('No changes made')) {
        abbreviated = 'No changes made'
      } else if (isError) {
        abbreviated = 'Edit failed'
      } else {
        abbreviated = 'File updated'
      }
      break
    }

    case 'MultiEdit': {
      const editMatch = content.match(/Applied (\d+) edits?/)
      if (editMatch) {
        abbreviated = `Applied ${editMatch[1]} edits`
      } else if (isError) {
        abbreviated = 'MultiEdit failed'
      } else {
        abbreviated = 'Edits applied'
      }
      break
    }

    case 'Write': {
      if (content.includes('successfully')) {
        abbreviated = 'File written'
      } else if (isError) {
        abbreviated = 'Write failed'
      } else {
        abbreviated = 'File written'
      }
      break
    }

    case 'Glob': {
      if (content === 'No files found') {
        abbreviated = 'No files found'
      } else {
        const fileCount = content.split('\n').filter(l => l.trim()).length
        abbreviated = `Found ${fileCount} files`
      }
      break
    }

    case 'Grep': {
      // Extract the count from "Found X files" at the start
      const grepCountMatch = content.match(/Found (\d+) files?/)
      if (grepCountMatch) {
        abbreviated = `Found ${grepCountMatch[1]} files`
      } else if (content.includes('No matches found')) {
        abbreviated = 'No matches found'
      } else {
        // Fallback: count lines
        const fileCount = content
          .split('\n')
          .filter(l => l.trim() && !l.includes('(Results are truncated')).length
        abbreviated = `Found ${fileCount} files`
      }
      break
    }

    case 'LS': {
      // Count items in the tree structure (lines starting with " - ")
      const lsItems = content.split('\n').filter(l => l.trim().startsWith('-')).length
      abbreviated = `${lsItems} items`
      break
    }

    case 'Task': {
      // Task outputs are typically longer summaries
      const firstLine = content.split('\n')[0]
      abbreviated = truncate(firstLine, 100) || 'Task completed'
      break
    }

    case 'TodoRead': {
      // Extract todo count from the message
      const todoArrayMatch = content.match(/\[([^\]]*)\]/)
      if (todoArrayMatch) {
        const todos = todoArrayMatch[1]
        if (!todos) {
          abbreviated = '0 todos'
        } else {
          const todoCount = todos.split('},').length
          abbreviated = `${todoCount} todo${todoCount !== 1 ? 's' : ''}`
        }
      } else {
        abbreviated = 'Todo list read'
      }
      break
    }

    case 'TodoWrite': {
      abbreviated = 'Todos updated'
      break
    }

    case 'WebFetch': {
      if (content.includes('Failed to fetch') || isError) {
        abbreviated = 'Fetch failed'
      } else {
        // Show character count
        const charCount = content.length
        if (charCount > 1024) {
          abbreviated = `Fetched ${(charCount / 1024).toFixed(1)}kb`
        } else {
          abbreviated = `Fetched ${charCount} chars`
        }
      }
      break
    }

    case 'WebSearch': {
      // Count "Links:" occurrences to estimate result batches
      const linkMatches = content.match(/Links: \[/g)
      const linkCount = linkMatches ? linkMatches.length : 0
      // Estimate ~10 results per batch
      const estimatedResults = linkCount * 10
      abbreviated = estimatedResults > 0 ? `Found ~${estimatedResults} results` : 'Search completed'
      break
    }

    case 'NotebookRead': {
      const cellMatch = content.match(/(\d+) cells?/i)
      abbreviated = cellMatch ? `Read ${cellMatch[1]} cells` : 'Notebook read'
      break
    }

    case 'NotebookEdit': {
      abbreviated = 'Notebook updated'
      break
    }

    case 'exit_plan_mode': {
      abbreviated = 'Exited plan mode'
      break
    }

    default: {
      // Unknown tools: show first line or truncate
      const defaultFirstLine = content.split('\n')[0]
      abbreviated = truncate(defaultFirstLine, 80) || 'Completed'
      break
    }
  }

  // Apply error styling if needed (but not for Read tool which just shows file content)
  if (isError && toolName !== 'Read') {
    return <span className="text-destructive">{abbreviated}</span>
  }

  return abbreviated
}

interface SessionDetailProps {
  session: SessionInfo
  onClose: () => void
}

function DiffViewToggle({ isSplitView, onToggle }: { isSplitView: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      className="h-8 w-8 p-0 cursor-pointer"
      title={isSplitView ? 'Switch to inline view' : 'Switch to split view'}
    >
      {isSplitView ? (
        <SquareSplitVertical className="h-4 w-4" />
      ) : (
        <SquareSplitHorizontal className="h-4 w-4" />
      )}
    </Button>
  )
}

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
function eventToDisplayObject(
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
  let subject = <span>Unknown Subject</span>
  let body = null
  let iconComponent = null
  let toolResultContent = null
  const iconClasses = 'w-4 h-4 align-middle relative top-[1px]'

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

function TodoWidget({ event }: { event: ConversationEvent }) {
  const toolInput = JSON.parse(event.tool_input_json!)
  const priorityGrouped = Object.groupBy(toolInput.todos, (todo: any) => todo.priority)
  const todos = toolInput.todos
  const completedCount = todos.filter((todo: any) => todo.status === 'completed').length
  const pendingCount = todos.filter((todo: any) => todo.status === 'pending').length
  const displayOrder = ['high', 'medium', 'low']
  const iconClasses = 'w-3 h-3 align-middle relative top-[1px]'
  const statusToIcon = {
    in_progress: <Hourglass className={iconClasses + ' text-[var(--terminal-warning)]'} />,
    pending: <CircleDashed className={iconClasses + ' text-[var(--terminal-fg-dim)]'} />,
    completed: <CheckCircle className={iconClasses + ' text-[var(--terminal-success)]'} />,
  }

  return (
    <div>
      <hgroup className="flex flex-col gap-1 my-2">
        <h2 className="text-md font-bold text-muted-foreground">TODOs</h2>
        <small>
          {completedCount} completed, {pendingCount} pending
        </small>
      </hgroup>
      {displayOrder.map(priority => {
        const todosInPriority = priorityGrouped[priority] || []
        // Only render the priority section if there are todos in it
        if (todosInPriority.length === 0) return null

        return (
          <div key={priority} className="flex flex-col gap-1 mb-2">
            <h3 className="font-medium text-sm">{priority}</h3>
            <ul className="text-sm">
              {todosInPriority.map((todo: any) => (
                <li key={todo.id} className="flex gap-2 items-start">
                  <span className="flex-shrink-0 mt-1">
                    {statusToIcon[todo.status as keyof typeof statusToIcon]}
                  </span>
                  <span className="whitespace-pre-line font-mono">{todo.content}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function DenyForm({
  approvalId,
  onDeny,
  onCancel,
}: {
  approvalId: string
  onDeny?: (approvalId: string, reason: string) => void
  onCancel?: () => void
}) {
  const [reason, setReason] = useState('')
  const [isDenying, setIsDenying] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (reason.trim() && onDeny && !isDenying) {
      try {
        setIsDenying(true)
        onDeny(approvalId, reason.trim())
      } finally {
        setIsDenying(false)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit(e as any)
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-center">
      <Input
        type="text"
        placeholder="Reason for denial... (Enter to submit)"
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1"
        autoFocus
      />
      <Button
        className="cursor-pointer"
        type="submit"
        size="sm"
        variant="destructive"
        disabled={!reason.trim() || isDenying}
      >
        {isDenying ? 'Denying...' : 'Deny'}{' '}
        {reason.trim() && !isDenying && (
          <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">⏎</kbd>
        )}
      </Button>
      <Button
        className="cursor-pointer"
        type="button"
        size="sm"
        variant="outline"
        onClick={onCancel}
        disabled={isDenying}
      >
        Cancel <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
      </Button>
    </form>
  )
}

function ConversationContent({
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

// Helper functions for session status text
const getSessionStatusText = (status: string): string => {
  if (status === 'completed') return 'Continue this conversation with a new message'
  if (status === 'running' || status === 'starting')
    return 'Claude is working - you can interrupt with a new message'
  return 'Session must be completed to continue'
}

const Kbd = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <kbd className={`px-1 py-0.5 bg-muted rounded ${className}`}>{children}</kbd>
)

const getSessionButtonText = (status: string): React.ReactNode => {
  if (status === 'running' || status === 'starting')
    return (
      <>
        Interrupt & Reply <Kbd className="ml-2 text-xs">R</Kbd>
      </>
    )
  if (status === 'completed')
    return (
      <>
        Continue Session <Kbd className="ml-2 text-xs">R</Kbd>
      </>
    )
  return 'Not Available'
}

const getInputPlaceholder = (status: string): string => {
  if (status === 'failed') return 'Session failed - cannot continue...'
  if (status === 'running' || status === 'starting') return 'Enter message to interrupt...'
  return 'Enter your message to continue the conversation...'
}

const getHelpText = (status: string): React.ReactNode => {
  if (status === 'failed') return 'Session failed - cannot continue'
  if (status === 'running' || status === 'starting') {
    return (
      <>
        <Kbd>Enter</Kbd> to interrupt and send, <Kbd className="ml-1">Escape</Kbd> to cancel
      </>
    )
  }
  return (
    <>
      <Kbd>Enter</Kbd> to send, <Kbd className="ml-1">Escape</Kbd> to cancel
    </>
  )
}

function SessionDetail({ session, onClose }: SessionDetailProps) {
  const [focusedEventId, setFocusedEventId] = useState<number | null>(null)
  const [isWideView, setIsWideView] = useState(false)
  const [isCompactView, setIsCompactView] = useState(false)
  const [showResponseInput, setShowResponseInput] = useState(false)
  const [expandedToolResult, setExpandedToolResult] = useState<ConversationEvent | null>(null)
  const [expandedToolCall, setExpandedToolCall] = useState<ConversationEvent | null>(null)
  const [responseInput, setResponseInput] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(null)
  const [confirmingApprovalId, setConfirmingApprovalId] = useState<string | null>(null)
  const [denyingApprovalId, setDenyingApprovalId] = useState<string | null>(null)
  const [focusSource, setFocusSource] = useState<'mouse' | 'keyboard' | null>(null)
  const [isSplitView, setIsSplitView] = useState(true)
  const interruptSession = useStore(state => state.interruptSession)
  const navigate = useNavigate()
  const isRunning = session.status === 'running'

  // Get events for sidebar access
  const { events } = useConversation(session.id)

  // Screen size detection for responsive layout
  useEffect(() => {
    const checkScreenSize = () => {
      setIsWideView(window.innerWidth >= 1024) // lg breakpoint
      // Consider compact view for heights less than 800px
      setIsCompactView(window.innerHeight < 800)
    }

    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  // Check if there are pending approvals out of view
  const [hasPendingApprovalsOutOfView, setHasPendingApprovalsOutOfView] = useState(false)

  const lastTodo = events
    ?.toReversed()
    .find(e => e.event_type === 'tool_call' && e.tool_name === 'TodoWrite')

  // Approval handlers
  const handleApprove = async (approvalId: string) => {
    try {
      setApprovingApprovalId(approvalId)
      await daemonClient.approveFunctionCall(approvalId)
    } catch (error) {
      console.error('Failed to approve:', error)
    } finally {
      setApprovingApprovalId(null)
    }
  }

  const handleDeny = async (approvalId: string, reason: string) => {
    try {
      await daemonClient.denyFunctionCall(approvalId, reason)
      setDenyingApprovalId(null)
    } catch (error) {
      console.error('Failed to deny:', error)
    }
  }

  // Continue session functionality
  const handleContinueSession = async () => {
    if (!responseInput.trim() || isResponding) return

    try {
      setIsResponding(true)
      // Keep the message visible while sending
      const messageToSend = responseInput.trim()

      const response = await daemonClient.continueSession({
        session_id: session.id,
        query: messageToSend,
      })

      // Always navigate to the new session - the backend handles queuing
      navigate(`/sessions/${response.session_id}`)

      // Reset form state only after success
      setResponseInput('')
      setShowResponseInput(false)
    } catch (error) {
      console.error('Failed to continue session:', error)
      // On error, keep the message so user can retry
    } finally {
      setIsResponding(false)
    }
  }

  const handleResponseInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleContinueSession()
    } else if (e.key === 'Escape') {
      setShowResponseInput(false)
      setResponseInput('')
    }
  }

  // Navigate to parent session
  const handleNavigateToParent = () => {
    if (session.parent_session_id) {
      navigate(`/sessions/${session.parent_session_id}`)
    }
  }

  // Clear focus on escape, then close if nothing focused
  useHotkeys('escape', () => {
    if (confirmingApprovalId) {
      setConfirmingApprovalId(null)
    } else if (focusedEventId) {
      setFocusedEventId(null)
    } else {
      onClose()
    }
  })

  // Ctrl+X to interrupt session
  useHotkeys('ctrl+x', () => {
    if (session.status === 'running' || session.status === 'starting') {
      interruptSession(session.id)
    }
  })

  // R key to show response input (for completed, running, or starting sessions)
  useHotkeys('r', event => {
    if (session.status !== 'failed' && !showResponseInput) {
      event.preventDefault()
      setShowResponseInput(true)
    }
  })

  // P key to navigate to parent session
  useHotkeys('p', () => {
    if (session.parent_session_id) {
      handleNavigateToParent()
    }
  })

  // I key to expand tool result when focused on a tool call
  useHotkeys('i', () => {
    if (focusedEventId) {
      const focusedEvent = events.find(e => e.id === focusedEventId)
      if (focusedEvent?.event_type === ConversationEventType.ToolCall && focusedEvent.tool_id) {
        const toolResult = events.find(
          e =>
            e.event_type === ConversationEventType.ToolResult &&
            e.tool_result_for_id === focusedEvent.tool_id,
        )
        if (toolResult) {
          setExpandedToolResult(toolResult)
          setExpandedToolCall(focusedEvent)
        }
      }
    }
  })

  // A key to approve focused event that has pending approval
  useHotkeys('a', () => {
    // Find any pending approval event
    const pendingApprovalEvent = events.find(e => e.approval_status === 'pending' && e.approval_id)

    if (!pendingApprovalEvent) return

    // If no event is focused, or a different event is focused, focus this pending approval
    if (!focusedEventId || focusedEventId !== pendingApprovalEvent.id) {
      const container = document.querySelector('[data-conversation-container]')
      const element = container?.querySelector(`[data-event-id="${pendingApprovalEvent.id}"]`)
      let wasInView = true
      if (container && element) {
        const elementRect = element.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        wasInView = elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom
      }
      setFocusedEventId(pendingApprovalEvent.id)
      setFocusSource?.('keyboard')
      // Only set confirming state if element was out of view and we're scrolling to it
      if (!wasInView) {
        setConfirmingApprovalId(pendingApprovalEvent.approval_id!)
      }
      return
    }

    // If the pending approval is already focused
    if (focusedEventId === pendingApprovalEvent.id) {
      // If we're in confirming state, approve it
      if (confirmingApprovalId === pendingApprovalEvent.approval_id) {
        handleApprove(pendingApprovalEvent.approval_id!)
        setConfirmingApprovalId(null)
      } else {
        // If not in confirming state, approve directly
        handleApprove(pendingApprovalEvent.approval_id!)
      }
    }
  })

  // D key to deny focused event that has pending approval
  useHotkeys('d', e => {
    // Find any pending approval event
    const pendingApprovalEvent = events.find(e => e.approval_status === 'pending' && e.approval_id)

    if (!pendingApprovalEvent) return

    // Prevent the 'd' from being typed in any input that might get focused
    e.preventDefault()

    // If no event is focused, or a different event is focused, focus this pending approval
    if (!focusedEventId || focusedEventId !== pendingApprovalEvent.id) {
      setFocusedEventId(pendingApprovalEvent.id)
      setFocusSource?.('keyboard')
      return
    }

    // If the pending approval is already focused, show the deny form
    if (focusedEventId === pendingApprovalEvent.id) {
      setDenyingApprovalId(pendingApprovalEvent.approval_id!)
    }
  })

  // Check if there are pending approvals out of view when in waiting_input status
  useEffect(() => {
    if (session.status === SessionStatus.WaitingInput) {
      const pendingEvent = events.find(e => e.approval_status === ApprovalStatus.Pending)
      if (pendingEvent) {
        const container = document.querySelector('[data-conversation-container]')
        const element = container?.querySelector(`[data-event-id="${pendingEvent.id}"]`)
        if (container && element) {
          const elementRect = element.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          const inView =
            elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom
          setHasPendingApprovalsOutOfView(!inView)
        }
      } else {
        setHasPendingApprovalsOutOfView(false)
      }
    } else {
      setHasPendingApprovalsOutOfView(false)
    }
  }, [session.status, events])

  return (
    <section className={`flex flex-col h-full ${isCompactView ? 'gap-2' : 'gap-4'}`}>
      {!isCompactView && (
        <hgroup className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground font-mono">
            {session.summary || truncate(session.query, 50)}{' '}
            {session.parent_session_id && <span className="text-muted-foreground">[continued]</span>}
          </h2>
          <small
            className={`font-mono text-xs uppercase tracking-wider ${getStatusTextClass(session.status)}`}
          >
            {`${session.status}${session.model ? ` / ${session.model}` : ''}`}
          </small>
          {session.working_dir && (
            <small className="font-mono text-xs text-muted-foreground">{session.working_dir}</small>
          )}
        </hgroup>
      )}
      {isCompactView && (
        <hgroup className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium text-foreground font-mono">
            {session.summary || truncate(session.query, 50)}{' '}
            {session.parent_session_id && <span className="text-muted-foreground">[continued]</span>}
          </h2>
          <small
            className={`font-mono text-xs uppercase tracking-wider ${getStatusTextClass(session.status)}`}
          >
            {`${session.status}${session.model ? ` / ${session.model}` : ''}`}
          </small>
        </hgroup>
      )}
      <div className={`flex flex-1 gap-4 ${isWideView ? 'flex-row' : 'flex-col'} min-h-0`}>
        {/* Conversation content and Loading */}
        <Card
          className={`${isWideView ? 'flex-1' : 'w-full'} relative ${isCompactView ? 'py-2' : 'py-4'} flex flex-col min-h-0`}
        >
          <CardContent className={`${isCompactView ? 'px-2' : 'px-4'} flex flex-col flex-1 min-h-0`}>
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
                onApprove={handleApprove}
                onDeny={handleDeny}
                approvingApprovalId={approvingApprovalId}
                confirmingApprovalId={confirmingApprovalId}
                denyingApprovalId={denyingApprovalId}
                setDenyingApprovalId={setDenyingApprovalId}
                onCancelDeny={() => setDenyingApprovalId(null)}
                isSplitView={isSplitView}
                onToggleSplitView={() => setIsSplitView(!isSplitView)}
                focusSource={focusSource}
                setFocusSource={setFocusSource}
                setConfirmingApprovalId={setConfirmingApprovalId}
                expandedToolResult={expandedToolResult}
              />
              {isRunning && (
                <div className="flex flex-col gap-1 mt-2 border-t pt-2">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    robot magic is happening
                  </h2>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="h-4 w-1/5" />
                  </div>
                </div>
              )}
            </Suspense>

            {/* Status bar for pending approvals */}
            <div
              className={`absolute bottom-0 left-0 right-0 p-2 cursor-pointer transition-all duration-300 ease-in-out ${
                hasPendingApprovalsOutOfView
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-full pointer-events-none'
              }`}
              onClick={() => {
                const container = document.querySelector('[data-conversation-container]')
                if (container) {
                  container.scrollTop = container.scrollHeight
                }
              }}
            >
              <div className="flex items-center justify-center gap-1 font-mono text-xs uppercase tracking-wider text-muted-foreground bg-background/60 backdrop-blur-sm border-t border-border/50 py-1 shadow-sm hover:bg-background/80 transition-colors">
                <span>Pending Approval</span>
                <ChevronDown className="w-3 h-3 animate-bounce" />
              </div>
            </div>
          </CardContent>
        </Card>

        {isWideView && lastTodo && (
          <Card className="w-[20%]">
            <CardContent>
              <TodoWidget event={lastTodo} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Response input - always show but disable for non-completed sessions */}
      <Card className={isCompactView ? 'py-2' : 'py-4'}>
        <CardContent className={isCompactView ? 'px-2' : 'px-4'}>
          {!showResponseInput ? (
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">
                {getSessionStatusText(session.status)}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowResponseInput(true)}
                disabled={session.status === 'failed'}
              >
                {getSessionButtonText(session.status)}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Continue conversation:</span>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={getInputPlaceholder(session.status)}
                  value={responseInput}
                  onChange={e => setResponseInput(e.target.value)}
                  onKeyDown={handleResponseInputKeyDown}
                  autoFocus
                  disabled={isResponding || session.status === 'failed'}
                  className={`flex-1 ${isResponding ? 'opacity-50' : ''}`}
                />
                <Button
                  onClick={handleContinueSession}
                  disabled={!responseInput.trim() || isResponding || session.status === 'failed'}
                  size="sm"
                >
                  {isResponding ? 'Interrupting...' : 'Send'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {isResponding
                  ? 'Waiting for Claude to accept the interrupt...'
                  : getHelpText(session.status)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tool Result Expansion Modal */}
      <ToolResultModal
        toolCall={expandedToolCall}
        toolResult={expandedToolResult}
        onClose={() => {
          setExpandedToolResult(null)
          setExpandedToolCall(null)
        }}
      />
    </section>
  )
}

// Minimalist modal for showing full tool results
function ToolResultModal({
  toolCall,
  toolResult,
  onClose,
}: {
  toolCall: ConversationEvent | null
  toolResult: ConversationEvent | null
  onClose: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Handle j/k navigation - using priority to override background hotkeys
  useHotkeys(
    'j',
    e => {
      e.preventDefault()
      e.stopPropagation()
      if (toolResult && contentRef.current) {
        contentRef.current.scrollTop += 100
      }
    },
    { enabled: !!toolResult, enableOnFormTags: true, preventDefault: true },
  )

  useHotkeys(
    'k',
    e => {
      e.preventDefault()
      e.stopPropagation()
      if (toolResult && contentRef.current) {
        contentRef.current.scrollTop -= 100
      }
    },
    { enabled: !!toolResult, enableOnFormTags: true, preventDefault: true },
  )

  // Handle escape to close
  useHotkeys(
    'escape',
    () => {
      if (toolResult) {
        onClose()
      }
    },
    { enabled: !!toolResult },
  )

  if (!toolResult) return null

  return (
    <Dialog open={!!toolResult} onOpenChange={open => !open && onClose()}>
      <DialogContent className="w-[90vw] max-w-[90vw] max-h-[80vh] p-0 sm:max-w-[90vw]">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="font-mono text-sm flex items-center justify-between">
            <span>
              {toolCall?.tool_name || 'Tool Result'}
              {toolCall?.tool_input_json && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {(() => {
                    try {
                      const args = JSON.parse(toolCall.tool_input_json)
                      // Show the most relevant argument based on tool name
                      if (toolCall.tool_name === 'Read' && args.file_path) {
                        return args.file_path
                      } else if (toolCall.tool_name === 'Bash' && args.command) {
                        return truncate(args.command, 60)
                      } else if (toolCall.tool_name === 'Edit' && args.file_path) {
                        return args.file_path
                      } else if (toolCall.tool_name === 'Write' && args.file_path) {
                        return args.file_path
                      } else if (toolCall.tool_name === 'Grep' && args.pattern) {
                        return args.pattern
                      }
                      // For other tools, show the first string value
                      const firstValue = Object.values(args).find(v => typeof v === 'string')
                      return firstValue ? truncate(String(firstValue), 60) : ''
                    } catch {
                      return ''
                    }
                  })()}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">Esc</span>
          </DialogTitle>
        </DialogHeader>
        <div
          ref={contentRef}
          className="overflow-y-auto px-6 py-4 font-mono text-sm whitespace-pre-wrap"
          style={{ maxHeight: 'calc(80vh - 80px)' }}
        >
          {toolResult.tool_result_content || 'No content'}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Simple error boundary component
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('SessionDetail Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <h2 className="text-lg font-semibold text-destructive">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            variant="outline"
          >
            Reload
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

// Export wrapped component
const SessionDetailWithErrorBoundary = (props: SessionDetailProps) => (
  <ErrorBoundary>
    <SessionDetail {...props} />
  </ErrorBoundary>
)

export default SessionDetailWithErrorBoundary
