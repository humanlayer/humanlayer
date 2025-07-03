---
date: 2025-06-24 17:11:14 PDT
researcher: allison
git_commit: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
branch: main
repository: humanlayer
topic: "SessionLeaves JSON-RPC Endpoint Implementation Plan"
tags: [research, codebase, sessions, api]
status: complete
last_updated: 2025-06-24
last_updated_by: allison
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

Based on the research of existing session fork display analysis and the current JSON-RPC implementation, implementing a new `getSessionLeaves` JSON-RPC method is the optimal solution. This approach maintains backwards compatibility and provides a clean API for clients to retrieve only the leaf nodes (most recent sessions) in each session branch. The implementation requires adding tree-building logic to the backend, a new store method for efficient child queries, and updates to all JSON-RPC clients (WUI, TUI, and hlyr).

## Detailed Findings

### Current Architecture State

- **Sessions have parent-child relationships** via `parent_session_id` field (`hld/store/store.go:48`)
- **No existing fork detection** or tree-building logic in the backend
- **Frontend displays flat list** of all sessions (`humanlayer-wui/src/components/internal/SessionTable.tsx`)
- **JSON-RPC pattern established** - handlers registered in `hld/rpc/handlers.go:324-331`
- **All clients use JSON-RPC** - WUI (Tauri), TUI (Go), and hlyr (TypeScript)

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

#### Extended Session Info

The `session.Info` struct will be extended with optional tree metadata:

```go
// Tree metadata (only populated by GetSessionLeaves)
Depth int `json:"depth,omitempty"`
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

    // Identify leaf sessions and fork points
    var leaves []session.Info
    for _, session := range allSessions {
        children := childrenMap[session.ID]

        // Include if:
        // 1. No children (leaf node)
        // 2. Has multiple children (fork point) when include_linear is false
        if len(children) == 0 || (len(children) > 1 && !req.IncludeLinear) {
            info := h.manager.SessionToInfo(session)

            // Add tree metadata
            if session.ParentSessionID != nil {
                siblings := childrenMap[*session.ParentSessionID]
                info.HasSiblings = len(siblings) > 1
            }

            info.Depth = calculateDepth(session, sessionMap)
            info.BranchCount = len(children)

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

func calculateDepth(session *store.Session, sessionMap map[string]*store.Session) int {
    depth := 0
    current := session

    for current.ParentSessionID != nil {
        parent, exists := sessionMap[*current.ParentSessionID]
        if !exists {
            break
        }
        depth++
        current = parent
    }

    return depth
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

#### 3.2 Extend Session Info

**File**: `hld/session/types.go`
**Location**: Add to Info struct (around line 50)

```go
type Info struct {
    // ... existing fields ...

    // Tree metadata (only populated by GetSessionLeaves)
    Depth int `json:"depth,omitempty"`
}
```

### Phase 4: Client Updates

All three clients need to be updated to support the new JSON-RPC method:

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

// Update SessionInfo to include optional depth
export interface SessionInfo {
  // ... existing fields ...
  depth?: number
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

#### 4.2 TUI (Go) Client Updates

**File**: `humanlayer-tui/api.go`
**Add new function after fetchSessions (line 221)**:

```go
func fetchSessionLeaves(daemonClient client.Client) tea.Cmd {
	return func() tea.Msg {
		// Create request
		req := rpc.GetSessionLeavesRequest{
			IncludeLinear: includeLinear,
		}

		// Call new RPC method
		resp, err := daemonClient.GetSessionLeaves()
		if err != nil {
			return fetchSessionsMsg{err: err}
		}

		return fetchSessionsMsg{sessions: resp.Sessions}
	}
}
```

**File**: `humanlayer-tui/client/client.go`
**Add interface method**:

```go
type Client interface {
    // ... existing methods ...
    GetSessionLeaves() (*rpc.GetSessionLeavesResponse, error)
}
```

**File**: `humanlayer-tui/client/daemon_client.go`
**Add implementation**:

```go
func (c *DaemonClient) GetSessionLeaves() (*rpc.GetSessionLeavesResponse, error) {
    var resp rpc.GetSessionLeavesResponse
    if err := c.Call("getSessionLeaves", nil, &resp); err != nil {
        return nil, err
    }
    return &resp, nil
}
```

#### 4.3 hlyr (TypeScript) Client Updates

**File**: `hlyr/src/daemonClient.ts`
**Location**: After listSessions method (line 317)

```typescript
async getSessionLeaves(): Promise<{ sessions: unknown[] }> {
  return this.call<{ sessions: unknown[] }>('getSessionLeaves')
}
```

**File**: `hlyr/src/types.ts`
**Add types**:

```typescript
export interface GetSessionLeavesRequest {
  // Empty for now
}

export interface GetSessionLeavesResponse {
  sessions: SessionInfo[]
}
```

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
2. **Depth provides context**: Users can see how deep their session history goes
3. **No complex fork handling**: Avoids UI complexity for fork visualization
4. **Future extensibility**: Can add fork detection later if needed

## Testing Strategy

### Unit Tests

1. **Handler Tests**: Test `HandleGetSessionLeaves` with various session trees

   - Empty sessions list
   - Single session (no parent/children)
   - Linear chain of sessions (A→B→C, should return only C)
   - Multiple independent sessions
   - Deep tree structures

2. **Depth Calculation Tests**:
   - Root session (depth = 0)
   - Direct child (depth = 1)
   - Deep chains (depth = N)
   - Orphaned sessions (parent doesn't exist)

### Integration Tests

1. **End-to-end tests** with actual daemon
2. **Client tests** for all three clients (WUI, TUI, hlyr)
3. **Performance tests** with large session counts

### Test File Locations

- **Handler tests**: `hld/rpc/handlers_test.go`
- **Integration tests**: `hld/daemon/daemon_integration_test.go`
- **Client tests**: Each client's test directory

## Usage Examples

### Frontend Usage (WUI)

```typescript
// Use the new method to get only leaf sessions
const response = await daemonClient.getSessionLeaves()
const sessions = response.sessions

// Display sessions with depth indicator
sessions.forEach(session => {
  // Show depth as subtle indicator (e.g., indentation or nested icon)
  const depthIndicator = '┗'.repeat(session.depth || 0)
  console.log(`${depthIndicator} ${session.query}`)
})
```

### TUI Usage

```go
// Replace fetchSessions with fetchSessionLeaves
return fetchSessionLeaves(m.daemonClient)
```

### CLI Usage (hlyr)

```typescript
// Get session leaves for display
const response = await daemonClient.getSessionLeaves()
console.log(`Found ${response.sessions.length} active sessions`)
```

## Migration Path

1. **Phase 1**: Implement backend handler and test
2. **Phase 2**: Update clients one by one with fallback to `listSessions`
3. **Phase 3**: Switch UIs to use `getSessionLeaves` by default
4. **Phase 4**: Monitor usage and gather feedback

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

## Conclusion

The getSessionLeaves JSON-RPC method provides a clean solution to the session display problem while maintaining backwards compatibility. By returning only leaf nodes and fork points, it reduces UI clutter while preserving the ability to see session history. The implementation follows established JSON-RPC patterns and requires minimal changes across all clients.
