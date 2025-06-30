import { createStarryNight } from '@wooorm/starry-night'
import jsonGrammar from '@wooorm/starry-night/source.json'
import textMd from '@wooorm/starry-night/text.md'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import React, { Suspense, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import keyBy from 'lodash.keyby'

import {
  ConversationEvent,
  ConversationEventType,
  SessionInfo,
  ApprovalStatus,
} from '@/lib/daemon/types'
import { Card, CardContent } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useConversation } from '@/hooks/useConversation'
import { Skeleton } from '../ui/skeleton'
import { useStore } from '@/AppStore'
import {
  Bot,
  CheckCircle,
  CircleDashed,
  FilePenLine,
  Hourglass,
  MessageCircle,
  MessageCircleDashed,
  SquareSplitHorizontal,
  SquareSplitVertical,
  UserCheck,
  User,
  Wrench,
} from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { daemonClient } from '@/lib/daemon/client'
import { truncate, formatAbsoluteTimestamp } from '@/utils/formatting'
import { CommandToken } from './CommandToken'

/* I, Sundeep, don't know how I feel about what's going on here. */
let starryNight: any | null = null

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
  isSplitView?: boolean,
  onToggleSplitView?: () => void,
  toolResult?: ConversationEvent,
) {
  let subject = <span>Unknown Subject</span>
  let body = null
  let iconComponent = null
  let toolResultContent = null
  const iconClasses = 'w-4 h-4 align-middle relative top-[1px]'

  // // For the moment, don't display tool results.
  // if (event.event_type === ConversationEventType.ToolResult) {
  //   return null
  // }
  // console.log('toolResult', toolResult)

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
          Approval ({event.approval_status})
        </span>
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
                className="cursor-pointer"
                size="sm"
                variant={isApproving ? 'outline' : 'default'}
                onClick={e => {
                  e.stopPropagation()
                  onApprove(event.approval_id!)
                }}
                disabled={isApproving}
              >
                {isApproving ? 'Approving...' : 'Approve'}{' '}
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
    iconComponent = <Bot className={iconClasses} />
  }

  if (event.role === 'user') {
    iconComponent = <User className={iconClasses} />
  }

  // For the moment, controlling tightly when we display tool result content.
  if (toolResult && event.approval_status === ApprovalStatus.Denied) {
    toolResultContent = (
      <div className="font-mono text-sm text-muted-foreground gap-1">
        <span className="font-bold inline-flex items-center mr-2">
          <MessageCircle className="w-3 h-3" /> Denial Comment:
        </span>
        <span>{toolResult.tool_result_content}</span>
      </div>
    )
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
          <span className="ml-2 font-mono text-xs">{formatAbsoluteTimestamp(event.created_at)}</span>
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

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-center">
      <Input
        type="text"
        placeholder="Reason for denial..."
        value={reason}
        onChange={e => setReason(e.target.value)}
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
        {isDenying ? 'Denying...' : 'Deny'}
      </Button>
      <Button
        className="cursor-pointer"
        type="button"
        size="sm"
        variant="outline"
        onClick={onCancel}
        disabled={isDenying}
      >
        Cancel
      </Button>
    </form>
  )
}

function ConversationContent({
  sessionId,
  focusedEventId,
  setFocusedEventId,
  expandedEventId,
  setExpandedEventId,
  isWideView,
  onApprove,
  onDeny,
  approvingApprovalId,
  isSplitView,
  onToggleSplitView,
}: {
  sessionId: string
  focusedEventId: number | null
  setFocusedEventId: (id: number | null) => void
  expandedEventId: number | null
  setExpandedEventId: (id: number | null) => void
  isWideView: boolean
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string, reason: string) => void
  approvingApprovalId?: string | null
  isSplitView?: boolean
  onToggleSplitView?: () => void
}) {
  const { events, loading, error, isInitialLoad } = useConversation(sessionId, undefined, 1000)
  const [denyingApprovalId, setDenyingApprovalId] = useState<string | null>(null)
  const [focusSource, setFocusSource] = useState<'mouse' | 'keyboard' | null>(null)
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
        () => setDenyingApprovalId(null),
        approvingApprovalId,
        isSplitView,
        onToggleSplitView,
        event.tool_id ? toolResultsByKey[event.tool_id] : undefined,
      ),
    )
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
    setFocusSource('keyboard')
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
    setFocusSource('keyboard')
  }

  // Keyboard navigation
  useHotkeys('j', focusNextEvent)
  useHotkeys('k', focusPreviousEvent)

  const containerRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolledRef = useRef(false)

  useEffect(() => {
    // Only auto-scroll once on initial load when events first appear
    if (!loading && containerRef.current && events.length > 0 && !hasAutoScrolledRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
      hasAutoScrolledRef.current = true
    }

    if (!starryNight) {
      createStarryNight([textMd, jsonGrammar]).then(sn => (starryNight = sn))
    }
  }, [loading, events])

  // Scroll focused event into view (only for keyboard navigation)
  useEffect(() => {
    if (focusedEventId && containerRef.current && focusSource === 'keyboard') {
      const focusedElement = containerRef.current.querySelector(`[data-event-id="${focusedEventId}"]`)
      if (focusedElement) {
        focusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [focusedEventId, focusSource])

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
    <div ref={containerRef} className="max-h-[calc(100vh-475px)] overflow-y-auto">
      <div>
        {nonEmptyDisplayObjects.map((displayObject, index) => (
          <div key={displayObject.id}>
            <div
              data-event-id={displayObject.id}
              onMouseEnter={() => {
                setFocusedEventId(displayObject.id)
                setFocusSource('mouse')
              }}
              onMouseLeave={() => setFocusedEventId(null)}
              onClick={() =>
                setExpandedEventId(expandedEventId === displayObject.id ? null : displayObject.id)
              }
              className={`pt-2 pb-8 px-2 cursor-pointer ${
                index !== nonEmptyDisplayObjects.length - 1 ? 'border-b' : ''
              } ${focusedEventId === displayObject.id ? '!bg-accent/20 -mx-2 px-4 rounded' : ''}`}
            >
              {/* Timestamp at top */}
              <div className="flex justify-end mb-2">
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
  const [showResponseInput, setShowResponseInput] = useState(false)
  const [responseInput, setResponseInput] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(null)
  const [isSplitView, setIsSplitView] = useState(true)
  const interruptSession = useStore(state => state.interruptSession)
  const navigate = useNavigate()
  const isRunning = session.status === 'running'

  // Get events for sidebar access
  const { events } = useConversation(session.id)

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
    } catch (error) {
      console.error('Failed to deny:', error)
    }
  }

  // Continue session functionality
  const handleContinueSession = async () => {
    if (!responseInput.trim() || isResponding) return

    try {
      setIsResponding(true)
      const response = await daemonClient.continueSession({
        session_id: session.id,
        query: responseInput.trim(),
      })

      // Navigate to the new child session
      navigate(`/sessions/${response.session_id}`)

      // Reset form state
      setResponseInput('')
      setShowResponseInput(false)
    } catch (error) {
      console.error('Failed to continue session:', error)
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

  // Ctrl+X to interrupt session
  useHotkeys('ctrl+x', () => {
    if (session.status === 'running' || session.status === 'starting') {
      interruptSession(session.id)
    }
  })

  // R key to show response input (only for completed sessions)
  useHotkeys('r', event => {
    if (session.status === 'completed' && !showResponseInput) {
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

  // A key to approve focused event that has pending approval
  useHotkeys('a', () => {
    if (focusedEventId) {
      const focusedEvent = events.find(e => e.id === focusedEventId)
      if (focusedEvent?.approval_status === 'pending' && focusedEvent.approval_id) {
        handleApprove(focusedEvent.approval_id)
      }
    }
  })

  // D key to deny focused event that has pending approval
  useHotkeys('d', () => {
    if (focusedEventId) {
      const focusedEvent = events.find(e => e.id === focusedEventId)
      if (focusedEvent?.approval_status === 'pending' && focusedEvent.approval_id) {
        // For now, deny with a default reason - could be enhanced to show input
        handleDeny(focusedEvent.approval_id, 'Denied via hotkey')
      }
    }
  })

  return (
    <section className="flex flex-col gap-4">
      <hgroup className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-foreground font-mono">
          {session.summary || truncate(session.query, 50)}{' '}
          {session.parent_session_id && <span className="text-muted-foreground">[continued]</span>}
        </h2>
        <small
          className={`font-mono text-xs uppercase tracking-wider ${getStatusTextClass(session.status)}`}
        >
          {`${session.status}${session.model ? `/ ${session.model}` : ''}`}
        </small>
        {session.working_dir && (
          <small className="font-mono text-xs text-muted-foreground">{session.working_dir}</small>
        )}
        {session.parent_session_id && (
          <small className="text-xs text-muted-foreground">
            Press <kbd className="px-1 py-0.5 text-xs bg-muted rounded">P</kbd> to view parent session
          </small>
        )}
      </hgroup>
      <div className={`flex gap-4 ${isWideView ? 'flex-row' : 'flex-col'}`}>
        {/* Conversation content and Loading */}
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
                onApprove={handleApprove}
                onDeny={handleDeny}
                approvingApprovalId={approvingApprovalId}
                isSplitView={isSplitView}
                onToggleSplitView={() => setIsSplitView(!isSplitView)}
              />
              {isRunning && (
                <div className="flex flex-col gap-2 mt-4 border-t pt-4">
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
          </CardContent>
        </Card>

        {/* Sidebar for wide view */}
        {/* {isWideView && expandedEventId && (
          <Card className="w-[40%]">
            <CardContent>
              <EventMetaInfo event={events.find(e => e.id === expandedEventId)!} />
            </CardContent>
          </Card>
        )} */}

        {lastTodo && (
          <Card className="w-[20%]">
            <CardContent>
              <TodoWidget event={lastTodo} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Response input - always show but disable for non-completed sessions */}
      <Card>
        <CardContent>
          {!showResponseInput ? (
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">
                {session.status === 'completed'
                  ? 'Continue this conversation with a new message'
                  : session.status === 'running'
                    ? 'Session is running - sending a message will interrupt it'
                  : session.status === 'starting'
                    ? 'Session is starting...'
                    : 'Session must be completed to continue'}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowResponseInput(true)}
                disabled={session.status !== 'completed' && session.status !== 'running'}
              >
                {session.status === 'running' ? (
                  <>
                    Interrupt & Continue <kbd className="ml-2 px-1 py-0.5 text-xs bg-muted rounded">R</kbd>
                  </>
                ) : session.status === 'starting' ? (
                  'Starting...'
                ) : session.status === 'completed' ? (
                  <>
                    Continue Session <kbd className="ml-2 px-1 py-0.5 text-xs bg-muted rounded">R</kbd>
                  </>
                ) : (
                  'Not Available'
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Continue conversation:</span>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={
                    session.status === 'completed'
                      ? 'Enter your message to continue the conversation...'
                      : session.status === 'running'
                        ? 'Enter your message to interrupt and continue...'
                        : 'Session must be completed to continue...'
                  }
                  value={responseInput}
                  onChange={e => setResponseInput(e.target.value)}
                  onKeyDown={handleResponseInputKeyDown}
                  autoFocus
                  disabled={isResponding || (session.status !== 'completed' && session.status !== 'running')}
                  className="flex-1"
                />
                <Button
                  onClick={handleContinueSession}
                  disabled={!responseInput.trim() || isResponding || (session.status !== 'completed' && session.status !== 'running')}
                  size="sm"
                >
                  {isResponding ? 'Starting...' : 'Send'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {session.status === 'completed' ? (
                  <>
                    Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to send,
                    <kbd className="px-1 py-0.5 bg-muted rounded ml-1">Escape</kbd> to cancel
                  </>
                ) : session.status === 'running' ? (
                  <>
                    Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to interrupt and continue,
                    <kbd className="px-1 py-0.5 bg-muted rounded ml-1">Escape</kbd> to cancel
                  </>
                ) : (
                  'Wait for the session to complete before continuing'
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

export default SessionDetail
