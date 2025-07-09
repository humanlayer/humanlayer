# ENG-1479: Hierarchical Task Display Implementation Plan

## Overview

This plan implements hierarchical display of Claude sub-task events in the WUI conversation view. Sub-tasks are spawned by the Task tool and run in parallel, with each having a `parent_tool_use_id` that references the main Task event. We need to group these events visually under their parent Task, defaulting to a collapsed view with a preview.

## Key Constraints & Clarifications

1. **Single-level hierarchy only**: Main conversation → Sub-tasks (no nested sub-tasks)
2. **Parallel execution**: Multiple sub-tasks can run simultaneously
3. **Independent completion**: Sub-tasks complete independently as they receive tool results
4. **Approvals in sub-tasks**: Need to handle approval display for sub-task events
5. **Default collapsed**: Task groups should be collapsed by default, showing a preview

## Backend Changes (Already Complete)

The backend now provides `parent_tool_use_id` field in ConversationEvent:
- Added to all layers: types, store, RPC
- Links sub-task events to their parent Task via `tool_id`

## Current State

The WUI currently:
- Displays all events in a flat chronological list
- Polls `getConversation` to refresh the event list
- Shows events with timestamp, icon, and content
- Has expand/collapse functionality for individual events
- Shows approvals inline with their related tool calls

## Implementation Design

### Phase 1: Efficient Task Group Building

**Core Logic:**
```typescript
interface TaskEventGroup {
  parentTask: ConversationEvent
  subTaskEvents: ConversationEvent[]
  // Computed preview data
  toolCallCount: number
  latestEvent: ConversationEvent | null
  hasPendingApproval: boolean
}

// Only build groups if sub-tasks exist
function buildTaskGroups(events: ConversationEvent[]): {
  taskGroups: Map<string, TaskEventGroup>,
  rootEvents: ConversationEvent[],
  hasSubTasks: boolean
} {
  // Quick check: if no events have parent_tool_use_id, skip building
  const hasSubTasks = events.some(e => e.parent_tool_use_id)
  if (!hasSubTasks) {
    return { 
      taskGroups: new Map(), 
      rootEvents: events,
      hasSubTasks: false 
    }
  }
  
  const taskGroups = new Map<string, TaskEventGroup>()
  const rootEvents: ConversationEvent[] = []
  const eventsByParent = new Map<string, ConversationEvent[]>()
  
  // Single pass to categorize events
  events.forEach(event => {
    if (event.parent_tool_use_id) {
      const siblings = eventsByParent.get(event.parent_tool_use_id) || []
      siblings.push(event)
      eventsByParent.set(event.parent_tool_use_id, siblings)
    } else {
      rootEvents.push(event)
    }
  })
  
  // Build task groups for parent Tasks
  rootEvents.forEach(event => {
    if (event.tool_name === 'Task' && eventsByParent.has(event.tool_id!)) {
      const subEvents = eventsByParent.get(event.tool_id!)!
      
      // Calculate preview data
      const toolCalls = subEvents.filter(e => e.event_type === ConversationEventType.ToolCall)
      const latestEvent = subEvents[subEvents.length - 1]
      
      taskGroups.set(event.tool_id!, {
        parentTask: event,
        subTaskEvents: subEvents,
        toolCallCount: toolCalls.length,
        latestEvent: latestEvent || null,
        hasPendingApproval: subEvents.some(
          e => e.approval_status === ApprovalStatus.Pending
        )
      })
    }
  })
  
  return { taskGroups, rootEvents, hasSubTasks: true }
}

```

### Phase 2: State Management with Approval Handling

**State Management:**
```typescript
// Track expansion state
const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())

// Track previous expansion state for approval flow
const [preApprovalExpanded, setPreApprovalExpanded] = useState<Set<string> | null>(null)

// Process events into display structure (memoized for performance)
const { taskGroups, rootEvents, hasSubTasks } = useMemo(() => 
  buildTaskGroups(events), [events]
)

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
```

### Phase 3: Task Group Component with Preview

```typescript
interface TaskGroupProps {
  group: TaskEventGroup
  isExpanded: boolean
  onToggle: () => void
  onEventInteraction: (event: ConversationEvent) => void
  // Pass through props for event rendering
  focusedEventId: number | null
  // ... other event props
}

function TaskGroup({ group, isExpanded, onToggle, ...eventProps }: TaskGroupProps) {
  const { parentTask, toolCallCount, latestEvent, hasPendingApproval } = group
  const description = JSON.parse(parentTask.tool_input_json || '{}').description || 'Task'
  const isCompleted = parentTask.is_completed
  
  return (
    <div className="mb-4">
      {/* Task Header with Preview */}
      <div 
        className="flex items-start gap-2 py-2 px-3 rounded-md cursor-pointer hover:bg-muted/10 transition-colors"
        onClick={onToggle}
      >
        <ChevronDown 
          className={`w-4 h-4 mt-0.5 transition-transform ${!isExpanded ? '-rotate-90' : ''}`} 
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-accent" />
            <span className="font-medium">{description}</span>
            {!isCompleted && (
              <CircleDashed className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
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
                <EventDisplay event={latestEvent} {...eventProps} compact />
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
        <div className="ml-6 mt-2 pl-4 border-l-2 border-border/50">
          {group.subTaskEvents.map(subEvent => (
            <div key={subEvent.id} className="mb-2">
              {/* Use existing event rendering logic */}
              <EventDisplay event={subEvent} {...eventProps} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

### Phase 4: Update Main Render Logic

**ConversationContent Render:**
```typescript
// Early return for no sub-tasks case (most common)
if (!hasSubTasks) {
  return (
    <div ref={containerRef} className="max-h-[calc(100vh-475px)] overflow-y-auto">
      <div>
        {events.map((event, index) => (
          <EventDisplay key={event.id} event={event} {...eventProps} />
        ))}
      </div>
    </div>
  )
}

// Render with task groups
return (
  <div ref={containerRef} className="max-h-[calc(100vh-475px)] overflow-y-auto">
    <div>
      {rootEvents.map((event) => {
        const taskGroup = taskGroups.get(event.tool_id || '')
        
        if (taskGroup) {
          return (
            <TaskGroup
              key={event.id}
              group={taskGroup}
              isExpanded={expandedTasks.has(event.tool_id!)}
              onToggle={() => toggleTaskGroup(event.tool_id!)}
              focusedEventId={focusedEventId}
              // ... pass through other props
            />
          )
        } else {
          return <EventDisplay key={event.id} event={event} {...eventProps} />
        }
      })}
    </div>
  </div>
)
```

### Phase 5: Performance Considerations

**Polling and Re-renders:**
1. The `buildTaskGroups` function is memoized with `useMemo` and only re-runs when events change
2. Quick early exit if no sub-tasks exist (most conversations)
3. Single-pass event categorization for efficiency
4. Expansion state is preserved across polling updates

**React Optimization:**
- Task groups are keyed by stable `event.id`
- Expansion state changes only affect the specific task group
- Preview data is computed during group building, not on each render

## Implementation Steps

### 1. Update Types
**File: `humanlayer-wui/src/lib/daemon/types.ts`**
- Add `parent_tool_use_id?: string` to ConversationEvent interface

**File: `humanlayer-wui/src/components/internal/SessionDetail.tsx`**
- Add TaskEventGroup interface at the top of the file

### 2. Build Grouping Logic
**File: `humanlayer-wui/src/components/internal/SessionDetail.tsx`**
- Add `buildTaskGroups` function before ConversationContent component
- Include early exit for conversations without sub-tasks
- Calculate preview data (latest event, tool count) during grouping

### 3. Update ConversationContent Component
**File: `humanlayer-wui/src/components/internal/SessionDetail.tsx`**
- Add expansion state hooks after existing state declarations
- Add approval auto-expansion useEffect
- Replace current event mapping logic with task group aware rendering
- Add early return path for conversations without sub-tasks

### 4. Create TaskGroup Component
**File: `humanlayer-wui/src/components/internal/SessionDetail.tsx`**
- Add TaskGroup component definition before ConversationContent
- Implement collapsible header with Task description
- Show latest event preview using existing EventDisplay component
- Add "+X more tool calls" text for multiple events
- Use `is_completed` from parent task to show spinner

### 5. Handle Edge Cases
**File: `humanlayer-wui/src/components/internal/SessionDetail.tsx`**
- In buildTaskGroups: handle events with missing parent_tool_use_id
- In TaskGroup: handle empty sub-task arrays gracefully
- Use truncate utility for very long task descriptions

## Testing Scenarios

### 1. Conversation without sub-tasks
- Verify normal flat display works as before
- Ensure no performance impact from grouping logic
- Confirm early exit path is taken

### 2. Conversation with single sub-task
- Task appears collapsed by default with preview
- Clicking expands to show sub-events
- Preview updates as new tool calls arrive
- Completion status reflected correctly

### 3. Multiple parallel sub-tasks
- Each task group operates independently
- Can expand/collapse individual groups
- Earlier completed tasks and later active tasks display correctly
- Preview shows accurate tool call counts

### 4. Sub-task approval flow
- Approval request auto-expands the parent task
- After approve/deny, task returns to previous expansion state
- Multiple simultaneous approvals handled correctly
- Approval badge visible on collapsed task header