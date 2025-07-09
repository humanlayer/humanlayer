---
date: 2025-06-27T15:37:29-07:00
researcher: allison
git_commit: 37d13c4727feefd86244a028f5578d582a0a13b5
branch: main
repository: humanlayer
topic: "Fastest way to local approvals MVP (No HumanLayer API)"
tags: [research, codebase, local-approvals, mcp, daemon, architecture]
status: complete
last_updated: 2025-06-27
last_updated_by: allison
---

# Research: Fastest way to local approvals MVP (No HumanLayer API)

**Date**: 2025-06-27 15:37:29 PDT
**Researcher**: allison
**Git Commit**: 37d13c4727feefd86244a028f5578d582a0a13b5
**Branch**: main
**Repository**: humanlayer

## Research Question
Fastest way to get from where we are in the current codebase to local approvals MVP (No longer sending to humanlayer API)? We need an MCP server that connects to the daemon instead of the API. That's one thing. You can look at `hlyr` to see how we do the `mcp claude_approvals` command. Then we'll need a way to manage them in `hld`. Do they need to be in sqlite? How would we define them? We should be able to make it so that zero frontend changes are required (or near zero, potentially fine to change the mcp config and the permission prompt tool) but now have approvals work completely locally.

## Summary

The fastest path to local approvals MVP involves:
1. **Modify hlyr MCP server** to route approvals to daemon instead of API
2. **Extend hld daemon** to store approvals in existing SQLite database
3. **Add new RPC methods** for local approval creation/management
4. **Minimal frontend changes** - only MCP config update needed

The architecture is already well-suited for this change. The daemon has SQLite storage, approval correlation logic, and RPC interfaces. The MCP server just needs to call daemon instead of API.

## Detailed Findings

### Current Approval Flow

The current flow routes all approvals through the HumanLayer cloud API:
```
Claude Code → MCP (hlyr) → HumanLayer SDK → Cloud API
                                    ↑
Frontend (TUI/WUI) → hld daemon → Cloud API
```

Key files:
- `hlyr/src/mcp.ts:164-194` - MCP server creates approvals via HumanLayer SDK
- `humanlayer/core/approval.py:400-415` - SDK posts to `/function_calls` API endpoint
- `hld/approval/poller.go:130-147` - Daemon polls API for pending approvals

### Required Changes for Local Approvals

#### 1. Modify hlyr MCP Server (`hlyr/src/mcp.ts`)

Instead of using HumanLayer SDK to create approvals:
```typescript
// Current implementation (line 180)
const result = await hl.requireApproval({ ...args.input });

// New implementation
const result = await daemonClient.createLocalApproval({
  tool_name: args.tool_name,
  input: args.input,
  run_id: process.env.HUMANLAYER_RUN_ID
});
```

The daemon client already exists (`hlyr/src/daemonClient.ts`) with socket communication.

#### 2. Extend hld Daemon Storage

The daemon already has perfect infrastructure:
- **SQLite database** at `~/.humanlayer/daemon.db` 
- **conversation_events table** with approval fields (`hld/store/sqlite.go:132-135`):
  ```sql
  approval_status TEXT,    -- 'pending', 'approved', 'denied'
  approval_id TEXT,        -- Unique identifier
  ```
- **Correlation logic** to link approvals to tool calls (`hld/store/sqlite.go:900-948`)

Add a dedicated `approvals` table for richer data:
```sql
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input TEXT NOT NULL,      -- JSON
  status TEXT NOT NULL,     -- pending/approved/denied
  response TEXT,            -- JSON response
  created_at DATETIME NOT NULL,
  resolved_at DATETIME,
  FOREIGN KEY (run_id) REFERENCES sessions(session_id)
);
```

#### 3. Add RPC Methods to Daemon (`hld/rpc/`)

New methods needed:
```go
// approval_handlers.go
func (h *Handler) HandleCreateLocalApproval(ctx context.Context, req CreateLocalApprovalRequest) (*Approval, error)
func (h *Handler) HandleGetLocalApproval(ctx context.Context, req GetApprovalRequest) (*Approval, error)
```

The existing `HandleFetchApprovals` and `HandleSendDecision` can be extended to work with local approvals.

#### 4. Update Approval Manager (`hld/approval/manager.go`)

Modify to check both local and remote sources:
```go
// GetPendingApprovals - check local first, then remote
func (m *DefaultManager) GetPendingApprovals(sessionID string) ([]*hl.Approval, error) {
    // 1. Get local approvals from SQLite
    localApprovals := m.store.GetLocalApprovals(sessionID)
    
    // 2. Get remote approvals (optional fallback)
    if m.client != nil {
        remoteApprovals := m.client.GetPendingFunctionCalls()
        return merge(localApprovals, remoteApprovals)
    }
    
    return localApprovals, nil
}
```

### Minimal Frontend Changes

The beautiful part is that frontends won't need changes because:

1. **Same RPC Interface**: They already call `daemonClient.FetchApprovals()` 
2. **Same Data Format**: Local approvals can use the same structure
3. **Same Approval Flow**: The daemon handles routing to local/remote

Only change needed:
- **MCP config** (`hlyr/mcp-config.json`) - Point to local-aware MCP server

### Implementation Path

1. **Phase 1: Local Storage** (1-2 days)
   - Add approvals table to SQLite schema
   - Add RPC methods for local approval CRUD
   - Update store interface with local approval methods

2. **Phase 2: MCP Integration** (1 day)
   - Modify hlyr MCP server to call daemon
   - Add daemon client methods for approval creation
   - Test with Claude Code

3. **Phase 3: Manager Updates** (1 day)
   - Update approval manager to check local first
   - Modify poller to be optional/configurable
   - Ensure event bus publishes for local approvals

4. **Phase 4: Testing** (1 day)
   - End-to-end test with Claude Code
   - Verify TUI/WUI work unchanged
   - Test offline scenarios

## Architecture Insights

### Why This Approach Works

1. **Daemon Already Has Infrastructure**:
   - SQLite for persistence (`hld/store/sqlite.go`)
   - Approval correlation logic (`hld/approval/correlator.go`)
   - Event system for real-time updates (`hld/bus/`)
   - RPC interface for frontends (`hld/rpc/`)

2. **MCP Server Is Pluggable**:
   - Clean separation between protocol and backend (`hlyr/src/mcp.ts`)
   - Daemon client already exists (`hlyr/src/daemonClient.ts`)
   - Environment variables pass through for correlation

3. **Frontends Are Abstracted**:
   - Use daemon RPC, not direct API calls
   - Same data structures for local/remote
   - No hardcoded API dependencies in UI code

### Storage Considerations

**SQLite is the right choice** because:
- Already used for all daemon state
- Handles concurrent access well
- Simple schema migration support
- No additional dependencies
- Can query approvals by session, status, etc.

## Historical Context (from thoughts/)

The daemon was designed with local-first principles from the beginning:
- Data sovereignty and privacy were core requirements
- Architecture planned for offline operation
- Cloud sync designed as optional enhancement
- Session-approval correlation built into the design

The MCP integration was always intended to support local approvals - the current cloud-only implementation was just the first step.

## Related Research
- Future REST API migration planned in `thoughts/allison/daemon_api/docs/`
- Auto-approval hierarchy design for local rules
- Phase evolution from local-first to cloud-native

## Open Questions
1. Should local approvals sync to cloud when online?
2. How to handle approval policies/rules locally?
3. Should we support importing/exporting approval history?
4. What happens to existing cloud approvals during migration?