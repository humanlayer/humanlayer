import { ChevronDown, CircleDashed, Wrench, FilePenLine, Bot, User, UserCheck } from 'lucide-react'
import { ConversationEvent, ConversationEventType, FileSnapshotInfo } from '@/lib/daemon/types'
import { TaskEventGroup } from '../hooks/useTaskGrouping'
import { truncate, formatAbsoluteTimestamp, formatTimestamp } from '@/utils/formatting'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { eventToDisplayObject } from '../eventToDisplayObject'

interface TaskGroupProps {
  group: TaskEventGroup
  isExpanded: boolean
  onToggle: () => void
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
  setFocusSource?: (source: 'mouse' | 'keyboard' | null) => void
  setConfirmingApprovalId?: (id: string | null) => void
  toolResultsByKey: Record<string, ConversationEvent>
  setExpandedToolResult?: (event: ConversationEvent | null) => void
  setExpandedToolCall?: (event: ConversationEvent | null) => void
  getSnapshot?: (filePath: string) => FileSnapshotInfo | undefined
  shouldIgnoreMouseEvent?: () => boolean
}

export function TaskGroup({
  group,
  isExpanded,
  onToggle,
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
  setFocusSource,
  setConfirmingApprovalId,
  toolResultsByKey,
  setExpandedToolResult,
  setExpandedToolCall,
  getSnapshot,
  shouldIgnoreMouseEvent,
}: TaskGroupProps) {
  const { parentTask, toolCallCount, latestEvent, hasPendingApproval } = group
  const description = JSON.parse(parentTask.toolInputJson || '{}').description || 'Task'
  const isCompleted = parentTask.isCompleted

  return (
    <div
      className={`p-4 TaskGroup cursor-pointer transition-all duration-200 ${
        focusedEventId === parentTask.id ? 'shadow-[inset_2px_0_0_0_var(--terminal-accent)]' : ''
      }`}
    >
      {/* Task Header with Preview */}
      <div
        data-event-id={parentTask.id}
        className={`flex items-start gap-2 rounded-md cursor-pointer hover:bg-muted/10 transition-all duration-200 `}
        onClick={onToggle}
        onMouseEnter={() => {
          if (shouldIgnoreMouseEvent?.()) return
          if (parentTask.id !== undefined) {
            setFocusedEventId(parentTask.id)
            setFocusSource?.('mouse')
          }
        }}
        onMouseLeave={() => {
          if (shouldIgnoreMouseEvent?.()) return
          setFocusedEventId(null)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onToggle()
          }
        }}
        tabIndex={-1}
        role="button"
        aria-expanded={isExpanded}
      >
        <ChevronDown
          className={`w-4 h-4 mt-0.5 transition-transform ${!isExpanded ? '-rotate-90' : ''}`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-accent" />
            <span className="font-medium">{truncate(description, 80)}</span>
            {!isCompleted && <CircleDashed className="w-4 h-4 animate-spin text-muted-foreground" />}
            {hasPendingApproval && (
              <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded">
                Approval Required
              </span>
            )}
          </div>

          {/* Preview when collapsed - show latest event */}
          {!isExpanded && latestEvent && (
            <div className="mt-2">
              {/* Render the latest event using existing display logic */}
              <div className="opacity-70 text-sm">
                {(() => {
                  // Get preview text based on event type
                  let previewText = ''
                  let icon = null

                  if (latestEvent.toolName) {
                    previewText = `${latestEvent.toolName}`
                    try {
                      const toolInput = JSON.parse(latestEvent.toolInputJson || '{}')
                      if (latestEvent.toolName === 'Write' && toolInput.file_path) {
                        previewText = `Write to ${toolInput.file_path}`
                        icon = <FilePenLine className="w-3 h-3" />
                      } else if (latestEvent.toolName === 'Read' && toolInput.file_path) {
                        previewText = `Read ${toolInput.file_path}`
                      } else if (latestEvent.toolName === 'Bash' && toolInput.command) {
                        previewText = `$ ${truncate(toolInput.command, 50)}`
                      } else if (latestEvent.toolName === 'Task' && toolInput.description) {
                        previewText = truncate(toolInput.description, 80)
                      }
                    } catch {
                      // Keep default preview text if JSON parsing fails
                    }
                    if (!icon) icon = <Wrench className="w-3 h-3" />
                  } else if (latestEvent.content) {
                    previewText = truncate(latestEvent.content, 100)
                    if (latestEvent.role === 'assistant') {
                      icon = <Bot className="w-3 h-3" />
                    } else if (latestEvent.role === 'user') {
                      icon = <User className="w-3 h-3" />
                    }
                  } else if (latestEvent.approvalStatus) {
                    previewText = `Approval (${latestEvent.approvalStatus})`
                    icon = <UserCheck className="w-3 h-3" />
                  }

                  return (
                    <div className="flex items-baseline gap-2">
                      {icon && (
                        <span className="text-sm text-accent align-middle relative top-[1px]">
                          {icon}
                        </span>
                      )}
                      <span className="whitespace-pre-wrap text-accent text-xs">{previewText}</span>
                    </div>
                  )
                })()}
              </div>
              {toolCallCount > 1 && (
                <div className="text-xs text-muted-foreground mt-1">
                  + {toolCallCount - 1} more tool {toolCallCount - 1 === 1 ? 'call' : 'calls'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expanded Sub-task Events */}
      {isExpanded && (
        <div className="ml-6 mt-2 TaskGroupExpanded">
          {group.subTaskEvents.map(subEvent => {
            const displayObject = eventToDisplayObject(
              subEvent,
              onApprove,
              onDeny,
              denyingApprovalId,
              setDenyingApprovalId, // This is onStartDeny
              onCancelDeny,
              approvingApprovalId,
              confirmingApprovalId,
              isSplitView,
              onToggleSplitView,
              subEvent.toolId ? toolResultsByKey[subEvent.toolId] : undefined,
              focusedEventId === subEvent.id,
              getSnapshot,
            )

            if (!displayObject) return null

            return (
              <div
                key={subEvent.id}
                className={`relative pl-4 transition-all duration-200 border-l-2 ${
                  focusedEventId === displayObject.id
                    ? 'border-[var(--terminal-accent)]'
                    : ''
                }`}
              >
                <div
                  data-event-id={displayObject.id}
                  onMouseEnter={() => {
                    if (shouldIgnoreMouseEvent?.()) return
                    if (displayObject.id !== undefined) {
                      setFocusedEventId(displayObject.id)
                      setFocusSource?.('mouse')
                    }
                  }}
                  onMouseLeave={() => {
                    if (shouldIgnoreMouseEvent?.()) return
                    setFocusedEventId(null)
                    setConfirmingApprovalId?.(null)
                  }}
                  onClick={() => {
                    const event = subEvent
                    if (event?.eventType === ConversationEventType.ToolCall) {
                      const toolResult = event.toolId ? toolResultsByKey[event.toolId] : null
                      if (setExpandedToolResult && setExpandedToolCall) {
                        setExpandedToolResult(toolResult || null)
                        setExpandedToolCall(event)
                      }
                    }
                  }}
                  className={`group py-2 px-2 cursor-pointer`}
                >
                  {/* Main content container with flexbox */}
                  <div className="flex gap-4">
                    {/* Left side: Icon and message content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        {displayObject.iconComponent && (
                          <span className="text-sm text-accent align-middle relative top-[1px]">
                            {displayObject.iconComponent}
                          </span>
                        )}
                        <span className="whitespace-pre-wrap text-accent break-words">
                          {displayObject.subject}
                        </span>
                      </div>
                      {displayObject.toolResultContent && (
                        <div className="whitespace-pre-wrap text-foreground break-words mt-2">
                          {displayObject.toolResultContent}
                        </div>
                      )}
                      {displayObject.body && (
                        <div className="whitespace-pre-wrap text-foreground break-words mt-2">
                          {displayObject.body}
                        </div>
                      )}
                    </div>

                    {/* Right side: Timestamp */}
                    <div className="shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-muted-foreground/60 cursor-help">
                            {displayObject.created_at ? formatTimestamp(displayObject.created_at) : ''}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {displayObject.created_at
                            ? formatAbsoluteTimestamp(displayObject.created_at)
                            : 'Unknown time'}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>

                {/* Expanded content */}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
