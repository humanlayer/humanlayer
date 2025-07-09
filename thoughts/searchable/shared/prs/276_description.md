## What problem(s) was I solving?

The conversation view in the HumanLayer WUI was missing visibility into tool execution results. Users couldn't see what happened after a tool was executed without digging into the details, making it difficult to follow the flow of AI agent actions and understand their outcomes at a glance.

## What user-facing changes did I ship?

- **Inline tool result summaries**: Tool results now appear directly beneath tool calls with intelligent abbreviations (e.g., "Read 158 lines", "Found 12 files", "Applied 3 edits")
- **Smart error detection**: Tool results that contain errors are highlighted in red for immediate visibility
- **Expandable full results**: Press 'i' when focused on a tool call to see the complete output in a modal
- **Visual improvements**: Reduced padding throughout the conversation view for a more compact, scannable interface
- **Enhanced keyboard navigation**: Added 'i' hotkey to expand tool results, with j/k navigation within the modal

## How I implemented it

1. **Created `formatToolResult` function**: A comprehensive formatter that understands each tool type and provides meaningful summaries:
   - Read tool: Shows line count
   - Bash: Shows first line or line count
   - Edit/MultiEdit: Shows success/failure status
   - Grep/Glob: Shows match counts
   - Task: Shows first line of output
   - And many more tool-specific formats

2. **Modified `eventToDisplayObject`**: Enhanced to append tool results to tool call displays with:
   - Indented layout using "⎿" connector symbol
   - Conditional "[i] expand" hint when focused
   - Special handling for denial comments in red

3. **Added `ToolResultModal` component**: A minimalist modal that:
   - Shows full tool output with proper formatting
   - Displays tool name and relevant arguments in the header
   - Supports j/k scrolling and Escape to close
   - Blocks background keyboard shortcuts while open

4. **UI density improvements**: Reduced padding and margins throughout for better information density

## How to verify it

- [x] I have ensured `make check test` passes

**Manual testing steps:**
1. Open the HumanLayer WUI and view an active session with tool calls
2. Verify tool results appear inline beneath each tool call with appropriate summaries
3. Test keyboard navigation with j/k to move between events
4. Focus on a tool call and press 'i' to expand the full result
5. Verify error results appear in red (e.g., failed bash commands)
6. Check that the modal displays correctly with j/k scrolling support
7. Confirm Escape closes the modal and returns focus to the conversation

## Description for the changelog

<<<<<<< HEAD
Add inline tool result display in conversation view with expandable details via 'i' hotkey
=======
Add inline tool result display in conversation view with expandable details via 'i' hotkey
>>>>>>> 39dec21 (Sync thoughts - 2025-07-08T17:05:51.317Z)
