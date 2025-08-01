import { useState, useEffect, useMemo } from 'react'
import { ConversationEvent, ConversationEventType, ApprovalStatus } from '@/lib/daemon/types'

export interface TaskEventGroup {
  parentTask: ConversationEvent
  subTaskEvents: ConversationEvent[]
  // Computed preview data
  toolCallCount: number
  latestEvent: ConversationEvent | null
  hasPendingApproval: boolean
}

// Only build groups if sub-tasks exist
function buildTaskGroups(events: ConversationEvent[]): {
  taskGroups: Map<string, TaskEventGroup>
  rootEvents: ConversationEvent[]
  hasSubTasks: boolean
} {
  // Quick check: if no events have parentToolUseId, skip building
  const hasSubTasks = events.some(e => e.parentToolUseId)
  if (!hasSubTasks) {
    return {
      taskGroups: new Map(),
      rootEvents: events,
      hasSubTasks: false,
    }
  }

  const taskGroups = new Map<string, TaskEventGroup>()
  const rootEvents: ConversationEvent[] = []
  const eventsByParent = new Map<string, ConversationEvent[]>()

  // Single pass to categorize events
  events.forEach(event => {
    if (event.parentToolUseId) {
      const siblings = eventsByParent.get(event.parentToolUseId) || []
      siblings.push(event)
      eventsByParent.set(event.parentToolUseId, siblings)
    } else {
      rootEvents.push(event)
    }
  })

  // Build task groups for parent Tasks
  rootEvents.forEach(event => {
    if (event.toolName === 'Task' && event.toolId && eventsByParent.has(event.toolId)) {
      const subEvents = eventsByParent.get(event.toolId)!

      // Calculate preview data
      const toolCalls = subEvents.filter(e => e.eventType === ConversationEventType.ToolCall)
      const latestEvent = subEvents[subEvents.length - 1]

      taskGroups.set(event.toolId, {
        parentTask: event,
        subTaskEvents: subEvents,
        toolCallCount: toolCalls.length,
        latestEvent: latestEvent || null,
        hasPendingApproval: subEvents.some(e => e.approvalStatus === ApprovalStatus.Pending),
      })
    }
  })

  return { taskGroups, rootEvents, hasSubTasks: true }
}

export function useTaskGrouping(events: ConversationEvent[]) {
  // Track expansion state
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())

  // Track previous expansion state for approval flow
  const [preApprovalExpanded, setPreApprovalExpanded] = useState<Set<string> | null>(null)

  // Process events into display structure (memoized for performance)
  const { taskGroups, rootEvents, hasSubTasks } = useMemo(() => buildTaskGroups(events), [events])

  // Auto-expand tasks with pending approvals
  useEffect(() => {
    if (!hasSubTasks) return

    const tasksWithPendingApprovals = new Set<string>()
    taskGroups.forEach((group, taskId) => {
      if (group.hasPendingApproval) {
        tasksWithPendingApprovals.add(taskId)
      }
    })

    if (tasksWithPendingApprovals.size > 0) {
      // Save current state before auto-expanding
      if (!preApprovalExpanded) {
        setPreApprovalExpanded(new Set(expandedTasks))
      }
      // Expand tasks with approvals
      setExpandedTasks(prev => new Set([...prev, ...tasksWithPendingApprovals]))
    } else if (preApprovalExpanded) {
      // Restore previous state after approvals are handled
      setExpandedTasks(preApprovalExpanded)
      setPreApprovalExpanded(null)
    }
  }, [taskGroups, hasSubTasks])

  // Toggle function
  const toggleTaskGroup = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }

  return {
    taskGroups,
    rootEvents,
    hasSubTasks,
    expandedTasks,
    toggleTaskGroup,
  }
}
