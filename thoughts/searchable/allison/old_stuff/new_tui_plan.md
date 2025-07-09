Below is a detailed implementation plan for Phase 5 of the TUI enhancement project, designed to transform the TUI into a conversation-centric interface that replaces Claude Code for daily use while providing a powerful approval workflow. The plan leverages the completed backend infrastructure from Phases 1-4 and focuses on enhancing the TUI with specific steps, file modifications, and success criteria.

---

# Phase 5 Implementation Plan: TUI Conversation Interface

## Objective

Transform the TUI into a conversation-centric interface that:

- Replaces Claude Code for daily use with full conversation context and multi-turn capabilities.
- Serves as a powerful approval interface with inline handling and context-aware workflows.

## Current State

- **Backend**: Fully functional with SQLite storage, RPC methods (`GetConversation`, `ContinueSession`), approval correlation (with a bug fix required), and real-time event notifications.
- **TUI**: Basic functionality with Approvals and Sessions tabs, lacking full conversation views and inline approval handling.

## Core Capabilities to Build

1. Fix the critical approval correlation bug to ensure accurate context.
2. Implement a conversation view component for full history display.
3. Enable inline approval handling within conversations.
4. Support resuming or forking completed sessions.
5. Provide context-aware approval workflows.
6. Add a notification system for new approvals.

## Implementation Steps

### Step 1: Fix the Approval Correlation Bug

**Description**: Address the bug where approvals are matched to the most recent tool call instead of the oldest pending one due to Claude Code's batching behavior.

- **File**: `hld/store/sqlite.go`
- **Modification**: Update the `GetPendingToolCall` method's SQL query to select the oldest uncorrelated tool call.
- **Testing**: Verify correct correlation with unit tests and batch simulation.

```sql
SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
       role, content,
       tool_id, tool_name, tool_input_json,
       tool_result_for_id, tool_result_content,
       is_completed, approval_status, approval_id
FROM conversation_events
WHERE tool_name = ?
  AND session_id = ?
  AND event_type = 'tool_call'
  AND is_completed = FALSE
  AND approval_status IS NULL
ORDER BY sequence ASC
LIMIT 1
```

### Step 2: Implement the Conversation View Component

**Description**: Create a new component to display full conversation history with proper formatting and inline approvals.

- **File**: `humanlayer-tui/conversation.go` (new)
- **Key Features**:
  - Fetch data via `GetConversation` RPC.
  - Render messages, tool calls, and results with styling (e.g., lipgloss for colors, syntax highlighting).
  - Support scrolling with bubble tea's viewport.
  - Display session metadata in a header.
  - Show inline approval prompts for pending approvals.
- **Edge Cases**: Handle long conversations, empty sessions, and multiple pending approvals.

### Step 3: Integrate Conversation View into TUI Navigation

**Description**: Enable navigation to the conversation view from both Sessions and Approvals tabs.

- **Files**:
  - `humanlayer-tui/tui.go`: Add `conversationView` state.
  - `humanlayer-tui/sessions.go`: Open conversation view on Enter.
  - `humanlayer-tui/approvals.go`: Open conversation view for session-associated approvals.
- **Navigation Flow**:
  - Sessions tab → Enter → Conversation view.
  - Approvals tab → Enter → Conversation view (if session-associated) or detail view.
  - Esc → Return to previous view.

### Step 4: Implement Inline Approval Handling

**Description**: Allow approval/denial directly within the conversation view.

- **Files**:
  - `humanlayer-tui/conversation.go`: Add approval prompt and handling.
  - `humanlayer-tui/api.go`: Call `ApproveFunctionCall`/`DenyFunctionCall` RPCs.
- **UI**: Display prompt at bottom with `[y] Approve [n] Deny [d] Details`.

### Step 5: Support Resuming or Forking Sessions

**Description**: Enable users to continue completed sessions.

- **Files**:
  - `humanlayer-tui/conversation.go`: Show input area for completed sessions, add parent navigation.
  - `humanlayer-tui/api.go`: Use `ContinueSession` RPC.
- **UI Flow**:
  - Input box appears at bottom for completed sessions with `[r] Resume` prompt.
  - Modal for parameter modification (rewrite existing modal patterns for cleaner implementation).
  - Add `[p] Jump to Parent` hotkey for sessions with `parent_session_id`.
- **Implementation**: Create new modal component rather than copying existing "slop" modal editor patterns.

### Step 6: Implement Notification System

**Description**: Add non-intrusive notifications for new approvals.

- **Files**:
  - `humanlayer-tui/tui.go`: Render top-right popup.
  - `humanlayer-tui/api.go`: Use event subscription for real-time updates.
- **Behavior**: Display "New approval required. Press 'a' to view" and fade out.

### Step 7: Enhance Session Detail Flow

**Description**: Improve session details with conversation integration.

- **File**: `humanlayer-tui/sessions.go`
- **Modifications**: Add conversation summary, approval indicators, and polling (3-second intervals).

### Step 8: Implement Caching for Performance

**Description**: Cache conversation data to reduce RPC calls.

- **File**: `humanlayer-tui/tui.go` (or new caching module)
- **Implementation**: LRU cache for up to 100 conversations.

### Step 9: Handle Edge Cases and Errors

**Description**: Ensure robust handling of edge scenarios.

- **Cases**: Empty sessions, unassociated approvals, failed sessions, daemon disconnections.
- **Implementation**: Add fallbacks, retries, and clear error messages.

### Step 10: Refine UI/UX for Keyboard-First Navigation

**Description**: Ensure all features are keyboard-accessible.

- **Shortcuts**:
  - `j/k`: Scroll
  - `Enter`: Expand
  - `Esc`: Back
  - `y/n`: Approve/deny
  - `r`: Resume/fork
  - `p`: Jump to parent session (when viewing forked sessions)
  - `a/s`: Jump to Approvals/Sessions

## Requirements

- **Code Quality**: Use clean, idiomatic Go with bubble tea framework.
- **Performance**: Cache conversations, poll only active sessions.
- **UX**: Non-disruptive notifications, consistent navigation.

## Success Criteria

- 2-3 second approval workflow: See → Context → Decide → Continue.
- Seamless resuming with parameter modification.
- Conversation history matches Claude Code's quality.
- Correct handling of batched tool calls.
- Smooth navigation between approvals and sessions.

## Key Constraints

- Maintain keyboard-first navigation (vim-style).
- Poll active sessions at 3-second intervals.
- Cache up to 100 conversations.
- Prioritize clean architecture over quick fixes.

This plan provides a practical, actionable roadmap for developers to build a robust TUI interface, leveraging existing backend capabilities and addressing all specified requirements.
