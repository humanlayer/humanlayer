import { ChevronDown, CircleDashed, Wrench, FilePenLine, Bot, User, UserCheck } from 'lucide-react'
import { ConversationEvent, ConversationEventType, FileSnapshotInfo } from '@/lib/daemon/types'
import { TaskEventGroup } from '../hooks/useTaskGrouping'
import { truncate, formatAbsoluteTimestamp } from '@/utils/formatting'
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
}: TaskGroupProps) {
  const { parentTask, toolCallCount, latestEvent, hasPendingApproval } = group
  const description = JSON.parse(parentTask.tool_input_json || '{}').description || 'Task'
  const isCompleted = parentTask.is_completed

  return (
    <div className="p-4 TaskGroup">
      {/* Task Header with Preview */}
      <div
        data-event-id={parentTask.id}
        className={`flex items-start gap-2 rounded-md cursor-pointer hover:bg-muted/10 transition-colors ${
          focusedEventId === parentTask.id ? '!bg-accent/20' : ''
        }`}
        onClick={onToggle}
        onMouseEnter={() => {
          setFocusedEventId(parentTask.id)
          setFocusSource?.('mouse')
        }}
        onMouseLeave={() => {
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

                  if (latestEvent.tool_name) {
                    previewText = `${latestEvent.tool_name}`
                    try {
                      const toolInput = JSON.parse(latestEvent.tool_input_json || '{}')
                      if (latestEvent.tool_name === 'Write' && toolInput.file_path) {
                        previewText = `Write to ${toolInput.file_path}`
                        icon = <FilePenLine className="w-3 h-3" />
                      } else if (latestEvent.tool_name === 'Read' && toolInput.file_path) {
                        previewText = `Read ${toolInput.file_path}`
                      } else if (latestEvent.tool_name === 'Bash' && toolInput.command) {
                        previewText = `$ ${truncate(toolInput.command, 50)}`
                      } else if (latestEvent.tool_name === 'Task' && toolInput.description) {
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
                  } else if (latestEvent.approval_status) {
                    previewText = `Approval (${latestEvent.approval_status})`
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
        <div className="ml-6 mt-2 pl-4 border-l-2 border-border/50 TaskGroupExpanded">
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
              subEvent.tool_id ? toolResultsByKey[subEvent.tool_id] : undefined,
              focusedEventId === subEvent.id,
              getSnapshot,
            )

            if (!displayObject) return null

            return (
              <div key={subEvent.id} className="relative mb-2">
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
                  onClick={() => {
                    const event = subEvent
                    if (event?.event_type === ConversationEventType.ToolCall) {
                      const toolResult = event.tool_id ? toolResultsByKey[event.tool_id] : null
                      if (setExpandedToolResult && setExpandedToolCall) {
                        setExpandedToolResult(toolResult || null)
                        setExpandedToolCall(event)
                      }
                    }
                  }}
                  className={`py-2 px-2 cursor-pointer ${
                    focusedEventId === displayObject.id ? '!bg-accent/20 -mx-2 px-4 rounded' : ''
                  }`}
                >
                  <div className="absolute top-2 right-4">
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
                    <div className="whitespace-pre-wrap text-foreground">
                      {displayObject.toolResultContent}
                    </div>
                  )}
                  {displayObject.body && (
                    <div className="whitespace-pre-wrap text-foreground">{displayObject.body}</div>
                  )}
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
