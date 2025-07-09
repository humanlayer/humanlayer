---
date: 2025-07-07T11:47:45-07:00
researcher: dex
git_commit: 8c4a8c398682ca30e4219ec4bc98a2528cd83667
branch: main
repository: humanlayer
topic: "Tool Output Display in Event Stream (ENG-1501)"
tags: [research, codebase, tool-output, event-stream, claude-code, eng-1501]
status: complete
last_updated: 2025-07-07
last_updated_by: dex
---

# Research: Tool Output Display in Event Stream (ENG-1501)

**Date**: 2025-07-07 11:47:45 PDT
**Researcher**: dex
**Git Commit**: 8c4a8c398682ca30e4219ec4bc98a2528cd83667
**Branch**: main
**Repository**: humanlayer

## Research Question
How does Claude Code JSONL output get processed by the daemon, and what needs to be implemented to show abbreviated tool outputs in the event stream? The implementation should consider data handling, variety of tools, abbreviated displays for known tools, and graceful handling of unknown tools.

## Summary
Tool outputs from Claude Code are currently being stored in the database but filtered out from the UI display. The infrastructure for displaying tool outputs already exists - we just need to:
1. Remove the filter that excludes tool results from the display
2. Implement tool-specific abbreviation strategies
3. Add visual connection between tool calls and their results

## Detailed Findings

### Current State
- **Tool results ARE stored**: The hld daemon captures and stores complete tool outputs in the database
- **Tool results ARE NOT displayed**: Frontend filters them out at `humanlayer-wui/src/components/internal/SessionDetail.tsx:669`
- **No abbreviation in daemon**: hld passes through tool outputs unmodified - abbreviation must happen in UI
- **Infrastructure exists**: Event streaming, data structures, and storage all support tool outputs

### Data Flow Architecture

#### 1. Claude Code → hld Processing
**Location**: `claudecode-go/client.go:289-355` (parseStreamingJSON)
- Claude Code outputs JSONL with tool_use and tool_result events
- Events parsed into StreamEvent structs
- Sent to session manager via channels

#### 2. Event Processing in hld
**Location**: `hld/session/manager.go:517-708` (processStreamEvent)
- Tool use events stored with full input JSON
- Tool result events stored with complete output content
- Published to event bus as EventConversationUpdated
- NO abbreviation or truncation occurs here

#### 3. Storage Structure
**Database**: `hld/store/store.go`
```go
type ConversationEvent struct {
    // Tool call fields
    ToolID          string      // Unique tool invocation ID
    ToolName        string      // Name of the tool
    ToolInputJSON   string      // JSON parameters
    
    // Tool result fields
    ToolResultForID   string    // Links to ToolID
    ToolResultContent string    // Complete output
}
```

#### 4. Frontend Display
**Location**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
- Tool calls shown with custom formatting (lines 108-229)
- Tool results filtered out (line 669: `event.event_type !== 'tool_result'`)
- Existing patterns for different tools (Read, Bash, Edit, etc.)

### Tool-Specific Display Patterns
The frontend already implements tool-specific display for tool calls:
- **Read**: Shows file path
- **Bash**: Shows command in terminal style
- **Edit/MultiEdit**: Shows file and edit count
- **LS**: Shows directory path
- **Glob**: Shows pattern and path
- **Grep**: Shows search pattern
- **Write**: Shows file path and content preview

### Key Discovery: Tool Results Already Available
Tool results are already:
1. Captured by the daemon
2. Stored in the database
3. Fetched by the frontend
4. Mapped by tool ID: `toolResultsByKey[event.tool_id]`
5. Just filtered out from display!

## Implementation Recommendations for ENG-1501

### Phase 1: Display Tool Results (Quick Win)
1. Remove filter at `SessionDetail.tsx:669`
2. Add basic tool result display in `eventToDisplayObject`
3. Show abbreviated content with expand option

### Phase 2: Tool-Specific Abbreviation
Implement abbreviation strategies in `eventToDisplayObject`:

```typescript
case 'tool_result':
  const toolCall = events.find(e => e.tool_id === event.tool_result_for_id);
  const content = event.tool_result_content || '';
  
  switch (toolCall?.tool_name) {
    case 'Read':
      // Show "Read 306 lines from file.txt"
      const lineCount = content.split('\n').length;
      return `Read ${lineCount} lines`;
      
    case 'Bash':
      // Show first 10 lines of output
      const lines = content.split('\n');
      if (lines.length > 10) {
        return lines.slice(0, 10).join('\n') + `\n... (${lines.length - 10} more lines)`;
      }
      return content;
      
    case 'Edit':
      // Show success/failure status
      return content.includes('has been updated') ? '✓ File updated' : '✗ Edit failed';
      
    default:
      // Unknown tools: truncate to 200 chars
      return content.length > 200 ? content.slice(0, 200) + '...' : content;
  }
```

### Phase 3: Visual Connection
1. Group tool results with their tool calls
2. Use indentation or visual hierarchy
3. Consider collapsible sections for large outputs

### Phase 4: Performance Optimization
1. Implement virtual scrolling for large outputs
2. Lazy load full content on expand
3. Consider pagination for very long tool result lists

## Code References
- `claudecode-go/client.go:289-355` - JSONL parsing from Claude Code
- `hld/session/manager.go:594-680` - Tool event processing
- `hld/store/store.go:46-77` - ConversationEvent structure
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:82-436` - Event display logic
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:669` - **Tool result filter to remove**
- `humanlayer-wui/src/lib/daemon/types.ts:229-250` - TypeScript event types

## Architecture Insights
1. **No abbreviation in backend**: All abbreviation should happen in UI for flexibility
2. **Event-driven architecture**: Tool outputs flow through event bus to subscribers
3. **Type safety**: Strong typing from Go through JSON-RPC to TypeScript
4. **Storage efficiency**: Full content stored once, referenced by ID

## Historical Context (from thoughts/)
- The event streaming architecture was designed to capture all Claude events
- Previous work (ENG-1479) implemented hierarchical task display with collapsible UI
- The system was built to support real-time event streaming but currently uses polling

## Related Research
- Task hierarchical display patterns could be reused for tool output grouping
- Existing truncation utilities in `utils/formatting.ts`

## Open Questions
1. Should tool results be shown inline or in a separate panel?
2. How should very large outputs (MB+) be handled?
3. Should we implement progressive loading for better performance?
4. Do we need different abbreviation strategies for different contexts (compact vs expanded view)?

## Conclusion
Implementing tool output display is straightforward - the infrastructure already exists. The main work is:
1. Remove the single line filter (line 669)
2. Add tool-specific abbreviation logic
3. Enhance the UI for better visual hierarchy

This will complete ENG-1501 and provide users with the Claude Code-inspired tool output visibility they need.