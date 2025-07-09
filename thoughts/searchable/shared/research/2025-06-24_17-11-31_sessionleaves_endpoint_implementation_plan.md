---
date: 2025-06-24 17:11:14 PDT
researcher: allison
git_commit: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
branch: main
repository: humanlayer
topic: "SessionLeaves JSON-RPC Endpoint Implementation Plan"
tags: [research, codebase, sessions, api]
status: in_progress
last_updated: 2025-07-02
last_updated_by: allison
last_updated_note: "Phase 2 (Client Library Updates) completed - all daemon clients now support getSessionLeaves"
---

# Research: SessionLeaves JSON-RPC Endpoint Implementation Plan

**Date**: 2025-06-24 17:11:14 PDT
**Researcher**: allison
**Git Commit**: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
**Branch**: main
**Repository**: humanlayer
## Research Question

How to implement a sessionLeaves JSON-RPC endpoint that returns only the leaf nodes of session trees, following the existing JSON-RPC patterns in the hld daemon?

## Summary

Based on the research of existing session fork display analysis and the current JSON-RPC implementation, implementing a new `getSessionLeaves` JSON-RPC method is the optimal solution. This approach maintains backwards compatibility and provides a clean API for clients to retrieve only the leaf nodes (most recent sessions) in each session branch. The implementation requires adding tree-building logic to the backend and updating the WUI client to use the new endpoint.

## Detailed Findings

### Current Architecture State

- **Sessions have parent-child relationships** via `parent_session_id` field (`hld/store/store.go:48`)
- **No existing fork detection** or tree-building logic in the backend
- **Frontend displays flat list** of all sessions (`humanlayer-wui/src/components/internal/SessionTable.tsx`)
- **JSON-RPC pattern established** - handlers registered in `hld/rpc/handlers.go:324-331`
- **WUI uses JSON-RPC** - WUI (Tauri) is the primary client

### Current JSON-RPC Implementation Pattern

The daemon uses a standard JSON-RPC 2.0 implementation:

1. **Handler Registration**: `server.Register("methodName", handler)` in `handlers.go`
2. **Request/Response Types**: Defined as structs in `handlers.go`
3. **Client Calls**: Each client has wrapper methods that call the JSON-RPC methods
4. **Method Naming**: CamelCase for methods (e.g., `listSessions`, `launchSession`)

### Why SessionLeaves Endpoint

The name "sessionLeaves" is apt because:

1. We're returning only the leaf nodes of the session tree (sessions with no children)
2. It clearly communicates the tree metaphor to API consumers
3. It provides a cleaner, less cluttered view of active sessions

### JSON-RPC Method Design

#### Method Name: `getSessionLeaves`

#### Request Type

```go
type GetSessionLeavesRequest struct {
    // Empty for now - no parameters needed
}
```

#### Response Type

```go
type GetSessionLeavesResponse struct {
    Sessions []session.Info `json:"sessions"`
}
```


## Implementation Plan

### Phase 1: Database Layer Changes

#### 1.1 Add Index for Parent-Child Queries

**File**: `hld/store/sqlite.go`
**Location**: After line 94 (existing indexes)

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)
```

#### 1.2 Add GetSessionChildren Method

**File**: `hld/store/store.go`
**Location**: Add to ConversationStore interface

```go
GetSessionChildren(ctx context.Context, parentSessionID string) ([]*Session, error)
```

**File**: `hld/store/sqlite.go`
**Implementation**:

```go
func (s *SQLiteStore) GetSessionChildren(ctx context.Context, parentSessionID string) ([]*Session, error) {
    query := `
        SELECT id, run_id, claude_session_id, parent_session_id, query, model,
               working_dir, start_time, last_activity_at, end_time, cost_usd,
               duration_ms, num_turns, status, error
        FROM sessions
        WHERE parent_session_id = ?
        ORDER BY start_time ASC
    `

    rows, err := s.db.QueryContext(ctx, query, parentSessionID)
    if err != nil {
        return nil, fmt.Errorf("query sessions: %w", err)
    }
    defer rows.Close()

    var sessions []*Session
    // ... scanning logic following existing patterns

    return sessions, nil
}
```

### Phase 2: RPC Handler Implementation

#### 2.1 Add New Handler

**File**: `hld/rpc/handlers.go`
**Location**: After HandleListSessions (around line 130)

```go
// HandleGetSessionLeaves handles the GetSessionLeaves RPC method
func (h *SessionHandlers) HandleGetSessionLeaves(ctx context.Context, params json.RawMessage) (interface{}, error) {
    // Parse request (even though it's empty for now)
    var req GetSessionLeavesRequest
    if params != nil {
        if err := json.Unmarshal(params, &req); err != nil {
            return nil, fmt.Errorf("invalid request: %w", err)
        }
    }

    // Get all sessions
    allSessions, err := h.store.ListSessions(ctx)
    if err != nil {
        return nil, fmt.Errorf("list sessions: %w", err)
    }

    // Build parent-to-children map
    childrenMap := make(map[string][]string)
    sessionMap := make(map[string]*store.Session)

    for _, session := range allSessions {
        sessionMap[session.ID] = session
        if session.ParentSessionID != nil {
            parent := *session.ParentSessionID
            childrenMap[parent] = append(childrenMap[parent], session.ID)
        }
    }

    // Identify leaf sessions (sessions with no children)
    var leaves []session.Info
    for _, session := range allSessions {
        children := childrenMap[session.ID]

        // Include only if session has no children (is a leaf node)
        if len(children) == 0 {
            info := h.manager.SessionToInfo(session)
            leaves = append(leaves, info)
        }
    }

    // Sort by last activity (newest first)
    sort.Slice(leaves, func(i, j int) bool {
        return leaves[i].LastActivityAt.After(leaves[j].LastActivityAt)
    })

    return &GetSessionLeavesResponse{
        Sessions: leaves,
    }, nil
}
```

#### 2.2 Register Handler

**File**: `hld/rpc/handlers.go`
**Location**: In Register() method (around line 330)

```go
server.Register("getSessionLeaves", h.HandleGetSessionLeaves)
```

### Phase 3: Type Definitions

#### 3.1 Add Request/Response Types

**File**: `hld/rpc/types.go`

```go
type GetSessionLeavesRequest struct {
    // Empty for now - could add filters later
}

type GetSessionLeavesResponse struct {
    Sessions []session.Info `json:"sessions"`
}
```

### Phase 4: Client Updates

The WUI client needs to be updated to support the new JSON-RPC method while keeping the existing `listSessions` method for backwards compatibility:

#### 4.1 WUI (TypeScript/Tauri) Client Updates

**File**: `humanlayer-wui/src/lib/daemon/client.ts`
**Location**: After listSessions method (line 32)

```typescript
async getSessionLeaves(): Promise<GetSessionLeavesResponse> {
  return await invoke('get_session_leaves')
}
```

**File**: `humanlayer-wui/src/lib/daemon/types.ts`
**Add new types**:

```typescript
export interface GetSessionLeavesRequest {
  // Empty for now
}

export interface GetSessionLeavesResponse {
  sessions: SessionInfo[]
}
```

**File**: `humanlayer-wui/src-tauri/src/daemon_client/client.rs`
**Location**: After list_sessions method (line 130)

```rust
async fn get_session_leaves(&self) -> Result<GetSessionLeavesResponse> {
    self.send_rpc_request("getSessionLeaves", None::<()>).await
}
```

**File**: `humanlayer-wui/src-tauri/src/lib.rs`
**Add Tauri command**:

```rust
#[tauri::command]
async fn get_session_leaves(
    state: State<'_, DaemonState>,
) -> Result<GetSessionLeavesResponse, String> {
    state
        .client
        .get_session_leaves()
        .await
        .map_err(error_to_string)
}
```

**Register the command**: Add `get_session_leaves` to the Tauri command list in `lib.rs`

#### 4.2 Go Daemon Client Updates (for consistency)

While the Go daemon client isn't actively used, it should be kept up to date with new methods:

**File**: `hld/client/client.go`
**Add interface method**:

```go
type Client interface {
    // ... existing methods ...
    GetSessionLeaves(ctx context.Context) (*GetSessionLeavesResponse, error)
}
```

**File**: `hld/client/daemon_client.go`
**Add implementation**:

```go
func (c *DaemonClient) GetSessionLeaves(ctx context.Context) (*GetSessionLeavesResponse, error) {
    var resp GetSessionLeavesResponse
    if err := c.rpcClient.Call(ctx, "getSessionLeaves", nil, &resp); err != nil {
        return nil, fmt.Errorf("get session leaves: %w", err)
    }
    return &resp, nil
}
```

#### 4.3 Update TypeScript Code to Use getSessionLeaves

**File**: `humanlayer-wui/src/hooks/useSessions.ts`
**Location**: Line 25
**Change**: Replace `daemonClient.listSessions()` with `daemonClient.getSessionLeaves()`

**File**: `humanlayer-wui/src/AppStore.ts`
**Location**: Line 41
**Change**: Replace `daemonClient.listSessions()` with `daemonClient.getSessionLeaves()`

These are the only two places in the TypeScript code that need to be updated to use the new endpoint.


## Architecture Insights

### Performance Considerations

1. **Index on parent_session_id** is crucial for efficient child queries
2. **In-memory tree building** is acceptable for typical session counts (<10,000)
3. **Simple leaf detection** (no children) is fast and straightforward

### Migration Path

1. **Phase 1**: Implement backend endpoint
2. **Phase 2**: Update frontend to use new endpoint with fallback
3. **Phase 3**: Eventually deprecate client-side tree building

### Event-Driven Updates

The existing SSE infrastructure can notify clients when:

- New sessions are created (potential new leaves)
- Sessions complete (leaf status might change)
- New forks are created (parent becomes non-leaf)
### Benefits of Simplicity
1. **Clear semantics**: Only returns sessions with no children
2. **No complex fork handling**: Avoids UI complexity for fork visualization
3. **Future extensibility**: Can add fork detection later if needed

## Testing Strategy

Testing should be implemented following the existing patterns in the hld codebase. We need both unit tests and integration tests for the new `getSessionLeaves` functionality.

### Unit Tests

1. **Handler Tests**: Test `HandleGetSessionLeaves` in isolation
   - Empty sessions list
   - Single session (no parent/children)
   - Linear chain of sessions (A→B→C, should return only C)
   - Multiple independent sessions
   - Deep tree structures
   - Sessions with multiple children (forks)
   - Follow the existing pattern in `hld/rpc/handlers_test.go`

### Integration Tests

1. **End-to-end daemon tests** with mocked store
   - Use `make mocks` to generate interface mocks
   - Test the complete flow from JSON-RPC request to response
   - Verify correct session filtering behavior
   - Performance tests with large session counts
   - Follow the existing pattern in `hld/daemon/daemon_integration_test.go`

### Implementation Notes

- **No WUI tests needed**: The WUI doesn't have a testing framework in place
- **Use existing patterns**: Follow the coding standards and test patterns already established in the hld codebase
- **Mock generation**: Run `make mocks` when adding new interfaces that need mocking
- **Test coverage**: Ensure all edge cases are covered, especially around parent-child relationships

## Usage Examples

### Frontend Usage (WUI)

```typescript
// In useSessions.ts and AppStore.ts, replace:
const response = await daemonClient.listSessions()

// With:
const response = await daemonClient.getSessionLeaves()

// The sessions will now only include leaf nodes (sessions without children)
```

## Implementation Notes (Added 2025-07-02)

During Phase 1 implementation, we discovered:
1. **Type location**: Request/Response types were added to `handlers.go` instead of `types.go` to match the existing pattern for `ListSessions`
2. **Empty array handling**: Must return `make([]session.Info, 0)` instead of `var leaves []session.Info` to ensure JSON marshals to `[]` not `null`
3. **Test isolation**: Integration tests were using the user's actual database. Created `testutil.DatabasePath()` utility to properly isolate test databases
4. **Migration**: Successfully added as migration 5 with proper index creation

## Implementation Phases with Success Criteria

### Phase 1: Backend Implementation ✅ COMPLETED
**Goal**: Implement the `getSessionLeaves` JSON-RPC handler in hld

Success Criteria:
- [x] Add index on `parent_session_id` in SQLite migration
- [x] Add `GetSessionLeavesRequest` and `GetSessionLeavesResponse` types to `hld/rpc/types.go`
- [x] Implement `HandleGetSessionLeaves` in `hld/rpc/handlers.go`
- [x] Register handler with `server.Register("getSessionLeaves", h.HandleGetSessionLeaves)`
- [x] Add unit tests in `hld/rpc/handlers_test.go`
- [x] Add integration tests in `hld/daemon/daemon_integration_test.go`
- [x] All tests pass with `make test`
- [x] Manual test: JSON-RPC call returns only leaf sessions

### Phase 2: Client Library Updates ✅ COMPLETED
**Goal**: Add `getSessionLeaves` method to all daemon clients

Success Criteria:
- [x] Add `GetSessionLeaves` method to Go client interface in `hld/client/types.go`
- [x] Implement method in `hld/client/client.go`
- [x] Add types to `humanlayer-wui/src/lib/daemon/types.ts`
- [x] Add method to `humanlayer-wui/src/lib/daemon/client.ts`
- [x] Add Rust types to `humanlayer-wui/src-tauri/src/daemon_client/types.rs`
- [x] Add method to `humanlayer-wui/src-tauri/src/daemon_client/client.rs`
- [x] Add Tauri command to `humanlayer-wui/src-tauri/src/lib.rs`
- [x] Register command in Tauri builder
- [x] All clients compile without errors

### Phase 3: Frontend Integration
**Goal**: Update WUI to use `getSessionLeaves` instead of `listSessions`

Success Criteria:
- [ ] Update `humanlayer-wui/src/hooks/useSessions.ts` line 25
- [ ] Update `humanlayer-wui/src/AppStore.ts` line 41
- [ ] WUI builds successfully with `npm run build`
- [ ] Sessions view shows only leaf sessions (no parents with children)
- [ ] Session continuations create new leaves correctly
- [ ] Parent sessions disappear from view when children exist

### Phase 4: Validation & Deployment
**Goal**: Ensure the feature works correctly in production

Success Criteria:
- [ ] Create multiple session chains and verify only leaves show
- [ ] Test with forked sessions (multiple children)
- [ ] Verify SSE updates work correctly when sessions change
- [ ] Performance is acceptable with 100+ sessions
- [ ] No regression in existing functionality
- [ ] Update any documentation if needed

## Future Enhancements

If fork visualization becomes important later, we could:
1. Add a `include_forks` parameter to return fork points
2. Add `parent_session_id` to responses for client-side tree building
3. Create a separate `getSessionTree` endpoint for full tree structure
4. Add `sibling_count` to indicate when a session has siblings

## Historical Context (from thoughts/)

- `thoughts/shared/research/2025-06-24_16-33-46_session_fork_display_api.md` - Original analysis of session fork display options
- `thoughts/shared/research/2025-06-24_16-52-55_daemon_api_impact_on_session_fork_display.md` - Confirmed new endpoint approach aligns with daemon principles
- The JSON-RPC implementation follows existing patterns in the hld daemon

## Related Research

- `thoughts/shared/research/2025-06-24_12-29-39_session_fork_display.md` - Initial session fork exploration
- Current JSON-RPC handler patterns in `hld/rpc/handlers.go`

## Open Questions

1. Should we cache the tree structure for performance?
2. Should we add a `max_depth` parameter to limit tree traversal?
3. How should the UI indicate fork points vs leaf sessions?
4. Should we emit SSE events when session trees change?

## Notes on TUI

The TUI (Terminal User Interface) has been archived and will not receive new features. A CLAUDE.md file should be added to `humanlayer-tui/` to make this clear to AI assistants. The TUI remains available for reference but new features like `getSessionLeaves` will only be implemented in the WUI.

## Conclusion

The getSessionLeaves JSON-RPC method provides a clean solution to the session display problem while maintaining backwards compatibility. By returning only leaf nodes, it reduces UI clutter when users have multiple session continuations. The implementation follows established JSON-RPC patterns and requires minimal changes to the WUI client - just two locations where `listSessions` is replaced with `getSessionLeaves`.
