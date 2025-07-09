# File Snapshot RPC Endpoint Implementation Plan

## Overview

Create a JSON-RPC endpoint in the daemon (hld) to expose file snapshots captured during Read operations. This is a server-side only change that adds the RPC endpoint. The WUI client integration will be handled in the follow-up ticket ENG-1525.

**Scope of this ticket:**
- Add RPC types and handler in hld daemon
- Expose snapshots via `getSessionSnapshots` endpoint
- No client-side changes (no WUI, no TypeScript/Rust daemon client updates)

## Current State Analysis

The file snapshot system (ENG-1520) has been partially implemented:

### Already Completed:
- Database migration 7 with `file_snapshots` table
- Store interface methods: `CreateFileSnapshot`, `GetFileSnapshots`, `GetToolCallByID`
- `FileSnapshot` type in `store/store.go`
- `ReadToolResult` type in `session/types.go`
- `captureFileSnapshot` method in `session/manager.go`
- Comprehensive tests for snapshot functionality

### What Remains:
- RPC endpoint to expose snapshots to the WUI
- Integration with daemon's RPC server
- Testing the endpoint with real WUI integration

The frontend needs access to these snapshots to show proper diffs for Edit/Write/MultiEdit operations.

### Key Discoveries:
- Existing RPC patterns in `hld/rpc/handlers.go` follow a consistent structure
- Timestamps are always formatted as ISO 8601 strings in responses
- Handler methods follow the signature: `func(ctx, params) (interface{}, error)`
- All RPC types use snake_case for JSON field names
- SessionHandlers manages session-related RPC endpoints
- No authentication/authorization in current RPC implementation

## What We're NOT Doing

- No pagination (MVP returns all snapshots for a session)
- No filtering by file path or timestamp on the backend
- No real-time updates via WebSocket
- No authentication/authorization (consistent with existing RPC)
- No caching on the backend
- No automatic matching of snapshots to Edit operations (WUI will handle this by finding the most recent snapshot for a given file path)

## Implementation Approach

Add a `getSessionSnapshots` endpoint to the existing SessionHandlers that returns all snapshots for a given session. The frontend will handle filtering, caching, and matching snapshots to Edit operations.

## Phase 1: Update RPC Types

### Overview
Define request and response types following existing patterns in the codebase.

### Changes Required:

#### 1. RPC Types
**File**: `hld/rpc/types.go`
**Changes**: Add after existing session-related types (around line 60)

```go
// GetSessionSnapshotsRequest requests file snapshots for a session
type GetSessionSnapshotsRequest struct {
    SessionID string `json:"session_id"`
}

// GetSessionSnapshotsResponse contains file snapshots for the session
type GetSessionSnapshotsResponse struct {
    Snapshots []FileSnapshotInfo `json:"snapshots"`
}

// FileSnapshotInfo contains snapshot data for frontend display
type FileSnapshotInfo struct {
    ToolID    string `json:"tool_id"`
    FilePath  string `json:"file_path"`
    Content   string `json:"content"`
    CreatedAt string `json:"created_at"` // ISO 8601 format
}
```

### Success Criteria:

#### Automated Verification:
- [x] Types compile: `cd hld && go build ./rpc`
- [x] No linting errors: `cd hld && golangci-lint run ./rpc`

#### Manual Verification:
- [ ] Types match WUI expectations
- [ ] JSON field names follow snake_case convention

---

## Phase 2: Implement RPC Handler

### Overview
Add the handler method to SessionHandlers following established patterns.

### Changes Required:

#### 1. Handler Method
**File**: `hld/rpc/handlers.go`
**Changes**: Add method to SessionHandlers struct (after HandleGetConversation, around line 240)

```go
// HandleGetSessionSnapshots retrieves all file snapshots for a session
func (h *SessionHandlers) HandleGetSessionSnapshots(ctx context.Context, params json.RawMessage) (interface{}, error) {
    // Parse request
    var req GetSessionSnapshotsRequest
    if err := json.Unmarshal(params, &req); err != nil {
        return nil, fmt.Errorf("invalid request: %w", err)
    }
    
    // Validate required fields
    if req.SessionID == "" {
        return nil, fmt.Errorf("session_id is required")
    }
    
    // Verify session exists
    _, err := h.store.GetSession(ctx, req.SessionID)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, fmt.Errorf("session not found")
        }
        return nil, fmt.Errorf("failed to get session: %w", err)
    }
    
    // Get snapshots from store
    snapshots, err := h.store.GetFileSnapshots(ctx, req.SessionID)
    if err != nil {
        return nil, fmt.Errorf("failed to get snapshots: %w", err)
    }
    
    // Convert to response format
    response := &GetSessionSnapshotsResponse{
        Snapshots: make([]FileSnapshotInfo, 0, len(snapshots)),
    }
    
    for _, snapshot := range snapshots {
        response.Snapshots = append(response.Snapshots, FileSnapshotInfo{
            ToolID:    snapshot.ToolID,
            FilePath:  snapshot.FilePath,
            Content:   snapshot.Content,
            CreatedAt: snapshot.CreatedAt.Format(time.RFC3339),
        })
    }
    
    return response, nil
}
```

#### 2. Add Import
**File**: `hld/rpc/handlers.go`
**Changes**: Add to imports if not already present

```go
import (
    "database/sql"
    "errors"
    // ... existing imports
)
```

#### 3. Register Handler
**File**: `hld/rpc/handlers.go`
**Changes**: Add to SessionHandlers.Register method (around line 385)

```go
func (h *SessionHandlers) Register(server *Server) {
    server.Register("launchSession", h.HandleLaunchSession)
    server.Register("listSessions", h.HandleListSessions)
    server.Register("getSessionLeaves", h.HandleGetSessionLeaves)
    server.Register("getConversation", h.HandleGetConversation)
    server.Register("getSessionState", h.HandleGetSessionState)
    server.Register("continueSession", h.HandleContinueSession)
    server.Register("interruptSession", h.HandleInterruptSession)
    server.Register("getSessionSnapshots", h.HandleGetSessionSnapshots)  // Add this line
}
```

### Success Criteria:

#### Automated Verification:
- [x] Handler compiles: `cd hld && go build ./rpc`
- [x] Unit tests pass: `cd hld && go test ./rpc`
- [x] No linting errors: `cd hld && golangci-lint run ./rpc`

#### Manual Verification:
- [ ] Endpoint callable via daemon's RPC interface
- [ ] Returns empty array for sessions without snapshots
- [ ] Returns proper error for non-existent sessions
- [ ] Timestamps formatted correctly as ISO 8601

---

## Phase 3: Integration Testing

### Overview
Verify the endpoint works correctly with the full system.

### Changes Required:

#### 1. Add Integration Test
**File**: `hld/rpc/handlers_test.go`
**Changes**: Add test for the new endpoint

```go
func TestHandleGetSessionSnapshots(t *testing.T) {
    // Create test store with mock data
    store := &mockStore{
        sessions: map[string]*store.Session{
            "test-session": {
                ID:        "test-session",
                State:     "running",
                CreatedAt: time.Now(),
            },
        },
        snapshots: map[string][]*store.FileSnapshot{
            "test-session": {
                {
                    ID:        1,
                    ToolID:    "tool-123",
                    SessionID: "test-session",
                    FilePath:  "src/main.go",
                    Content:   "package main\n\nfunc main() {}",
                    CreatedAt: time.Now().Add(-5 * time.Minute),
                },
                {
                    ID:        2,
                    ToolID:    "tool-456",
                    SessionID: "test-session",
                    FilePath:  "src/helper.go",
                    Content:   "package main\n\nfunc helper() {}",
                    CreatedAt: time.Now().Add(-3 * time.Minute),
                },
            },
        },
    }
    
    handlers := NewSessionHandlers(nil, store)
    
    // Test successful retrieval
    params, _ := json.Marshal(GetSessionSnapshotsRequest{
        SessionID: "test-session",
    })
    
    result, err := handlers.HandleGetSessionSnapshots(context.Background(), params)
    require.NoError(t, err)
    
    response, ok := result.(*GetSessionSnapshotsResponse)
    require.True(t, ok)
    require.Len(t, response.Snapshots, 2)
    
    // Verify snapshots are returned in order
    assert.Equal(t, "src/main.go", response.Snapshots[0].FilePath)
    assert.Equal(t, "src/helper.go", response.Snapshots[1].FilePath)
    
    // Test non-existent session
    params, _ = json.Marshal(GetSessionSnapshotsRequest{
        SessionID: "non-existent",
    })
    
    _, err = handlers.HandleGetSessionSnapshots(context.Background(), params)
    require.Error(t, err)
    assert.Contains(t, err.Error(), "session not found")
    
    // Test missing session_id
    params, _ = json.Marshal(GetSessionSnapshotsRequest{})
    
    _, err = handlers.HandleGetSessionSnapshots(context.Background(), params)
    require.Error(t, err)
    assert.Contains(t, err.Error(), "session_id is required")
}
```

### Success Criteria:

#### Automated Verification:
- [x] Integration tests pass: `cd hld && go test ./rpc -tags=integration`
- [x] All existing tests still pass

#### Manual Verification:
- [ ] Test with real Claude Code session creating snapshots
- [ ] Verify snapshots retrieved correctly via direct RPC call
- [ ] Performance acceptable with 50+ snapshots
- [ ] Response format ready for WUI consumption (proper JSON structure)

---

## Testing Strategy

### Unit Tests:
- Handler with mock store returning various snapshot counts
- Error cases (invalid session, store errors)
- Empty snapshot list handling
- Timestamp formatting verification

### Integration Tests:
- End-to-end test with real SQLite database
- Multiple snapshots for a session
- Concurrent access to the endpoint
- Large snapshot content (10MB+)

### Manual Testing Steps:
1. Start hld daemon with file snapshot system deployed
2. Launch Claude Code session (via any method)
3. Have Claude read several files (both full and partial reads)
4. Test the endpoint directly via JSON-RPC:
   ```bash
   # Example using curl to test the daemon's JSON-RPC endpoint
   curl -X POST http://localhost:8080/rpc \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "method": "getSessionSnapshots",
       "params": {"session_id": "SESSION_ID_HERE"},
       "id": 1
     }'
   ```
5. Verify all Read operations resulted in snapshots in the response
6. Test with non-existent session ID to verify error handling
7. Verify response format matches expected structure (tool_id, file_path, content, created_at)

## Performance Considerations

- No pagination in MVP - monitor response sizes
- Snapshots ordered by created_at DESC (most recent first)
- Consider adding `limit` parameter in future if needed
- Database indexes from ENG-1520 should ensure fast queries
- Frontend responsible for caching to avoid repeated calls

## Migration Notes

- Requires ENG-1520 to be deployed first
- Backwards compatible - old sessions simply return empty snapshot arrays
- No database changes needed (uses tables from ENG-1520)

## Future Enhancements

- Add pagination for sessions with many snapshots
- Add filtering parameters (by file_path, after timestamp)
- Include file hash for deduplication checks
- Add WebSocket subscription for real-time snapshot updates

## References

- Original ticket: `thoughts/allison/tickets/eng_1523.md`
- Prerequisite implementation: `thoughts/shared/plans/file_snapshot_system.md` (ENG-1520)
- Follow-up WUI integration: `thoughts/allison/tickets/eng_1525.md` (ENG-1525)
- Research document: `thoughts/shared/research/2025-07-03_09-43-22_wui_diff_view_tickets.md`
- Similar RPC handler: `hld/rpc/handlers.go:185-238` (GetConversation)
- Parent ticket: [ENG-1502](https://linear.app/humanlayer/issue/ENG-1502/make-tickets-to-improve-diff-views)