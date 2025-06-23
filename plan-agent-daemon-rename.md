# Daemon Session Rename Agent Plan

You are Dan Abramov, legendary programmer. You MUST adopt the Developer Agent persona from `.multiclaude/personas/agent-developer.md` before proceeding.

## Mission: Implement Session Rename Backend Persistence

The frontend UI for session renaming already works but doesn't persist. You need to implement the backend daemon functionality to store and retrieve custom session names.

## Comprehensive Analysis Results

Based on analysis of 1500+ lines of daemon code:

### **Current State:**
- ❌ NO `custom_name` field in sessions table
- ❌ NO `updateSession` RPC endpoint
- ❌ SessionUpdate struct doesn't include custom names
- ✅ Strong patterns exist for session management
- ✅ Frontend rename UI already implemented

### **Database Schema (SQLite)**
**File**: `hld/store/sqlite.go` 
**Current sessions table** has: id, run_id, query, model, status, etc.
**Missing**: `custom_name TEXT` column

### **Go Type System**
**Files**: `hld/store/store.go`, `hld/rpc/types.go`
**Current**: Session and SessionUpdate structs 
**Missing**: CustomName field in both

### **RPC Layer**
**File**: `hld/rpc/handlers.go`
**Current**: launchSession, listSessions, getSessionState, etc.
**Missing**: updateSession RPC method

## Your Implementation Tasks

### 1. Database Schema Migration
**File**: `hld/store/sqlite.go`
- Add `custom_name TEXT` column to sessions table
- Update CreateSessionsTable function or add migration
- Ensure backwards compatibility

### 2. Update Go Type System  
**Files**: `hld/store/store.go`, `hld/rpc/types.go`
```go
// In store.go:
type Session struct {
    // ... existing fields ...
    CustomName string `json:"custom_name,omitempty"`
}

type SessionUpdate struct {
    // ... existing fields ...
    CustomName *string `json:"custom_name,omitempty"`
}

// In rpc/types.go:
type UpdateSessionRequest struct {
    SessionID   string  `json:"session_id" validate:"required"`
    CustomName  *string `json:"custom_name,omitempty"`
}

type UpdateSessionResponse struct {
    Success bool   `json:"success"`
    Error   string `json:"error,omitempty"`
}
```

### 3. Implement RPC Handler
**File**: `hld/rpc/handlers.go`
- Add `HandleUpdateSession` method following existing patterns
- Validate session exists and user has access
- Call store.UpdateSession with new CustomName
- Return success/error response
- Add to RPC method registry

### 4. Update Store Layer
**File**: `hld/store/sqlite.go`
- Update `UpdateSession` method to handle CustomName field
- Modify SQL UPDATE statements to include custom_name
- Ensure proper field validation and SQL injection protection

### 5. Frontend Type Integration
**File**: `humanlayer-wui/src/lib/daemon/types.ts`
```typescript
interface SessionInfo {
    // ... existing fields ...
    custom_name?: string
}

interface UpdateSessionRequest {
    session_id: string
    custom_name?: string
}
```

### 6. Frontend API Client
**File**: `humanlayer-wui/src/lib/daemon/client.ts`
- Add `updateSession` method to DaemonClient
- Follow existing RPC call patterns
- Handle promise-based responses

## Implementation Strategy

### Phase 1: Backend Core (Priority 1)
1. **READ FIRST**: Read complete files in hld/store/ and hld/rpc/ (1500+ lines)
2. Add database schema migration for custom_name column
3. Update Session and SessionUpdate structs
4. Implement UpdateSession store method

### Phase 2: RPC Layer (Priority 1)  
1. Create UpdateSessionRequest/Response types
2. Implement HandleUpdateSession RPC handler
3. Register new RPC method in routing
4. Add proper validation and error handling

### Phase 3: Frontend Integration (Priority 2)
1. Update TypeScript type definitions
2. Add updateSession method to daemon client
3. Wire up existing rename UI to call new API
4. Handle success/error responses in UI

### Phase 4: Testing & Validation (Priority 2)
1. Test database migrations work correctly
2. Test RPC endpoint with various inputs
3. Test end-to-end rename functionality
4. Ensure backwards compatibility

## Files You Own (Don't Create New Files)

**Backend:**
- `hld/store/sqlite.go` - Database schema and store methods
- `hld/store/store.go` - Type definitions and interfaces  
- `hld/rpc/types.go` - RPC request/response types
- `hld/rpc/handlers.go` - RPC method handlers
- `hld/rpc/server.go` - Method registration (if needed)

**Frontend:**
- `humanlayer-wui/src/lib/daemon/types.ts` - TypeScript type definitions
- `humanlayer-wui/src/lib/daemon/client.ts` - API client methods

## Key Patterns to Follow

### **Error Handling:**
```go
if err != nil {
    return nil, fmt.Errorf("failed to update session: %w", err)
}
```

### **SQL Safety:**
```go
// Use prepared statements, never string concatenation
query := `UPDATE sessions SET custom_name = ? WHERE id = ?`
```

### **RPC Patterns:**
```go
func (h *SessionHandlers) HandleUpdateSession(ctx context.Context, params json.RawMessage) (interface{}, error) {
    var req UpdateSessionRequest
    if err := json.Unmarshal(params, &req); err != nil {
        return nil, fmt.Errorf("invalid request: %w", err)
    }
    // ... implementation
}
```

### **Validation:**
```go
if req.SessionID == "" {
    return &UpdateSessionResponse{Success: false, Error: "session_id required"}, nil
}
```

## Expected Commits

1. Add custom_name column to sessions table schema
2. Update Session and SessionUpdate structs with CustomName field
3. Implement UpdateSession store method with custom_name support
4. Add UpdateSessionRequest/Response RPC types
5. Implement HandleUpdateSession RPC handler
6. Register updateSession RPC method in routing
7. Update frontend TypeScript types for custom_name
8. Add updateSession method to daemon client
9. Wire rename UI to call updateSession API

## Success Criteria

- Database has custom_name column that persists session renames
- RPC endpoint accepts updateSession calls with validation
- Frontend can successfully rename sessions via API calls
- Renamed sessions display custom names in session table/detail
- All existing functionality remains intact
- Tests pass and no regressions introduced

## Constraints

- Use existing database migration patterns (if any exist)
- Follow existing RPC error handling conventions
- Don't break backwards compatibility
- Use prepared SQL statements for security
- COMMIT every 5-10 minutes as you make progress
- Ensure proper validation of all inputs

## Context Integration

The frontend rename UI is already implemented with:
- `N` hotkey to start rename in SessionTable and SessionDetail
- Inline editing with save/cancel (Enter/Escape)
- UI components ready to call `handleRenameSession(sessionId, newTitle)`

Your job is to make that `handleRenameSession` function actually persist the rename to the database via the daemon API.