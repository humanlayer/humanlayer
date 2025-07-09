# Implementation Plan: Inject Query as First Conversation Event and Add Summary Field

## Overview

This plan details the implementation of Option 2 from our discussion: keeping the Query field for backward compatibility while injecting it as the first conversation event and adding a new Summary field.

## Background

- PR #238 implemented UI truncation of long queries to 50 characters
- Users want to see the full query in conversation view without needing to expand it
- The Query field accurately represents what the user asked and should be preserved
- We need a Summary field for display in session lists
- Research revealed that queries from continued sessions don't appear in conversation view

## Goals

1. Keep the `Query` field unchanged for backward compatibility
2. Add a new `Summary` field to `SessionInfo`
3. Inject the query as the first conversation event AFTER Claude session ID is captured
4. Calculate summary using truncation logic from PR #238 (50 chars)
5. Ensure query appears before any Claude-generated events
6. Handle both LaunchSession and ContinueSession flows

## Implementation Steps

### 1. Database Schema Changes

**File**: `hld/store/sqlite.go`

- Add to schema creation (line 71, after `query TEXT NOT NULL,`):

```sql
summary TEXT,
```

**Note on migrations**:

- The codebase doesn't have a formal migration system
- It uses `CREATE TABLE IF NOT EXISTS` and relies on nullable columns
- For existing databases, manually run: `ALTER TABLE sessions ADD COLUMN summary TEXT;`
- New installations will have the column from the start

### 2. Backend Type Updates

**File**: `hld/store/store.go`

- Add `Summary` field to `Session` struct (around line 49):

```go
Summary            string
```

- Add `Summary` field to `SessionUpdate` struct (around line 69):

```go
Summary         *string
```

**File**: `hld/session/types.go`

- Add `Summary` field to `Info` struct (around line 49):

```go
Summary         string             `json:"summary"`
```

**File**: `hld/rpc/types.go`

- Add `Summary` field to `SessionState` struct (search for `type SessionState`):

```go
Summary         string `json:"summary"`
```

### 3. Summary Calculation Logic

**File**: Create `hld/session/summary.go`

```go
package session

import "strings"

// CalculateSummary generates a summary from a query using the same logic as the WebUI
func CalculateSummary(query string) string {
    // Replace whitespace with single spaces and trim
    cleaned := strings.ReplaceAll(query, "\n", " ")
    cleaned = strings.ReplaceAll(cleaned, "\r", " ")
    cleaned = strings.ReplaceAll(cleaned, "\t", " ")
    cleaned = strings.TrimSpace(cleaned)

    const maxLength = 50
    if len(cleaned) <= maxLength {
        return cleaned
    }

    return cleaned[:maxLength-3] + "..."
}
```

### 4. Query Injection Logic

**File**: `hld/session/manager.go`

**Add query storage to Manager struct** (around line 70):

```go
type Manager struct {
    // ... existing fields ...
    pendingQueries sync.Map // map[sessionID]query - stores queries waiting for Claude session ID
}
```

**Add helper function** (after line 900):

```go
// injectQueryAsFirstEvent adds the user's query as the first conversation event
func (m *Manager) injectQueryAsFirstEvent(ctx context.Context, sessionID, claudeSessionID, query string) error {
    // Check if we already have a user message as the first event (deduplication)
    events, err := m.store.GetConversationEvents(ctx, claudeSessionID, 1)
    if err == nil && len(events) > 0 && events[0].Role == "user" {
        return nil // Query already injected
    }

    event := &store.ConversationEvent{
        SessionID:       sessionID,
        ClaudeSessionID: claudeSessionID,
        Sequence:        1, // Start at 1, not 0 (matches existing pattern)
        EventType:       store.EventTypeMessage,
        CreatedAt:       time.Now(),
        Role:            "user",
        Content:         query,
    }
    return m.store.AddConversationEvent(ctx, event)
}
```

**Update LaunchSession** (around line 142):

- Store the query for later injection when Claude session ID is available
- Search for: `go m.monitorSession` to find the right spot
- Add before the goroutine:

```go
// Store query for injection after Claude session ID is captured
m.pendingQueries.Store(sessionID, config.Query)
```

**Update ContinueSession** (around line 782):

- Similarly store query for later injection
- Add before `go m.monitorSession`:

```go
// Store query for injection after Claude session ID is captured
m.pendingQueries.Store(sessionID, req.Query)
```

**Update monitorSession** (around line 186-202):

- When Claude session ID is first captured, inject the stored query
- Search for: `if event.SessionID != "" && claudeSessionID == ""`
- After updating session with Claude ID, inject the query:

```go
if event.SessionID != "" && claudeSessionID == "" {
    claudeSessionID = event.SessionID

    // Update session with Claude ID
    if err := m.store.UpdateSession(ctx, sessionID, &store.SessionUpdate{
        ClaudeSessionID: &claudeSessionID,
    }); err != nil {
        slog.Error("failed to update session with claude session id", "error", err)
    }

    // Inject the pending query now that we have Claude session ID
    if queryVal, ok := m.pendingQueries.LoadAndDelete(sessionID); ok {
        if query, ok := queryVal.(string); ok && query != "" {
            if err := m.injectQueryAsFirstEvent(ctx, sessionID, claudeSessionID, query); err != nil {
                slog.Error("failed to inject query as first event",
                    "sessionID", sessionID,
                    "claudeSessionID", claudeSessionID,
                    "error", err)
            }
        }
    }
}
```

**Handle cleanup** (in session completion/error handlers):

- Clean up any pending queries that weren't injected
- Add to error handling and completion paths:

```go
m.pendingQueries.Delete(sessionID)
```

### 5. Summary Population

**File**: `hld/session/manager.go`

**Update LaunchSession** (around line 130):

- When creating dbSession, calculate and set summary:

```go
dbSession := store.NewSessionFromConfig(sessionID, runID, config)
dbSession.Summary = CalculateSummary(config.Query)
```

**Update ContinueSession** (around line 640):

- Similarly set summary when creating child session:

```go
dbSession := &store.Session{
    ID:              sessionID,
    RunID:           runID,
    ClaudeSessionID: "", // Will be populated later
    ParentSessionID: req.ParentSessionID,
    Status:          store.SessionStatusStarting,
    StartTime:       time.Now(),
    LastActivityAt:  time.Now(),
    Query:           req.Query,
    Summary:         CalculateSummary(req.Query), // Add this line
    Model:           req.Model,
    WorkingDir:      req.WorkingDir,
}
```

**Update GetSessionInfo** (around line 312):

- Populate Summary field in Info struct:

```go
return &Info{
    ID:              dbSession.ID,
    RunID:           dbSession.RunID,
    ClaudeSessionID: dbSession.ClaudeSessionID,
    ParentSessionID: dbSession.ParentSessionID,
    Status:          Status(dbSession.Status),
    StartTime:       dbSession.StartTime,
    EndTime:         dbSession.EndTime,
    LastActivityAt:  dbSession.LastActivityAt,
    Error:           dbSession.Error,
    Query:           dbSession.Query,
    Summary:         dbSession.Summary, // Add this line
    Model:           dbSession.Model,
    WorkingDir:      dbSession.WorkingDir,
    Result:          dbSession.Result,
}, nil
```

**Update ListSessions** (around line 371):

- Populate Summary field when building Info structs:

```go
infos[i] = &Info{
    ID:              dbSession.ID,
    RunID:           dbSession.RunID,
    ClaudeSessionID: dbSession.ClaudeSessionID,
    ParentSessionID: dbSession.ParentSessionID,
    Status:          Status(dbSession.Status),
    StartTime:       dbSession.StartTime,
    EndTime:         dbSession.EndTime,
    LastActivityAt:  dbSession.LastActivityAt,
    Error:           dbSession.Error,
    Query:           dbSession.Query,
    Summary:         dbSession.Summary, // Add this line
    Model:           dbSession.Model,
    WorkingDir:      dbSession.WorkingDir,
    Result:          dbSession.Result,
}
```

### 6. Frontend Type Updates

**File**: `humanlayer-wui/src/lib/daemon/types.ts`

- Add to `SessionInfo` interface (around line 79):

```typescript
summary: string
```

- Add to `SessionState` interface (around line 91):

```typescript
summary: string
```

**File**: `humanlayer-wui/src-tauri/src/daemon_client/types.rs`

- Add to `SessionInfo` struct (around line 112):

```rust
pub summary: String,
```

- Add to `SessionState` struct (around line 150):

```rust
pub summary: String,
```

**File**: `humanlayer-tui/api.go`

- Update struct definitions to include Summary field
- Search for: `type SessionInfo struct` and `type SessionState struct`

### 7. UI Updates

**File**: `humanlayer-wui/src/components/internal/SessionTable.tsx`

- Change line 80 from displaying `session.query` to `session.summary`:

```tsx
<TableCell className="max-w-xs truncate">{session.summary}</TableCell>
```

- Update table header from "Query" to "Summary" (line 64)

**File**: `humanlayer-tui/sessions.go`

- Update session list to show summary instead of truncated query
- Search for: `truncate(s.Query, 50)` and replace with `s.Summary`

### 8. Tests

**File**: Create `hld/session/manager_query_injection_test.go`

```go
func TestQueryInjection(t *testing.T) {
    // Test cases:
    // 1. Query is injected AFTER Claude session ID is available
    // 2. Query appears as sequence=1 (first event)
    // 3. Deduplication - query not injected twice if retried
    // 4. Cleanup - pending queries are cleaned up on error
    // 5. Both LaunchSession and ContinueSession flows
    // 6. Query injection works with empty/whitespace queries
}

func TestQueryInjectionRaceCondition(t *testing.T) {
    // Test that query injection is thread-safe
    // Multiple sessions starting concurrently
    // Verify each gets correct query injected
}
```

**File**: Create `hld/session/summary_test.go`

```go
func TestCalculateSummary(t *testing.T) {
    tests := []struct {
        name     string
        query    string
        expected string
    }{
        {"short query", "Hello world", "Hello world"},
        {"exact 50 chars", strings.Repeat("a", 50), strings.Repeat("a", 50)},
        {"long query", strings.Repeat("a", 100), strings.Repeat("a", 47) + "..."},
        {"multiline query", "Line 1\nLine 2\nLine 3", "Line 1 Line 2 Line 3"},
        {"tabs and spaces", "Hello\t\tworld\n\ntest", "Hello  world  test"},
        {"empty query", "", ""},
        {"whitespace only", "   \n\t  ", ""},
    }
    // Test each case
}
```

**File**: Update existing integration tests

- `hld/session/manager_test.go` - Add checks for injected query events
- `hld/store/sqlite_test.go` - Test summary column storage/retrieval
- Ensure conversation event queries account for the injected user message

### 9. Migration for Existing Data

Since there's no formal migration system, handle this manually:

**For existing installations**:

```sql
-- Run this SQL to add summary column and populate existing data
ALTER TABLE sessions ADD COLUMN summary TEXT;

UPDATE sessions
SET summary =
    CASE
        WHEN LENGTH(REPLACE(REPLACE(REPLACE(query, char(10), ' '), char(13), ' '), char(9), ' ')) <= 50
        THEN REPLACE(REPLACE(REPLACE(query, char(10), ' '), char(13), ' '), char(9), ' ')
        ELSE SUBSTR(REPLACE(REPLACE(REPLACE(query, char(10), ' '), char(13), ' '), char(9), ' '), 1, 47) || '...'
    END
WHERE summary IS NULL;
```

**Note**: Document this in release notes for users upgrading

## Verification Steps

1. **Search for all uses of Query field**:

   - `rg "\.Query" --type go --type ts --type tsx --type rust`
   - Ensure we haven't broken any existing functionality

2. **Test conversation view**:

   - Launch a new session and verify query appears as first event
   - Continue a session and verify new query appears as first event
   - Ensure no duplicate query events
   - Verify queries are injected only after Claude session ID is available

3. **Test UI components**:

   - Verify session lists show summaries (not truncated queries)
   - Verify full query is visible in conversation view
   - Test both WebUI and TUI

4. **Database integrity**:

   - Check that summary column is added
   - Verify new sessions have both query and summary populated
   - Test with various query lengths and special characters

5. **Edge cases**:
   - Test with empty queries
   - Test with very long queries (>1000 chars)
   - Test rapid session creation
   - Test session continuation with different queries

## Implementation Notes

### Critical Changes from Original Plan:

1. **Query injection timing**: Wait for Claude session ID instead of injecting immediately
2. **Sequence numbering**: Use `sequence=1` not `0` (matches existing pattern)
3. **Deduplication**: Check for existing user messages before injecting
4. **Thread safety**: Use sync.Map for pending queries to handle concurrent sessions
5. **Cleanup**: Remove pending queries on session completion/error

### Key Insights from Research:

- Each resumed session gets a NEW Claude session ID
- Sequence numbers are scoped to Claude session ID, not HumanLayer session ID
- The database uses `CREATE TABLE IF NOT EXISTS` pattern (no formal migrations)
- Transaction-based sequence assignment prevents race conditions
- Current UI truncates at different lengths (50 chars WebUI, 39 chars TUI)

## Future Enhancements

- Add intelligent summary generation using Claude
- Support custom summary formats per use case
- Add query categorization for better organization
- Consider storing query metadata (length, complexity, etc.)

## Rollback Plan

If issues arise:

1. The Query field remains unchanged (backward compatible)
2. Remove query injection logic without affecting existing events
3. Hide Summary field in UIs (CSS/template change only)
4. Database column is nullable (no data integrity issues)

## Timeline

1. Database and backend changes: 3-4 hours (includes testing race conditions)
2. Frontend type updates: 1 hour
3. UI updates: 1 hour
4. Testing: 3-4 hours (comprehensive edge case testing)
5. Total: ~10 hours of implementation

## Success Criteria

- [ ] Queries from both new and continued sessions appear in conversation view
- [ ] No duplicate query events are created
- [ ] Summary field displays correctly in all UIs
- [ ] No race conditions with Claude session ID capture
- [ ] All existing functionality remains intact
- [ ] Performance impact is negligible (<50ms added to session start)
