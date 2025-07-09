# Local Approvals Implementation Plan (v2 - Simplified)

## Overview

This plan implements local-only approvals for HumanLayer, removing all HumanLayer API dependencies and complexity. Approvals are created and managed entirely locally via the daemon's SQLite database.

**Architecture:**
```
MCP Server → Daemon RPC → Local SQLite → TUI/WUI
```

**Key Principles:**
1. No HumanLayer API integration - everything is local
2. Simple, clean data model matching our RPC interface
3. No format conversions or type mappings
4. No configuration flags - local approvals are always enabled

## Files to Remove/Simplify

### Remove Entirely:
- `hld/approval/poller.go` - No need to poll remote API
- `hld/approval/correlator.go` - No need for in-memory remote approval store
- All test files for the above

### Significantly Simplify:
- `hld/approval/manager.go` - Remove all HumanLayer API logic
- `hld/approval/types.go` - Remove HumanLayer type dependencies
- `hld/daemon/daemon.go` - Remove API key checks for approval manager

### Keep As-Is:
- TUI/WUI - Already use RPC interface only

## Current State (After Git Reset)

We've reset to the base commit, which means:
- No approvals table exists yet
- No local approval types defined
- Only approval correlation logic exists (tracking HumanLayer API approval IDs)
- Clean slate to implement our simplified approach

## Implementation Steps

### Step 1: Create Approvals Table

**Goal:** Add a simple approvals table that matches our actual needs.

**Files to Create/Modify:**
1. `hld/store/sqlite.go` - Add approvals table to schema
2. `hld/store/store.go` - Add Approval struct and interface methods

**Schema:**
```sql
CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,
    
    -- Tool approval fields
    tool_name TEXT NOT NULL,
    tool_input TEXT NOT NULL, -- JSON
    
    -- Response fields  
    comment TEXT, -- For denial reasons or approval notes
    
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    INDEX idx_approvals_pending (status) WHERE status = 'pending',
    INDEX idx_approvals_session (session_id),
    INDEX idx_approvals_run_id (run_id)
);
```

**Store Interface:**
```go
// Add to ConversationStore interface
CreateApproval(ctx context.Context, approval *Approval) error
GetApproval(ctx context.Context, id string) (*Approval, error)  
GetPendingApprovals(ctx context.Context, sessionID string) ([]*Approval, error)
UpdateApprovalResponse(ctx context.Context, id string, status ApprovalStatus, comment string) error
```

**Success Criteria:**
- [x] Table created with clean schema (added to initSchema)
- [x] CRUD operations implemented in SQLiteStore
- [x] Approval struct added to store.go with type-safe ApprovalStatus enum
- [x] Interface methods added to ConversationStore
- [x] GetUncorrelatedPendingToolCall added for correlation

---

### Step 2: Simplify Approval Types

**Goal:** Remove all HumanLayer API type dependencies.

**New Types:**
```go
// types.go - Simple, clean types
type Approval struct {
    ID          string    `json:"id"`
    RunID       string    `json:"run_id"`
    SessionID   string    `json:"session_id"`
    Status      string    `json:"status"`
    CreatedAt   time.Time `json:"created_at"`
    RespondedAt *time.Time `json:"responded_at,omitempty"`
    ToolName    string    `json:"tool_name"`
    ToolInput   json.RawMessage `json:"tool_input"`
    Comment     string    `json:"comment,omitempty"`
}

// Manager interface - just what we need
type Manager interface {
    CreateApproval(ctx context.Context, runID, toolName string, toolInput json.RawMessage) (string, error)
    GetPendingApprovals(ctx context.Context, sessionID string) ([]*Approval, error)
    ApproveToolCall(ctx context.Context, id string, comment string) error
    DenyToolCall(ctx context.Context, id string, reason string) error
}
```

**Success Criteria:**
- [x] Remove `humanlayer-go` imports (no more imports in approval package)
- [x] Define simple, clean types (approval/types.go)
- [x] No more type conversions

---

### Step 3: Implement Simple Approval Manager

**Goal:** Create a clean manager that only handles local approvals.

**Implementation:**
```go
type LocalManager struct {
    store    store.ConversationStore
    eventBus bus.EventBus
}

func NewManager(store store.ConversationStore, eventBus bus.EventBus) Manager {
    return &LocalManager{
        store:    store,
        eventBus: eventBus,
    }
}

func (m *LocalManager) CreateApproval(ctx context.Context, runID, toolName string, toolInput json.RawMessage) (string, error) {
    // Look up session by run_id
    session, err := m.store.GetSessionByRunID(ctx, runID)
    if err != nil {
        return "", fmt.Errorf("session not found: %w", err)
    }
    
    // Create approval
    approval := &store.Approval{
        ID:        "local-" + uuid.New().String(),
        RunID:     runID,
        SessionID: session.ID,
        Status:    "pending",
        CreatedAt: time.Now(),
        ToolName:  toolName,
        ToolInput: string(toolInput),
    }
    
    // Store it
    if err := m.store.CreateApproval(ctx, approval); err != nil {
        return "", err
    }
    
    // Correlate with tool call
    m.correlateApproval(ctx, approval)
    
    // Publish event
    m.publishNewApprovalEvent(approval)
    
    // Update session status
    m.updateSessionStatus(ctx, session.ID, "waiting_input")
    
    return approval.ID, nil
}
```

**Success Criteria:**
- [x] No HumanLayer API dependencies
- [x] Simple CRUD operations
- [x] Event publishing works (using bus.Event struct)
- [x] Correlation logic preserved (correlateApproval method)
- [x] Tests written for all manager methods

---

### Step 4: Update RPC Interface

**Goal:** Simplify RPC types to match our clean model.

**RPC Types:**
```go
type CreateApprovalRequest struct {
    RunID     string          `json:"run_id"`
    ToolName  string          `json:"tool_name"`
    ToolInput json.RawMessage `json:"tool_input"`
}

type CreateApprovalResponse struct {
    ApprovalID string `json:"approval_id"`
}

// FetchApprovalsResponse now returns our simple Approval type
type FetchApprovalsResponse struct {
    Approvals []*store.Approval `json:"approvals"`
}
```

**Success Criteria:**
- [x] RPC handlers remain thin (ApprovalHandlers implemented)
- [x] Clean request/response types
- [x] Added CreateApproval RPC method
- [x] Updated SendDecision to use approval_id instead of call_id

---

### Step 5: Update MCP Integration

**Goal:** Update MCP server to create local approvals.

**Changes:**
1. Remove `local_approvals` config check
2. Always use daemon RPC for approvals
3. Simplify request format

```typescript
// In request_permission tool handler
const { approvalId } = await daemonClient.createApproval({
    runId: process.env.HUMANLAYER_RUN_ID,
    toolName: args.tool_name,
    toolInput: args.input
});

// Poll for status
while (true) {
    const approvals = await daemonClient.fetchApprovals();
    const approval = approvals.find(a => a.id === approvalId);
    
    if (approval && approval.status !== 'pending') {
        return formatResponse(approval);
    }
    
    await sleep(3000);
}
```

**Success Criteria:**
- [x] MCP creates local approvals (implemented in mcp.ts)
- [x] Polling works correctly
- [x] Response format maintained
- [x] No auth validation for claude_approvals command
- [x] Added createApproval method to daemonClient

---

### Step 6: Clean Up and Test

**Goal:** Remove all HumanLayer API code and ensure everything works.

**Tasks:**
1. Delete `poller.go` and `correlator.go`
2. Remove HumanLayer client creation from daemon
3. Update all tests to remove API dependencies
4. End-to-end testing

**Success Criteria:**
- [x] No `humanlayer-go` imports in approval package
- [x] Removed poller.go and correlator.go
- [x] Removed old test files (correlator_test.go, poller_test.go, manager_status_test.go)
- [x] Daemon always creates local approval manager
- [x] Regenerated mocks with `make mocks`
- [x] All tests pass
- [x] E2E flow works: MCP → Approval → TUI → Response

---

## Benefits of This Approach

1. **Simpler codebase** - Remove ~1000+ lines of API integration code
2. **No external dependencies** - Everything runs locally
3. **Faster** - No network calls for approvals
4. **Cleaner types** - Match our actual data flow
5. **Easier to maintain** - No dual-mode complexity

## Migration Notes

Since we're starting fresh on the branch:
1. Keep Steps 1-2 from original implementation (config and basic table)
2. Implement this cleaner approach for the rest
3. No need for backward compatibility with HumanLayer API

## Future Enhancements

Once this is working, we could add:
1. Approval policies (auto-approve certain tools)
2. Approval history/audit log
3. Export/import functionality
4. Better correlation strategies