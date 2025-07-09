# Tool Output Display Implementation Plan

## Overview

Implement tool output display in the WUI event stream with intelligent abbreviation strategies for each tool type, showing collapsed one-line summaries inline with tool calls to prevent UI clutter.

## Current State Analysis

Tool outputs from Claude Code are currently being stored in the database but filtered out from the UI display. The infrastructure for displaying tool outputs already exists - we just need to enable display and implement tool-specific abbreviation logic in the frontend.

### Key Discoveries:
- Tool results are stored with full content in `tool_result_content` field (hld/store/store.go:46-77)
- Frontend filters them out at `SessionDetail.tsx:669`
- Tool results are already mapped to tool calls via `tool_result_for_id`
- Existing truncation utility at `formatting.ts:5`

### How Tool Result Mapping Works:
1. **Backend Storage** (hld/store/store.go:96-122):
   - Tool calls store a `ToolID` field (unique identifier like `toolu_011tcoLHqmK6PmkUzAAcizuZ`)
   - Tool results store a `ToolResultForID` field that references the tool call's `ToolID`
   
2. **Frontend Mapping** (SessionDetail.tsx:665-666):
   ```typescript
   const toolResults = events.filter(event => event.event_type === ConversationEventType.ToolResult)
   const toolResultsByKey = keyBy(toolResults, 'tool_result_for_id')
   ```
   This creates a lookup map where the key is the tool_result_for_id value.

3. **Linking During Render** (SessionDetail.tsx:682):
   ```typescript
   event.tool_id ? toolResultsByKey[event.tool_id] : undefined
   ```
   When rendering a tool call event, this finds the matching tool result.

4. **Important**: Tool results appear inline within the same visual block as their tool calls, not as separate events in the stream. This maintains a clean UI and clear parent-child relationship.

## What We're NOT Doing

- Implementing expand/collapse functionality for tool results (future work)
- Adding backend abbreviation logic (frontend owns this)
- Creating new UI components (reuse existing patterns)
- Handling progressive loading for large outputs (rely on abbreviation)

## Implementation Approach

Modify the existing event display logic to show tool results inline with their corresponding tool calls, using tool-specific abbreviation strategies to condense outputs to 1-3 lines maximum.

## Phase 1: Enable Tool Result Display

### Overview
Remove the filter that excludes tool results and add basic inline display underneath tool calls.

### Changes Required:

#### 1. Update Event Display Logic
**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
**Changes**: Modify eventToDisplayObject to handle tool results inline with tool calls

```typescript
// Around line 82-436, within eventToDisplayObject function
// After the main switch statement for tool calls, add tool result display:

// If this is a tool call with a result, append the result display
if (event.event_type === ConversationEventType.ToolCall && toolResult) {
  const resultDisplay = formatToolResult(event.tool_name || '', toolResult);
  if (resultDisplay) {
    // Append to existing subject with indentation
    subject = (
      <>
        {subject}
        <div className="ml-4 mt-1 text-xs text-muted-foreground font-mono">
          {resultDisplay}
        </div>
      </>
    );
  }
}
```

#### 2. Remove Tool Result Filter
**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
**Changes**: Remove the filter that excludes tool results from display

```typescript
// Line 669 - remove the filter
const displayObjects = events
  // .filter(event => event.event_type !== ConversationEventType.ToolResult)
  .map(event =>
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] Build succeeds: `bun run build`

#### Manual Verification:
- [ ] Tool results appear underneath their corresponding tool calls
- [ ] Results are visually indented from tool calls
- [ ] No duplicate display of tool results as separate events

---

## Phase 2: Implement Tool-Specific Abbreviations

### Overview
Create a `formatToolResult` function with tool-specific logic to abbreviate outputs to 1-3 lines maximum.

### Changes Required:

#### 1. Create Tool Result Formatter
**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
**Changes**: Add new function before eventToDisplayObject

```typescript
function formatToolResult(toolName: string, toolResult: ConversationEvent): React.ReactNode {
  const content = toolResult.tool_result_content || '';
  const isError = toolResult.is_error ||
                  content.toLowerCase().includes('error') ||
                  content.toLowerCase().includes('failed') ||
                  content.toLowerCase().includes('exception');

  let abbreviated: string;

  switch (toolName) {
    case 'Read':
      // Count lines with the arrow format (e.g., "     1→content")
      const lineCount = content.split('\n').length;
      abbreviated = `Read ${lineCount} lines`;
      break;

    case 'Bash':
      const lines = content.split('\n').filter(l => l.trim());
      if (!content || lines.length === 0) {
        abbreviated = 'Command completed';
      } else if (lines.length === 1) {
        abbreviated = truncate(lines[0], 80);
      } else {
        abbreviated = `${truncate(lines[0], 60)} ... (${lines.length} lines)`;
      }
      break;

    case 'Edit':
      if (content.includes('has been updated')) {
        abbreviated = '✓ File updated';
      } else if (content.includes('No changes made')) {
        abbreviated = '- No changes made';
      } else if (isError) {
        abbreviated = '✗ Edit failed';
      } else {
        abbreviated = '✓ File updated';
      }
      break;

    case 'MultiEdit':
      const editMatch = content.match(/Applied (\d+) edits?/);
      if (editMatch) {
        abbreviated = `✓ Applied ${editMatch[1]} edits`;
      } else if (isError) {
        abbreviated = '✗ MultiEdit failed';
      } else {
        abbreviated = '✓ Edits applied';
      }
      break;

    case 'Write':
      if (content.includes('successfully')) {
        abbreviated = '✓ File written';
      } else if (isError) {
        abbreviated = '✗ Write failed';
      } else {
        abbreviated = '✓ File written';
      }
      break;

    case 'Glob':
      if (content === 'No files found') {
        abbreviated = 'No files found';
      } else {
        const fileCount = content.split('\n').filter(l => l.trim()).length;
        abbreviated = `Found ${fileCount} files`;
      }
      break;

    case 'Grep':
      // Extract the count from "Found X files" at the start
      const grepCountMatch = content.match(/Found (\d+) files?/);
      if (grepCountMatch) {
        abbreviated = `Found ${grepCountMatch[1]} files`;
      } else if (content.includes('No matches found')) {
        abbreviated = 'No matches found';
      } else {
        // Fallback: count lines
        const fileCount = content.split('\n').filter(l => l.trim() && !l.includes('(Results are truncated')).length;
        abbreviated = `Found ${fileCount} files`;
      }
      break;

    case 'LS':
      // Count items in the tree structure (lines starting with " - ")
      const lsItems = content.split('\n').filter(l => l.trim().startsWith('-')).length;
      abbreviated = `${lsItems} items`;
      break;

    case 'Task':
      // Task outputs are typically longer summaries
      const firstLine = content.split('\n')[0];
      abbreviated = truncate(firstLine, 100) || 'Task completed';
      break;

    case 'TodoRead':
      // Extract todo count from the message
      const todoArrayMatch = content.match(/\[([^\]]*)\]/);
      if (todoArrayMatch) {
        const todos = todoArrayMatch[1];
        if (!todos) {
          abbreviated = '0 todos';
        } else {
          const todoCount = todos.split('},').length;
          abbreviated = `${todoCount} todo${todoCount !== 1 ? 's' : ''}`;
        }
      } else {
        abbreviated = 'Todo list read';
      }
      break;

    case 'TodoWrite':
      abbreviated = '✓ Todos updated';
      break;

    case 'WebFetch':
      if (content.includes('Failed to fetch') || isError) {
        abbreviated = '✗ Fetch failed';
      } else {
        // Show character count
        const charCount = content.length;
        if (charCount > 1024) {
          abbreviated = `Fetched ${(charCount / 1024).toFixed(1)}kb`;
        } else {
          abbreviated = `Fetched ${charCount} chars`;
        }
      }
      break;

    case 'WebSearch':
      // Count "Links:" occurrences to estimate result batches
      const linkMatches = content.match(/Links: \[/g);
      const linkCount = linkMatches ? linkMatches.length : 0;
      // Estimate ~10 results per batch
      const estimatedResults = linkCount * 10;
      abbreviated = estimatedResults > 0 ? `Found ~${estimatedResults} results` : 'Search completed';
      break;

    case 'NotebookRead':
      const cellMatch = content.match(/(\d+) cells?/i);
      abbreviated = cellMatch ? `Read ${cellMatch[1]} cells` : 'Notebook read';
      break;

    case 'NotebookEdit':
      abbreviated = '✓ Notebook updated';
      break;

    case 'exit_plan_mode':
      abbreviated = 'Exited plan mode';
      break;

    default:
      // Unknown tools: show first line or truncate
      const defaultFirstLine = content.split('\n')[0];
      abbreviated = truncate(defaultFirstLine, 80) || 'Completed';
  }

  // Apply error styling if needed
  if (isError) {
    return <span className="text-destructive">{abbreviated}</span>;
  }

  return abbreviated;
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Unit test coverage added for all rendering logic
- [ ] All existing tests pass: `bun test`
- [ ] Type checking passes: `bun run typecheck`
- [ ] No linting errors: `bun run lint`

#### Manual Verification:
- [ ] Each tool type shows appropriate abbreviated output
- [ ] Outputs are limited to 1-3 lines (mostly 1 line)
- [ ] Error outputs have distinct styling (red/destructive color)
- [ ] Unknown tools gracefully fallback to truncated first line

---

## Phase 3: Visual Polish and Edge Cases

### Overview
Refine the visual presentation and handle edge cases like empty results, very long single lines, and special characters.

### Changes Required:

#### 1. Handle Edge Cases in Formatter
**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
**Changes**: Update formatToolResult to handle edge cases

```typescript
function formatToolResult(toolName: string, toolResult: ConversationEvent): React.ReactNode {
  const content = toolResult.tool_result_content || '';

  // Handle empty content
  if (!content.trim()) {
    return <span className="text-muted-foreground italic">No output</span>;
  }

  // Handle JSON parsing errors for tools that might return JSON
  if (toolName === 'Task' || toolName === 'TodoRead') {
    try {
      const parsed = JSON.parse(content);
      // Handle parsed JSON if needed
    } catch (e) {
      // Continue with string processing
    }
  }

  // ... rest of the function
}
```

#### 2. Add Consistent Styling
**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
**Changes**: Ensure consistent visual hierarchy

```typescript
// In the tool call display section where we append the result
if (event.event_type === ConversationEventType.ToolCall && toolResult) {
  const resultDisplay = formatToolResult(event.tool_name || '', toolResult);
  if (resultDisplay) {
    subject = (
      <>
        {subject}
        <div className="ml-6 mt-1 text-xs text-muted-foreground font-mono flex items-center gap-1">
          <span className="text-muted-foreground/50">→</span>
          {resultDisplay}
        </div>
      </>
    );
  }
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Build completes without warnings: `bun run build`
- [ ] Format check passes: `bun run format:check`

#### Manual Verification:
- [ ] Empty results show "No output" in italic
- [ ] Tool results are visually subordinate to tool calls
- [ ] Arrow or other indicator shows the relationship
- [ ] Special characters don't break the layout
- [ ] Very long single lines are properly truncated

---

## Testing Strategy

### Unit Tests:
- Test formatToolResult with various content types
- Verify truncation logic works correctly
- Test error detection logic

### Integration Tests:
- Verify tool results appear in the correct position
- Test with sessions containing multiple tool calls
- Verify performance with sessions containing many events

### Manual Testing Steps:
1. Start the WUI development server: `bun run tauri dev`
2. Open a Claude Code session with various tool uses
3. Verify each tool type displays its abbreviated output correctly
4. Check that errors are styled differently (red text)
5. Verify results appear indented under their tool calls
6. Test with very long outputs to ensure proper truncation
7. Test with empty tool results

## Performance Considerations

- Tool result abbreviation happens during render, which is acceptable for current usage
- If performance becomes an issue with many events, consider memoizing the formatToolResult function
- The current approach avoids modifying the data structure, keeping the change minimal

## Example Tool Outputs

### Grep
**Example output:**
```
Found 277 files
/Users/dex/go/src/github.com/humanlayer/humanlayer/thoughts/searchable/shared/plans/tool-output-display-eng-1501.md
/Users/dex/go/src/github.com/humanlayer/humanlayer/thoughts/searchable/shared/research/2025-07-03_09-43-22_wui_diff_view_tickets.md
/Users/dex/go/src/github.com/humanlayer/humanlayer/thoughts/searchable/shared/prs/271_description.md
[... truncated ...]
(Results are truncated. Consider using a more specific path or pattern.)
```
**Abbreviated display:** `Found 277 files`

### Read
**Example output:**
```
     1→<div align="center">
     2→
     3→![Wordmark Logo of HumanLayer](./docs/images/wordmark-light.svg)
     4→
     5→</div>
[... 248 lines total ...]
```
**Abbreviated display:** `Read 248 lines`

### Bash
**Example outputs:**
1. With output:
```
hello world
total 1128
drwxr-xr-x  44 dex  staff    1408 Jul  7 11:11 .
drwxr-xr-x  13 dex  staff     416 Jun 20 12:08 ..
drwxr-xr-x   4 dex  staff     128 Jul  1 12:57 .claude
```
**Abbreviated:** `hello world ... (5 lines)`

2. No output:
```
(empty string)
```
**Abbreviated:** `Command completed`

### LS
**Example output:**
```
- /Users/dex/go/src/github.com/humanlayer/humanlayer/
  - CHANGELOG.md
  - CLAUDE.md
  - CONTRIBUTING.md
  - Dockerfile
  - LICENSE
  - Makefile
  - README.md
  - claudecode-go/
    - client.go
    - types.go
  - docs/
    - api-reference/
      - introduction.mdx
```
**Abbreviated:** `42 items`

### Glob
**Example outputs:**
1. With matches:
```
/Users/dex/go/src/github.com/humanlayer/humanlayer/test1.md
/Users/dex/go/src/github.com/humanlayer/humanlayer/test2.md
```
**Abbreviated:** `Found 2 files`

2. No matches:
```
No files found
```
**Abbreviated:** `No files found`

### Edit
**Example output:**
```
The file /Users/dex/go/src/github.com/humanlayer/humanlayer/test_file.txt has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
     1→Goodbye World
```
**Abbreviated:** `✓ File updated`

### MultiEdit
**Example output:**
```
Applied 2 edits to /Users/dex/go/src/github.com/humanlayer/humanlayer/test_multi.txt:
1. Replaced "Line 1 original" with "First edit"
2. Replaced "Line 3 original" with "Third edit"
```
**Abbreviated:** `✓ Applied 2 edits`

### Write
**Example output:**
```
File created successfully at: /Users/dex/go/src/github.com/humanlayer/humanlayer/test_file.txt
```
**Abbreviated:** `✓ File written`

### WebSearch
**Example output:**
```
Web search results for query: "Claude Code HumanLayer"

I'll search for "Claude Code HumanLayer" to find information about this topic.

Links: [{"title":"Claude Code: Deep Coding at Terminal Velocity \\ Anthropic","url":"https://www.anthropic.com/claude-code"}...]

Based on the search results, I found information about Claude Code but not specifically about "HumanLayer"...
[Multiple paragraphs of synthesized information]
```
**Abbreviated:** `Found 10 results`

### WebFetch
**Example output:**
```
This is a simple web page for the "Example Domain", which serves as a placeholder for illustrative purposes in documents. The page indicates that anyone can use this domain in literature without needing prior permission...
```
**Abbreviated:** `Fetched 156 chars`

### TodoRead
**Example output:**
```
Remember to continue to use update and read from the todo list as you make progress. Here is the current list: []
```
**Abbreviated:** `0 todos`

### TodoWrite
**Example output:**
```
Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable
```
**Abbreviated:** `✓ Todos updated`

### Task
**Note:** Task outputs are handled separately and will show first 100 chars

### NotebookRead/NotebookEdit
**Note:** Not tested as these are specialized tools

### exit_plan_mode
**Note:** Special tool that triggers UI state change

## Migration Notes

No data migration needed - this is a display-only change. Tool results are already stored in the database.

## References

- Original ticket: `thoughts/shared/research/2025-07-07_11-48-11_tool-output-display-eng-1501.md`
- Tool result filter location: `SessionDetail.tsx:669`
- Existing truncation utility: `formatting.ts:5`
