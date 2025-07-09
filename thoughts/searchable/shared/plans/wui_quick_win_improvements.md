# WUI Quick Win Improvements Implementation Plan

## Overview

This plan covers four quick win improvements to the WUI that can be implemented with minimal code changes but provide significant UX enhancements.

## Current State Analysis

Based on research, the WUI has recently undergone phase 1 refactoring that successfully extracted major components. These quick wins leverage that modular structure to make targeted improvements with minimal risk.

### Key Discoveries:
- Tool completion status tracked via `is_completed` field (humanlayer-wui/src/lib/daemon/types.ts:245)
- React-diff-viewer-continued library supports multiple diff methods (humanlayer-wui/package.json)
- Existing pattern for vertical alignment in TodoWidget.tsx:40
- Loading indicator already exists but needs tool name display (humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx:388-396)

## What We're NOT Doing

- Not changing the 1-second polling architecture
- Not implementing full real-time streaming (that's a separate plan)
- Not adding user preferences/settings UI
- Not refactoring the overall component structure

## Implementation Approach

Implement all four quick wins in a single PR since they are independent, low-risk changes that improve the UX without architectural changes.

## Phase 1: All Quick Win Improvements

### Overview
Implement four targeted UX improvements that require minimal code changes.

### Changes Required:

#### 1. "No Output Yet" Distinction
**File**: `humanlayer-wui/src/components/internal/SessionDetail/formatToolResult.tsx`
**Changes**: Add is_completed parameter and conditional text

Update function signature (line 10):
```typescript
export function formatToolResult(toolName: string, toolResult: ConversationEvent, isCompleted: boolean = true): React.ReactNode {
```

Update empty content handling (lines 14-16):
```typescript
// Handle empty content
if (!content.trim()) {
  const message = isCompleted ? 'No output' : 'No output yet...'
  return <span className="text-muted-foreground italic">{message}</span>
}
```

**File**: `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx`
**Changes**: Pass is_completed to formatToolResult

Update the call site (line 408):
```typescript
toolResultContent = formatToolResult(
  toolCall.tool_name,
  toolResult,
  toolCall.is_completed
)
```

#### 2. Message Content Vertical Centering
**File**: `humanlayer-wui/src/components/internal/SessionDetail/views/ConversationContent.tsx`
**Changes**: Fix alignment classes

Update flex container (line 258):
```typescript
<div className="flex items-start gap-2">
```

Update icon styling (lines 260-261):
```typescript
<span className="text-sm text-accent flex-shrink-0 mt-0.5">
  {displayObject.iconComponent}
</span>
```

#### 3. Word-Based Diffing
**File**: `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx`
**Changes**: Import DiffMethod and add compareMethod prop

Add import at top:
```typescript
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
```

Update Edit tool diff viewer (lines 236-243):
```typescript
<ReactDiffViewer
  oldValue={toolInput.old_string}
  newValue={toolInput.new_string}
  splitView={isSplitView ?? true}
  compareMethod={DiffMethod.WORDS}
  hideLineNumbers={true}
/>
```

Update MultiEdit tool diff viewer (lines 272-279):
```typescript
<ReactDiffViewer
  oldValue={edit.old_string}
  newValue={edit.new_string}
  splitView={isSplitView ?? true}
  compareMethod={DiffMethod.WORDS}
  hideLineNumbers={true}
/>
```

#### 4. Basic Tool Name in Loading Indicator
**File**: `humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx`
**Changes**: Add tool name display to loading section

Add before the loading indicator section (line 388):
```typescript
// Find the most recent incomplete tool call
const lastIncompleteToolCall = events
  ?.toReversed()
  .find(e => 
    e.event_type === ConversationEventType.ToolCall && 
    !e.is_completed
  )
```

Update loading indicator content (lines 388-396):
```typescript
{isRunning && (
  <div className="flex flex-col gap-1 mt-2 border-t pt-2">
    <h2 className="text-sm font-medium text-muted-foreground">
      robot magic is happening
      {lastIncompleteToolCall && (
        <span className="ml-1">
          - {lastIncompleteToolCall.tool_name === 'LS' ? 'List' : lastIncompleteToolCall.tool_name}
        </span>
      )}
    </h2>
    <div className="space-y-2">
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-4 w-1/5" />
    </div>
  </div>
)}
```

Add import at top if not already present:
```typescript
import { ConversationEventType } from '@/lib/daemon/types'
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] Build completes successfully: `bun run build`

#### Manual Verification:
- [ ] Tool results show "No output yet..." while running, "No output" when complete
- [ ] Message content and icons are properly vertically aligned
- [ ] Diff viewer shows word-based differences instead of character-based
- [ ] Loading indicator shows current tool name (e.g., "robot magic is happening - Bash")
- [ ] All changes work correctly in both light and dark themes
- [ ] No visual regressions in other parts of the UI

---

## Testing Strategy

### Manual Testing Steps:
1. Start a Claude Code session that uses multiple tools
2. Verify "No output yet..." appears for running tools
3. Verify "No output" appears for completed tools with empty output
4. Check that message icons align properly with both single and multi-line content
5. Create an Edit or MultiEdit approval and verify word-based diffing
6. Watch the loading indicator and confirm it shows the current tool name
7. Test in both light and dark themes

### Edge Cases to Test:
- Tools that complete very quickly (should still briefly show "No output yet...")
- Tools with very long names in the loading indicator
- Messages with very long single lines (alignment should remain consistent)
- Diff viewer with very long lines or many changes

## Performance Considerations

All changes are display-only and have minimal performance impact:
- No additional API calls or data fetching
- Array reversal for finding last tool is O(n) but events array is typically small
- Word-based diffing may be slightly slower than character-based but difference is negligible

## References

- Original research: `thoughts/shared/research/2025-07-08_12-41-49_wui_post_refactor_improvements.md`
- SessionDetail refactoring plan: `thoughts/shared/plans/sessiondetail_complete_refactoring_plan.md`
- Component files modified: formatToolResult.tsx, ConversationContent.tsx, eventToDisplayObject.tsx, SessionDetail.tsx