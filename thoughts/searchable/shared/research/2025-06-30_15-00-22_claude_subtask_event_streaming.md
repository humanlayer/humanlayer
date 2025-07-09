---
date: 2025-06-30 14:58:05 PDT
researcher: allison
git_commit: 3494ca1146176f35fa3879eb66b94f296a3c0128
branch: claude/issue-258-20250630_191418
repository: humanlayer
topic: "Claude Code Sub-task Event Streaming and Display in WUI"
tags: [research, codebase, event-handling, claude-code, sub-tasks, wui, streaming]
status: complete
last_updated: 2025-06-30
last_updated_by: allison
linear_tickets:
  - https://linear.app/humanlayer/issue/ENG-1478/track-and-store-parent-child-relationships-for-claude-sub-task-events
  - https://linear.app/humanlayer/issue/ENG-1479/display-claude-sub-task-events-hierarchically-in-wui-conversation-view
created: 2025-06-30
---

# Research: Claude Code Sub-task Event Streaming and Display in WUI

**Date**: 2025-06-30 14:58:05 PDT
**Researcher**: allison
**Git Commit**: 3494ca1146176f35fa3879eb66b94f296a3c0128
**Branch**: claude/issue-258-20250630_191418
**Repository**: humanlayer

## Research Question
"Interesting, I think claude code may be returning events even from the sub tasks now. I'm not positive if there is correlation between those events from the sdk and the tasks themselves. But it looks to me like the wui is displaying all of their events in the list. Probably out of order and such but they do show up."

## Summary
After comprehensive research, I can confirm that **Claude Code IS streaming sub-task events** through the SDK, and the WUI is displaying them all in a flat, chronological list. The key findings:

1. **Sub-task events ARE propagated**: The Claude Code SDK includes a `parent_tool_use_id` field in events generated within Task/Agent tool calls
2. **WUI displays ALL events**: The SessionDetail component shows all events without distinguishing between main task and sub-task events
3. **Events appear interleaved**: Sub-task events are displayed in the order they arrive, potentially making the conversation flow confusing
4. **No visual hierarchy**: There's currently no UI indication that certain events belong to sub-tasks

## Detailed Findings

### Event Streaming Architecture (hld/session/manager.go)

The daemon processes ALL events from Claude, including those with `parent_tool_use_id`:
- **Event Reception**: `session/manager.go:209` - Events received via channel from Claude process
- **Event Processing**: `session/manager.go:508-696` - All event types processed uniformly
- **Event Storage**: `store/sqlite.go:591-638` - Events stored with auto-incrementing sequence numbers
- **No Filtering**: Events with `parent_tool_use_id` are NOT filtered out

### Claude SDK Event Structure (claudecode-go/types.go)

The SDK emits events with parent tracking:
```go
type StreamEvent struct {
    Type       string      // "system", "assistant", "user", "result"
    SessionID  string      // Claude's internal session ID
    ParentToolUseID string // Non-null for sub-task events
    // ... other fields
}
```

### WUI Event Display (humanlayer-wui/src/components/internal/SessionDetail.tsx)

The WUI displays all events without distinction:
- **Event Fetching**: Uses `daemonClient.getConversation()` which returns ALL events
- **No Filtering**: Line 634 only filters out tool results, not sub-task events
- **Flat Display**: Lines 633-648 render events in chronological order
- **No Parent Tracking**: The component doesn't check or display `parent_tool_use_id`

### Experimental Evidence

Running `claude -p "spawn a sub task that reads at least 5 files..."` produced:
- Total of 22 stream events
- 7 events had non-null `parent_tool_use_id` values
- Sub-task events included: Glob, Read (5 files), and result events
- All events were emitted on the same `session_id`

Example sub-task event:
```json
{
  "type": "assistant",
  "parent_tool_use_id": "toolu_01PBJVpvVJtGFVCk4L8TmRED",
  "session_id": "e844331c-19ba-4658-9feb-ffe449924030",
  "message": { /* Read tool call */ }
}
```

### Database Analysis

Examining recent sessions in daemon.db showed:
- Session `961658f7-6fff-48c1-956b-e4fa7f17d8ea` had 6 Task tool calls
- Total of 247 events including sub-task events
- Tool call distribution: Read (44), Bash (36), Grep (18), Task (6), etc.
- Events are stored flat without parent-child relationships

## Code References

- `hld/session/manager.go:209` - Event reception from Claude
- `hld/session/manager.go:508-696` - Event processing pipeline
- `hld/store/sqlite.go:591` - Event storage
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:633-648` - Event display logic
- `humanlayer-wui/src/hooks/useConversation.ts:24-49` - Event fetching
- `claudecode-go/types.go:61-85` - StreamEvent structure

## Architecture Insights

1. **Event Flow**: Claude CLI → SDK → HLD Daemon → SQLite → WUI
2. **No Hierarchy**: The system treats all events equally, regardless of task level
3. **Real-time Streaming**: Events are published immediately via the event bus
4. **Session-based Storage**: All events stored under the same session ID

## Historical Context (from thoughts/)

From `thoughts/allison/old_stuff/tool_call_approvals.md`:
- Claude now batches multiple tool calls but executes sequentially
- This creates challenges for approval correlation and display

From `thoughts/shared/research/2025-06-24_12-29-39_session_fork_display.md`:
- Previous research on session forking considered hiding intermediate sessions
- Complex tree visualization was explored for multiple forks

## Related Research
- `thoughts/shared/research/2025-06-24_12-29-39_session_fork_display.md` - Session fork display patterns
- `thoughts/allison/old_stuff/tool_call_approvals.md` - Tool call batching behavior

## Display Opportunities

Based on the findings, here are potential improvements for sub-task event display:

### 1. **Visual Hierarchy**
- Indent sub-task events based on `parent_tool_use_id`
- Use different background colors or borders for sub-tasks
- Add collapsible sections for Task tool results

### 2. **Event Grouping**
- Group all events from a single Task call together
- Show Task description as a header
- Display sub-task events as children

### 3. **Filtering Options**
- Add toggle to hide/show sub-task events
- Filter by task level (main vs sub-tasks)
- Search within specific task contexts

### 4. **Metadata Display**
- Show `parent_tool_use_id` in event details
- Add breadcrumb navigation for task hierarchy
- Display task relationships visually

### 5. **Improved Tool Result Handling**
- Currently tool results are hidden but stored
- Could show Task results with their sub-events
- Link tool results to their originating calls

### 6. **Real-time Correlation**
- Track active Task calls and their sub-events
- Show progress indicators for ongoing tasks
- Update parent task status based on sub-task completion

## Open Questions

1. How deep can task nesting go? (Task calling Task calling Task...)
2. Should sub-task events be stored separately or with parent references?
3. How to handle approval requests within sub-tasks?
4. What's the best UX for navigating deeply nested task hierarchies?
5. Should the event bus distinguish between task levels for subscribers?