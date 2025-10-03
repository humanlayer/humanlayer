import { ChevronDown, HatGlasses, Wrench } from 'lucide-react'
import { TaskEventGroup } from '@/components/internal/SessionDetail/hooks/useTaskGrouping'
import { ConversationEventRow, ConversationEventRowProps } from './ConversationEventRow'
import { TaskPreview } from './EventContent/TaskPreview'
import { StatusBadge } from './EventContent/StatusBadge'
import { ConversationEvent, ConversationEventType } from '@/lib/daemon/types'
import { formatTimestamp, formatAbsoluteTimestamp } from '@/utils/formatting'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SentryErrorBoundary } from '@/components/ErrorBoundary'

interface TaskGroupEventRowProps extends Omit<ConversationEventRowProps, 'event'> {
  group: TaskEventGroup
  isExpanded: boolean
  onToggle: () => void
  toolResultsByKey?: Record<string, ConversationEvent>
  focusedEventId?: number | null
}

function TaskGroupEventRowInner({
  group,
  isExpanded,
  onToggle,
  setFocusedEventId,
  setFocusSource,
  shouldIgnoreMouseEvent,
  isFocused,
  isLast,
  responseEditorIsFocused,
  onApprove,
  onDeny,
  approvingApprovalId,
  denyingApprovalId,
  setDenyingApprovalId,
  onCancelDeny,
  ...props
}: TaskGroupEventRowProps) {
  const { parentTask, toolCallCount, latestEvent, hasPendingApproval, subTaskEvents } = group
  const taskInput = JSON.parse(parentTask.toolInputJson || '{}')
  const displayName = taskInput.subagent_type || 'Task'
  const description = taskInput.description || 'Task'
  const isCompleted = parentTask.isCompleted
  const isSubAgent = taskInput.subagent_type !== 'Task'

  // Determine styling based on focus state
  let outerContainerClasses = ['group', 'p-4', 'transition-colors', 'duration-200', 'border-l-2']

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
      className={outerContainerClasses.join(' ')}
      data-event-id={parentTask.id}
      onMouseEnter={() => {
        if (shouldIgnoreMouseEvent()) return
        setFocusedEventId(parentTask.id)
        setFocusSource('mouse')
      }}
      onMouseLeave={() => {
        if (shouldIgnoreMouseEvent()) return
        setFocusedEventId(null)
        setFocusSource(null)
      }}
    >
      {/* Collapsible Header */}
      <div
        className="flex items-start gap-2 cursor-pointer hover:bg-muted/10 rounded-md transition-all duration-200"
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <ChevronDown
          className={`w-4 h-4 mt-0.5 transition-transform ${!isExpanded ? '-rotate-90' : ''}`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {isSubAgent ? (
              <HatGlasses className="w-4 h-4 text-accent" />
            ) : (
              <Wrench className="w-4 h-4 text-accent" />
            )}
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold">{displayName}: </span>
              {description}
            </div>
            {!isExpanded && (
              <>
                {hasPendingApproval && <StatusBadge status="pending" />}
                {!hasPendingApproval && !isCompleted && <StatusBadge status="groupRunning" />}
              </>
            )}
          </div>

          {/* Preview when collapsed */}
          {!isExpanded && latestEvent && (
            <TaskPreview latestEvent={latestEvent} toolCallCount={toolCallCount} />
          )}
        </div>

        {/* Timestamp */}
        <div className="flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground/60 uppercase tracking-wider cursor-help">
                {parentTask.createdAt ? formatTimestamp(parentTask.createdAt) : ''}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {parentTask.createdAt ? formatAbsoluteTimestamp(parentTask.createdAt) : 'Unknown time'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Expanded Sub-events */}
      {isExpanded && (
        <div className="ml-6 mt-2">
          {subTaskEvents
            .filter(event => event.eventType !== ConversationEventType.ToolResult)
            .map((subEvent, index) => {
              return (
                <div key={subEvent.id} className="relative border-l-2 border-muted/20">
                  <ConversationEventRow
                    event={subEvent}
                    toolResult={subEvent.toolId ? props.toolResultsByKey?.[subEvent.toolId] : undefined}
                    setFocusedEventId={setFocusedEventId}
                    setFocusSource={setFocusSource}
                    shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
                    isFocused={props.focusedEventId === subEvent.id}
                    isLast={index === subTaskEvents.length - 1}
                    responseEditorIsFocused={responseEditorIsFocused}
                    setExpandedToolResult={props.setExpandedToolResult}
                    setExpandedToolCall={props.setExpandedToolCall}
                    onApprove={onApprove}
                    onDeny={onDeny}
                    approvingApprovalId={approvingApprovalId}
                    denyingApprovalId={denyingApprovalId}
                    setDenyingApprovalId={setDenyingApprovalId}
                    onCancelDeny={onCancelDeny}
                    isGroupItem={true}
                  />
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}

// Export wrapped version with error boundary
export function TaskGroupEventRow(props: TaskGroupEventRowProps) {
  return (
    <SentryErrorBoundary
      variant="response-editor"
      componentName="TaskGroupEventRow"
      handleRefresh={() => {
        const sessionId = window.location.hash.match(/sessions\/([^/?]+)/)?.[1]
        if (sessionId) {
          window.location.href = `/#/sessions/${sessionId}`
        } else {
          window.location.href = '/#/'
        }
      }}
      refreshButtonText="Reload Session"
    >
      <TaskGroupEventRowInner {...props} />
    </SentryErrorBoundary>
  )
}
