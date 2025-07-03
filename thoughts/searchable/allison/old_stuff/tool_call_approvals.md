# Tool Call Approval Matching Issue with Claude Code Batching

## Problem Discovery and Context

### Previous Behavior

Claude Code used to only call one tool at a time, showing only one tool as pending. This made approval matching straightforward since there would only be one pending tool call to correlate against at any given time. Our current implementation was built on this assumption.

### New Batching Behavior (As of Yesterday)

Claude Code can now "queue" multiple tool calls. It can generate like 10 tool call requests where maybe 5 of them require approval. However, the execution model remains sequential and only one approval happens at a time per session.

## Detailed Flow Example

### Initial Tool Call Batch

```
tool call 1 - read only
tool call 2 - bash (approval required)
tool call 3 - bash (approval required)
tool call 4 - read only
tool call 5 - read only
tool call 6 - bash (approval required)
tool call 7 - write file (approval required)
tool call 8 - read only
tool call 9 - bash (approval required)
tool call 10 - read only
```

### Expected Execution Flow

1. **Streaming Events**: Claude Code SDK sends all 10 tool call request events to our streaming JSON handler (`hld/session/manager.go:154-186`)

2. **Sequential Execution Begins**:

   - Tool call 1 (read only) executes immediately and returns result
   - Tool call 2 (bash, needs approval) starts executing, Claude pauses and waits

3. **First Approval Request**:

   - Approval request comes in via HumanLayer API for tool call 2
   - Our polling system (`hld/approval/poller.go`) detects the new approval
   - Should correlate with tool call 2, but current logic might match tool call 6 instead

4. **If Approved**:

   - Tool call 2 completes and returns result
   - Tool call 3 (bash, needs approval) starts executing, Claude pauses again
   - New approval request comes in for tool call 3
   - Tool calls 4 and 5 execute immediately after tool call 3 is approved

5. **If Tool Call 6 Gets Denied**:
   - Tool call 6 gets denied by human reviewer
   - Claude immediately puts tool calls 6, 7, 8, 9, and 10 into denied state
   - All 5 of those tool calls return responses with denial messages like "Tool call denied, following user message is feedback for what to do next"
   - We see streaming responses for all 5 denials come in
   - Claude then inserts the denial reason as the next user message for the LLM to see

## Current Implementation Problems

### Approval Matching Logic

**File**: `hld/store/sqlite.go:657-691` (`GetPendingToolCall` method)

```sql
SELECT ... FROM conversation_events
WHERE tool_name = ?
  AND session_id = ?
  AND event_type = 'tool_call'
  AND is_completed = FALSE
ORDER BY created_at DESC LIMIT 1  -- PROBLEM: Gets most recent, not oldest
```

### The Mismatch Issue

In our example above:

- Tool call 2 executes and triggers approval request
- Current logic: `ORDER BY created_at DESC` returns tool call 6 (most recent bash call)
- **Wrong correlation**: Tool call 6 gets marked as having pending approval
- **Missing correlation**: Tool call 2 remains uncorrelated despite being the actual trigger
- When approval decision comes back, it updates tool call 6 instead of tool call 2

### Why This Happens

**HumanLayer API Limitations**:

- MCP server (`hlyr/src/mcp.ts:144-169`) only knows tool name and parameters
- No access to Claude's internal tool call IDs (`Content.ID` from `claudecode-go/types.go:101`)
- Approval requests only contain: `{ fn: "bash", kwargs: {...} }`

**Our Correlation Process**:

1. Polling finds `FunctionCall` with `RunID` (`hld/approval/poller.go:241-248`)
2. Looks up session by `RunID`
3. Calls `GetPendingToolCall(sessionID, "bash")`
4. Gets wrong tool call due to DESC ordering
5. Correlates approval with wrong tool call in database

## Technical Details

### Data Structures Involved

**Claude Tool Call** (`claudecode-go/types.go:97-106`):

```go
type Content struct {
    Type  string                 `json:"type"`
    ID    string                 `json:"id"`        // Unique Claude tool call ID
    Name  string                 `json:"name"`      // Tool name (e.g., "bash")
    Input map[string]interface{} `json:"input"`     // Tool parameters
}
```

**HumanLayer Approval** (`humanlayer-go/models.go:45-60`):

```go
type FunctionCall struct {
    RunID  string            `json:"run_id"`
    CallID string            `json:"call_id"`
    Spec   FunctionCallSpec  `json:"spec"`
}

type FunctionCallSpec struct {
    Fn     string                 `json:"fn"`       // Tool name only
    Kwargs map[string]interface{} `json:"kwargs"`   // Tool parameters
}
```

**Database Storage** (`hld/store/sqlite.go:96-133`):

```sql
CREATE TABLE conversation_events (
    tool_id TEXT,              -- Claude's tool call ID
    tool_name TEXT,            -- Tool name for matching
    tool_input_json TEXT,      -- Tool parameters
    is_completed BOOLEAN,      -- FALSE until tool result received
    approval_status TEXT,      -- NULL, 'pending', 'approved', 'denied'
    approval_id TEXT,          -- HumanLayer approval ID when correlated
    sequence INTEGER           -- Order within conversation
);
```

### Current Event Processing

**Session Manager** (`hld/session/manager.go:435-477`):

1. Receives tool_use events from Claude streaming
2. Stores each as `conversation_events` row with `is_completed = FALSE`
3. When tool_result arrives, marks corresponding tool call as `is_completed = TRUE`

**Approval Correlation** (`hld/approval/poller.go:239-296`):

1. Polls HumanLayer API every 5 seconds
2. For each new approval, finds session by `run_id`
3. Calls `GetPendingToolCall(sessionID, toolName)`
4. Updates matched tool call with `approval_id` and `approval_status = 'pending'`

## The Core Problem

**Assumption Violation**: Our code assumes "most recent pending tool call = current execution" but with batching, we need "oldest pending tool call = current execution" because Claude executes sequentially.

**Critical Gap**: No way to correlate HumanLayer approvals with specific Claude tool call IDs because MCP protocol doesn't have access to them.

## Proposed Solutions

### Option 1: Sequential Matching (Recommended)

Change ordering to match Claude's sequential execution:

```sql
ORDER BY sequence ASC LIMIT 1  -- Get oldest pending tool call
```

### Option 2: Add Safety Filter

Prevent re-matching tool calls that already have approvals:

```sql
AND approval_status IS NULL    -- Only match uncorrelated tool calls
```

### Combined Approach

```sql
WHERE tool_name = ?
  AND session_id = ?
  AND event_type = 'tool_call'
  AND is_completed = FALSE
  AND approval_status IS NULL
ORDER BY sequence ASC
LIMIT 1
```

## Edge Case: Stuck Tool Calls

**Scenario**: Tool call never receives result due to Claude crash or network issue
**Current Risk**:

- Tool call remains `is_completed = FALSE` forever
- Without `approval_status IS NULL`, it would always be matched by future approvals
- Would block all subsequent approvals for that tool type in that session

**Mitigation**: Including `approval_status IS NULL` prevents re-matching already-correlated tool calls.

## Impact on UI and Session Management

### Session Status Confusion

**Current Issue** (`TODO.md` lines 69-76): Session status remains "running" even when blocked on approval
**Batching Impact**: With multiple queued tool calls, this becomes more confusing
**Files**: `hld/approval/manager.go:287-295`, `hld/session/manager.go`

### Conversation View Requirements

**From** `tui_new.md` (lines 54-68): Need to show tool call execution state
**New Requirements**:

- Display multiple pending tool calls with their states
- Show which one is currently awaiting approval
- Indicate execution order (sequence-based)
- Handle visual complexity of multiple approval states

## Files Requiring Changes

### Immediate Fix

- `hld/store/sqlite.go:670` - Change ORDER BY from DESC to ASC, add approval_status filter

### Verification Needed

- `hld/approval/manager.go:287-295` - Ensure session status updates to "waiting_input"
- `hld/session/manager.go` - Session status handling during approvals

### Future UI Enhancement

- `humanlayer-tui/sessions.go` - Session status indicators
- `humanlayer-tui/conversation.go` (new) - Tool call state visualization

## Confirmation Needed

1. **Sequential Execution**: ✅ Confirmed - Claude executes tool calls sequentially
2. **Single Approval**: ✅ Confirmed - Only one approval at a time per session
3. **Denial Cascade**: ✅ Confirmed - Denied approval affects all remaining queued calls
4. **Approval Order**: ✅ Confirmed - Approvals arrive in execution order

This analysis confirms that changing to `ORDER BY sequence ASC` with approval status filtering should resolve the correlation issue.
