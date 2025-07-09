# Local Approvals Implementation Plan

## Overview

This plan details the implementation of local approvals for HumanLayer, allowing approvals to be created locally instead of through the HumanLayer API. The approach adds a `local_approvals` configuration flag that controls where NEW approvals are created, while the daemon continues to aggregate approvals from all sources.

**Key Architecture Change:**
- Current: `MCP Server → HumanLayer SDK → HumanLayer Cloud API`
- New (when local_approvals=true): `MCP Server → Daemon Client → hld daemon → Local SQLite`

**Important Principles**:
1. The daemon ALWAYS shows all approvals (both local and remote) regardless of configuration
2. The `local_approvals` flag only controls where NEW approvals are created
3. The Approval Manager is the single source of truth for ALL approval operations
4. RPC handlers are thin layers that only handle request/response marshaling

## ⚠️ REVISED APPROACH (After Step 2)

After implementing Steps 1-2, we realized the original plan had a fundamental flaw: we were trying to force local approvals to mirror the HumanLayer API's structure (with `kwargs`, `function_name`, etc.) when we should instead store them in a format that matches our actual RPC interface.

**What went wrong:**
- Used Python-esque `kwargs` instead of idiomatic Go
- Tried to convert everything to HumanLayer API types
- Made the approval manager overly complex with unnecessary conversions
- Stored data in a format that didn't match how it flows through our system

**Correct approach:**
- Store local approvals with `tool_name` and `tool_input` (matching our RPC)
- Keep local and remote approvals in their native formats
- Only convert at the boundaries when absolutely necessary
- Simplify the manager to just aggregate without forcing conversions

## Architecture Summary

**MCP Server (hlyr)**:
- Reads `local_approvals` configuration flag
- If `true`: Creates approvals locally via daemon RPC
- If `false`: Creates approvals via HumanLayer cloud API
- Simple if/else logic, no mixed mode complexity

**Daemon (hld)**:
- **Approval Manager** is the single source of truth for all approvals:
  - Aggregates local approvals (from SQLite) and remote approvals (from API)
  - Handles creation of local approvals with correlation
  - Routes approve/deny based on ID prefix (`local-` vs cloud IDs)
  - Publishes consistent events for both types
- **RPC Handlers** are thin marshaling layers that delegate to manager
- **Poller** continues to run if API key configured (fetches remote approvals)

**User Experience**:
- TUI/WUI always show ALL approvals from both sources
- Seamless migration: can switch modes without losing in-flight approvals
- No visibility loss when changing configuration

## Implementation Steps

### Step 1: Add Configuration Flag

**Goal:** Add `local_approvals` flag to both hlyr and hld configuration systems.

**Files to Modify:**
1. `hlyr/src/config.ts` - Add local_approvals to config schema
2. `hld/config/config.go` - Add LocalApprovals field
3. `humanlayer.json` - Document new configuration option

**Implementation Details:**

1. **hlyr config** (`hlyr/src/config.ts`):
```typescript
// Add to ConfigFile type
local_approvals?: boolean;

// Add to CONFIG_SCHEMA
local_approvals: {
  envVar: 'HUMANLAYER_LOCAL_APPROVALS',
  configKey: 'local_approvals',
  cliFlag: 'localApprovals',
  defaultValue: true,
  required: false
}
```

2. **hld config** (`hld/config/config.go`):
```go
type Config struct {
    // ... existing fields
    LocalApprovals bool `mapstructure:"local_approvals"`
}

// In Load() function
viper.BindEnv("local_approvals", "HUMANLAYER_LOCAL_APPROVALS")
viper.SetDefault("local_approvals", true)
```

**Success Criteria:**
- [x] Config flag can be set via environment variable
- [x] Config flag can be set via humanlayer.json
- [x] Both hlyr and hld read the same config value
- [x] Defaults to true to encourage local-first usage

---

### Step 2: Create Approvals Table ✅

**Goal:** Add a dedicated approvals table for storing local approvals.

**Files to Modify:**
1. `hld/store/sqlite.go` - Add approvals table schema and migration
2. `hld/store/store.go` - Extend interface with approval methods
3. `hld/store/mock_store.go` - Add mock implementations

**⚠️ ORIGINAL IMPLEMENTATION (Has Issues):**

1. **Original Table Schema** (implemented but flawed):
```sql
CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('function_call', 'human_contact')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'resolved')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,
    
    -- Function call fields (PROBLEMATIC - mirrors HumanLayer API)
    function_name TEXT,  -- Should be tool_name
    kwargs TEXT, -- JSON -- Should be tool_input
    approved BOOLEAN,
    comment TEXT,
    
    -- Human contact fields  
    message TEXT,
    response TEXT,
    
    -- Metadata
    user_info TEXT, -- JSON
    correlation_id TEXT,
    
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    INDEX idx_approvals_pending (status) WHERE status = 'pending',
    INDEX idx_approvals_session (session_id),
    INDEX idx_approvals_run_id (run_id)
);
```

**✅ CORRECTED APPROACH (What we should do):**

1. **Revised Table Schema** (matches our RPC interface):
```sql
CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('function_call', 'human_contact')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'resolved')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,
    
    -- Tool approval fields (matches RPC interface)
    tool_name TEXT,      -- The actual tool being called
    tool_id TEXT,        -- Tool call ID for correlation
    tool_input TEXT,     -- JSON object of tool parameters
    
    -- Response fields
    approved BOOLEAN,
    comment TEXT,
    
    -- Human contact fields  
    message TEXT,
    response TEXT,
    
    -- Metadata
    user_info TEXT, -- JSON
    
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    INDEX idx_approvals_pending (status) WHERE status = 'pending',
    INDEX idx_approvals_session (session_id),
    INDEX idx_approvals_run_id (run_id)
);
```

2. **Store Interface** (`hld/store/store.go`) - This part was correct:
```go
// Add to ConversationStore interface
CreateLocalApproval(approval *Approval) error
GetApproval(id string) (*Approval, error)
GetPendingApprovals(sessionID string) ([]*Approval, error)
UpdateApprovalStatus(id string, status string, response interface{}) error
```

**Success Criteria:**
- [x] Approvals table created on daemon startup
- [x] Unit tests pass for CRUD operations
- [x] Indexes optimize common queries
- [x] Foreign key maintains referential integrity
- [ ] ⚠️ Table schema needs to be migrated to use tool_name/tool_input

---

### Step 3: Add RPC Method for Creating Local Approvals ✅

**Goal:** Add RPC method that delegates to the approval manager for creating local approvals.

**Files to Modify:**
1. `hld/rpc/types.go` - Add request/response types
2. `hld/rpc/approval_handlers.go` - Add thin handler that calls manager
3. `hld/daemon/daemon.go` - Update initialization to pass store and eventBus

**⚠️ ORIGINAL IMPLEMENTATION (Has Issues):**

1. **Original RPC Types** (mirrors HumanLayer API):
```go
type CreateLocalApprovalRequest struct {
    RunID        string          `json:"run_id"`
    Type         string          `json:"type"` // function_call or human_contact
    FunctionName string          `json:"function_name,omitempty"`  // Should be tool_name
    Kwargs       json.RawMessage `json:"kwargs,omitempty"`         // Should be tool_input
    Message      string          `json:"message,omitempty"`
}
```

**✅ CORRECTED APPROACH:**

1. **Revised RPC Types** (matches our cleaner interface):
```go
type CreateLocalApprovalRequest struct {
    RunID      string          `json:"run_id"`
    Type       string          `json:"type"` // function_call or human_contact
    ToolName   string          `json:"tool_name,omitempty"`   // Idiomatic Go
    ToolID     string          `json:"tool_id,omitempty"`     // For correlation
    ToolInput  json.RawMessage `json:"tool_input,omitempty"`  // Tool parameters as JSON
    Message    string          `json:"message,omitempty"`     // For human contact
}

type CreateLocalApprovalResponse struct {
    ApprovalID string `json:"approval_id"`
}
```

2. **RPC Handler** (thin layer):
```go
func (h *ApprovalHandlers) HandleCreateLocalApproval(ctx context.Context, params json.RawMessage) (interface{}, error) {
    var req CreateLocalApprovalRequest
    if err := json.Unmarshal(params, &req); err != nil {
        return nil, fmt.Errorf("invalid request: %w", err)
    }
    
    // Delegate to manager
    approvalID, err := h.approvals.CreateLocalApproval(ctx, req)
    if err != nil {
        return nil, err
    }
    
    return &CreateLocalApprovalResponse{ApprovalID: approvalID}, nil
}
```

**Success Criteria:**
- [x] RPC types defined
- [x] Handler delegates to manager
- [x] Daemon initialization updated
- [x] RPC handler registered
- [ ] ⚠️ RPC types need to be updated to use tool_name/tool_input

---

### Step 4: Update Approval Manager

**Goal:** Refactor approval manager to be the single source of truth for both local and cloud approvals.

**Files to Modify:**
1. `hld/approval/manager.go` - Add local approval management
2. `hld/store/sqlite.go` - Fix GetPendingApprovals to handle empty sessionID
3. `hld/rpc/approval_handlers.go` - Simplify to just call manager methods

**Implementation Details:**

1. **Fix SQLiteStore GetPendingApprovals**:
```go
func (s *SQLiteStore) GetPendingApprovals(ctx context.Context, sessionID string) ([]*Approval, error) {
    var query string
    var args []interface{}
    
    if sessionID == "" {
        // Get all pending approvals
        query = `SELECT ... FROM approvals WHERE status = 'pending'`
    } else {
        // Get pending approvals for specific session
        query = `SELECT ... FROM approvals WHERE session_id = ? AND status = 'pending'`
        args = append(args, sessionID)
    }
    // ... rest of implementation
}
```

2. **Update Manager to aggregate both sources**:
```go
func (m *DefaultManager) GetPendingApprovals(sessionID string) ([]PendingApproval, error) {
    var approvals []PendingApproval
    
    // Get local approvals from ConversationStore
    if m.ConversationStore != nil {
        ctx := context.Background()
        localApprovals, err := m.ConversationStore.GetPendingApprovals(ctx, sessionID)
        if err != nil {
            slog.Warn("failed to get local approvals", "error", err)
        } else {
            for _, la := range localApprovals {
                if pa := convertLocalApprovalToPending(la); pa != nil {
                    approvals = append(approvals, *pa)
                }
            }
        }
    }
    
    // Get remote approvals from in-memory store
    if sessionID != "" && m.ConversationStore != nil {
        // Look up the session to get its run_id
        ctx := context.Background()
        session, err := m.ConversationStore.GetSession(ctx, sessionID)
        if err != nil {
            slog.Debug("session not found for approval filter", "session_id", sessionID, "error", err)
        } else {
            remoteApprovals, _ := m.Store.GetPendingByRunID(session.RunID)
            approvals = append(approvals, remoteApprovals...)
        }
    } else {
        // Get all remote approvals
        remoteApprovals, _ := m.Store.GetAllPending()
        approvals = append(approvals, remoteApprovals...)
    }
    
    return approvals, nil
}
```

3. **Add CreateLocalApproval to Manager**:
```go
func (m *DefaultManager) CreateLocalApproval(ctx context.Context, req CreateLocalApprovalRequest) (string, error) {
    // Find session by run_id
    session, err := m.ConversationStore.GetSessionByRunID(ctx, req.RunID)
    if err != nil {
        return "", fmt.Errorf("failed to find session: %w", err)
    }
    
    // Generate local approval ID
    approvalID := "local-" + uuid.New().String()
    
    // Create the approval
    approval := &store.Approval{
        ID:           approvalID,
        RunID:        req.RunID,
        SessionID:    session.ID,
        Type:         req.Type,
        Status:       store.ApprovalStatusPending,
        CreatedAt:    time.Now(),
        FunctionName: req.FunctionName,
        Kwargs:       string(req.Kwargs),
        Message:      req.Message,
    }
    
    // Store the approval
    if err := m.ConversationStore.CreateLocalApproval(ctx, approval); err != nil {
        return "", fmt.Errorf("failed to create approval: %w", err)
    }
    
    // Correlate with pending tool call (like poller does for remote)
    if req.Type == "function_call" {
        m.correlateLocalApproval(ctx, approval)
    }
    
    // Publish new approval event
    if m.EventBus != nil {
        m.EventBus.Publish(bus.Event{
            Type: bus.EventNewApproval,
            Data: map[string]interface{}{
                "approval_id": approvalID,
                "run_id":      req.RunID,
                "session_id":  session.ID,
                "type":        req.Type,
                "source":      "local",
            },
        })
    }
    
    // Update session status to waiting_input
    waitingStatus := store.SessionStatusWaitingInput
    update := store.SessionUpdate{Status: &waitingStatus}
    if err := m.ConversationStore.UpdateSession(ctx, session.ID, update); err != nil {
        slog.Error("failed to update session status", "error", err)
    }
    
    return approvalID, nil
}
```

4. **Update Approve/Deny methods to handle local approvals**:
```go
func (m *DefaultManager) ApproveFunctionCall(ctx context.Context, callID string, comment string) error {
    // Check if this is a local approval
    if strings.HasPrefix(callID, "local-") {
        return m.approveLocalFunctionCall(ctx, callID, comment)
    }
    // ... existing remote approval logic
}
```

5. **Simplify RPC handlers to just call manager**:
```go
func (h *ApprovalHandlers) HandleFetchApprovals(ctx context.Context, params json.RawMessage) (interface{}, error) {
    // Parse request...
    
    // Manager handles aggregation now
    approvals, err := h.approvals.GetPendingApprovals(req.SessionID)
    if err != nil {
        return nil, err
    }
    
    return &FetchApprovalsResponse{Approvals: approvals}, nil
}
```

**Success Criteria:**
- [ ] Local approvals appear in GetPendingApprovals
- [ ] Approve/Deny works for local approvals
- [ ] Daemon always polls API if configured (not conditional on flag)
- [ ] Events published for UI updates
- [ ] Daemon aggregates both local and remote approvals for UI
- [ ] Approval manager is single source of truth for all approvals
- [ ] RPC handlers are thin marshaling layers
- [ ] Local approvals are correlated with tool calls

---

### Step 5: Add Daemon Client to MCP Server

**Goal:** Enable MCP server to connect to daemon for local approvals.

**Files to Modify:**
1. `hlyr/src/mcp.ts` - Modify to use daemon client when local_approvals = true
2. `hlyr/src/daemonClient.ts` - Add createLocalApproval method

**Implementation Details:**

1. **Daemon Client Method** (`hlyr/src/daemonClient.ts`):
```typescript
async createLocalApproval(params: {
  runId: string;
  type: 'function_call' | 'human_contact';
  functionName?: string;
  kwargs?: any;
  message?: string;
}): Promise<{ approvalId: string }> {
  return this.request('createLocalApproval', params);
}
```

2. **Modified MCP Server** (`hlyr/src/mcp.ts`):
```typescript
async function startClaudeApprovalsMCPServer() {
  const config = await loadConfig();
  
  if (config.local_approvals) {
    // Create approval locally via daemon
    const daemonClient = new DaemonClient(config.daemon_socket);
    
    // In request_permission tool handler:
    const { approvalId } = await daemonClient.createLocalApproval({
      runId: process.env.HUMANLAYER_RUN_ID,
      type: 'function_call',
      functionName: args.tool_name,
      kwargs: args.input
    });
    
    // Poll daemon for approval status (daemon aggregates all sources)
    while (true) {
      const approvals = await daemonClient.fetchApprovals();
      const approval = approvals.find(a => a.id === approvalId);
      
      if (approval && approval.status !== 'pending') {
        return formatClaudeResponse(approval);
      }
      
      await sleep(3000); // Match SDK polling interval
    }
  } else {
    // Create approval via cloud API
    const hl = new HumanLayer({ apiKey: config.api_key });
    return await hl.fetchHumanApproval(...);
    // Note: Daemon will still show this approval via its API polling
  }
}
```

**Success Criteria:**
- [ ] MCP server connects to daemon when local_approvals = true
- [ ] Creates local approvals via RPC
- [ ] Polls daemon for status updates
- [ ] Returns correct format to Claude Code
- [ ] Falls back to cloud API when local_approvals = false

---

### Step 6: Simplify RPC Handlers

**Goal:** Since approval manager now handles all business logic, simplify RPC handlers to be thin marshaling layers.

**Files to Modify:**
1. `hld/rpc/approval_handlers.go` - Remove business logic, just call manager

**Implementation Details:**

1. **Simplify HandleFetchApprovals**:
- Remove aggregation logic (manager does this now)
- Just parse request and call manager

2. **Simplify HandleSendDecision**:
- Remove local vs remote routing (manager does this now)
- Just parse request and call manager

3. **Update HandleCreateLocalApproval**:
- Already thin in our plan, just ensure it delegates to manager

**Note**: Correlation logic is now handled in Step 4 by the approval manager when creating local approvals.

**Success Criteria:**
- [ ] RPC handlers contain no business logic
- [ ] All approval logic centralized in manager
- [ ] Tests still pass with refactored handlers

---

### Step 7: End-to-End Testing

**Goal:** Verify the complete local approvals flow works correctly.

**Testing Scenarios:**
1. Create local approval via MCP → Approve via TUI → Claude receives response
2. Mixed mode: Some approvals local, some remote
3. Switch between local_approvals=true/false without losing approvals
4. Verify correlation works for continued sessions

**Success Criteria:**
- [ ] Local approvals flow works end-to-end
- [ ] Mixed mode works correctly
- [ ] Configuration changes don't lose approvals
- [ ] All events published correctly

---

## Architecture Decisions

### Key Decision from Discussion
Based on team discussion, we're using a clear separation of concerns:
- **MCP Server**: `local_approvals` flag controls WHERE new approvals are created (local vs cloud)
- **Daemon**: ALWAYS aggregates approvals from all sources (local + cloud) for UI display
- **Benefits**:
  - Simple if/else logic in MCP
  - Users see all approvals in TUI/WUI regardless of source
  - Smooth migration from cloud to local without losing in-flight approvals
  - Minimal code changes required

### 1. Single MCP Command with Config Flag
Instead of creating a new `mcp claude_approvals_local` command, we use the existing `mcp claude_approvals` with a `local_approvals` config flag:
- Simpler for users - no MCP config changes needed
- Easier migration path
- Consistent interface

### 2. Separate Approvals Table
Create a dedicated approvals table instead of using conversation_events:
- Clean separation of concerns
- Preserves existing conversation visualization
- Allows richer approval-specific fields
- Better query performance

### 3. Local Approval ID Format
Local approvals use `local-` prefix (e.g., `local-550e8400-e29b-41d4-a716-446655440000`):
- Easy to distinguish from cloud approvals
- Preserves k8s identifier compatibility (using dash instead of underscore)
- Simple ID-based routing logic

### 4. Daemon-First Architecture
MCP server connects to daemon for local approvals:
- Centralizes approval management
- Reuses existing RPC infrastructure
- Enables real-time updates via event bus

## Testing Strategy

### Unit Tests
1. **Config Loading**: Test local_approvals flag in both hlyr and hld
2. **Database Operations**: Test approvals table CRUD
3. **RPC Handlers**: Test createLocalApproval with mocks
4. **Approval Manager**: Test local/remote routing logic
5. **MCP Server**: Test daemon polling logic

### Integration Tests
1. **End-to-End Flow**: Create approval → Poll status → Resolve → Get response
2. **Event Bus**: Verify events published for UI updates
3. **Session Correlation**: Test approval-to-tool-call matching
4. **Config Modes**: Test both local and cloud modes

### Manual Testing with Claude Code
1. Set `HUMANLAYER_LOCAL_APPROVALS=true`
2. Start hld daemon
3. Start hlyr MCP server
4. Use Claude Code to trigger approval
5. Approve via TUI
6. Verify Claude Code receives response
7. Verify MCP creates approvals locally when flag is true
8. Verify daemon still polls and displays cloud approvals

## Example Configuration

In `humanlayer.json`:
```json
{
  "api_key": "hl_api_...",
  "local_approvals": true,
  "daemon_socket": "~/.humanlayer/daemon.sock"
}
```

Or via environment:
```bash
export HUMANLAYER_LOCAL_APPROVALS=true
export HUMANLAYER_RUN_ID=session-123
npm run dev mcp claude_approvals
```

## Migration Guide

For users switching to local approvals:
1. Update to latest hld and hlyr versions
2. Add `"local_approvals": true` to config
3. Restart daemon and MCP server
4. No changes needed to Claude Code configuration

## Future Enhancements (Not in MVP)

1. **Approval Policies**: Local rules for auto-approval
2. **Export/Import**: Backup and restore local approvals  
3. **Hybrid Mode**: Local approvals with optional cloud sync
4. **Approval Templates**: Predefined approval configurations