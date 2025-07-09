# File Snapshot System Implementation Plan

## Overview

Implement a file snapshot system that captures full file content during Read tool operations, storing them in SQLite. This creates the foundation for the WUI to display accurate diffs with full context in future tickets.

## Current State Analysis

The WUI currently shows only isolated find/replace strings without surrounding context because the Read tool often returns partial file content (with offset/limit parameters). We need to capture full file snapshots to enable proper diff display.

### Key Discoveries:
- Read tool results are stored as JSON in `tool_result_content` field (`hld/session/manager.go:649`)
- Read tool can return partial content when offset/limit are used
- File paths in Read tool are relative to session working directory (`hld/session/manager.go:84-92`)
- Database uses migration pattern with current version at 6 (`hld/store/sqlite.go:352`)
- Async processing already used for background tasks (`hld/session/manager.go:168`)

## What We're NOT Doing

- No metrics/observability (no OTel integration)
- No complex deduplication by hash across sessions
- No API endpoint (handled in ENG-1523)
- No binary file detection or special handling
- No snapshot updates after edits (snapshots are point-in-time)
- No correlation between snapshots and Edit operations

## Implementation Approach

Capture full file content during Read tool result processing. When Read returns full content (totalLines == numLines), use it directly. When Read returns partial content, asynchronously read the full file from the filesystem. Store snapshots in a new SQLite table with the relative file path exactly as provided in the tool call. The complex path matching problem (handling CD commands) will be addressed in a future ticket.

## Phase 1: Database Schema & Migration

### Overview
Add a new `file_snapshots` table to store full file content captured during Read operations.

### Changes Required:

#### 1. Database Migration
**File**: `hld/store/sqlite.go`
**Changes**: Add migration 7 after line 388

```go
// Migration 7: Add file_snapshots table for Read operation tracking
if currentVersion < 7 {
    slog.Info("Applying migration 7: Add file_snapshots table")
    
    _, err = s.db.Exec(`
        CREATE TABLE IF NOT EXISTS file_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            file_path TEXT NOT NULL, -- Relative path from tool call
            content TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_session_path 
            ON file_snapshots(session_id, file_path);
        CREATE INDEX IF NOT EXISTS idx_snapshots_tool 
            ON file_snapshots(tool_id);
    `)
    if err != nil {
        return fmt.Errorf("failed to create file_snapshots table: %w", err)
    }
    
    // Record migration
    _, err = s.db.Exec(`
        INSERT INTO schema_version (version, description)
        VALUES (7, 'Add file_snapshots table for Read operation tracking')
    `)
    if err != nil {
        return fmt.Errorf("failed to record migration 7: %w", err)
    }
    
    slog.Info("Migration 7 applied successfully")
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Migration applies cleanly: `cd hld && go test ./store -run TestMigrations`
- [ ] Database operations compile: `cd hld && go build ./...`

#### Manual Verification:
- [ ] New database has file_snapshots table
- [ ] Existing database upgrades successfully
- [ ] Indexes are created properly

---

## Phase 2: Add Store Methods for Snapshots

### Overview
Add methods to the store interface and SQLite implementation for creating and retrieving file snapshots.

### Changes Required:

#### 1. Store Interface
**File**: `hld/store/store.go`
**Changes**: Add new methods to Store interface after line 32

```go
// File snapshot operations
CreateFileSnapshot(ctx context.Context, snapshot *FileSnapshot) error
GetFileSnapshots(ctx context.Context, sessionID string) ([]FileSnapshot, error)
```

#### 2. FileSnapshot Type
**File**: `hld/store/store.go`
**Changes**: Add new type after ConversationEvent struct

```go
// FileSnapshot represents a snapshot of file content at Read time
type FileSnapshot struct {
    ID        int64
    ToolID    string
    SessionID string
    FilePath  string    // Relative path from tool call
    Content   string
    CreatedAt time.Time
}
```

#### 3. SQLite Implementation
**File**: `hld/store/sqlite.go`
**Changes**: Add methods at end of file

```go
// CreateFileSnapshot stores a new file snapshot
func (s *SQLiteStore) CreateFileSnapshot(ctx context.Context, snapshot *FileSnapshot) error {
    _, err := s.db.ExecContext(ctx, `
        INSERT INTO file_snapshots (
            tool_id, session_id, file_path, content
        ) VALUES (?, ?, ?, ?)
    `, snapshot.ToolID, snapshot.SessionID, snapshot.FilePath, snapshot.Content)
    return err
}

// GetFileSnapshots retrieves all snapshots for a session
func (s *SQLiteStore) GetFileSnapshots(ctx context.Context, sessionID string) ([]FileSnapshot, error) {
    rows, err := s.db.QueryContext(ctx, `
        SELECT id, tool_id, session_id, file_path, content, created_at
        FROM file_snapshots
        WHERE session_id = ?
        ORDER BY created_at DESC
    `, sessionID)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    
    var snapshots []FileSnapshot
    for rows.Next() {
        var s FileSnapshot
        if err := rows.Scan(&s.ID, &s.ToolID, &s.SessionID, &s.FilePath,
            &s.Content, &s.CreatedAt); err != nil {
            return nil, err
        }
        snapshots = append(snapshots, s)
    }
    return snapshots, rows.Err()
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Store interface compiles: `cd hld && go build ./store`
- [ ] Unit tests pass: `cd hld && go test ./store`

#### Manual Verification:
- [ ] Methods work correctly when called
- [ ] Error handling is robust

---

## Phase 3: Read Tool Result Processing

### Overview
Add logic to capture file snapshots when processing Read tool results, using tool result content directly when possible.

### Changes Required:

#### 1. Read Tool Result Type
**File**: `hld/session/types.go`
**Changes**: Add type for parsing Read tool results

```go
// ReadToolResult represents the JSON structure of a Read tool result
type ReadToolResult struct {
    Type string `json:"type"`
    File struct {
        FilePath   string `json:"filePath"`
        Content    string `json:"content"`
        NumLines   int    `json:"numLines"`
        StartLine  int    `json:"startLine"`
        TotalLines int    `json:"totalLines"`
    } `json:"file"`
}
```

#### 2. Snapshot Processing Logic
**File**: `hld/session/manager.go`  
**Changes**: Add after line 653 (after AddConversationEvent)

```go
// Asynchronously capture file snapshot for Read tool results
if toolCall, err := m.store.GetToolCallByID(ctx, content.ToolUseID); err == nil && toolCall != nil && toolCall.ToolName == "Read" {
    go m.captureFileSnapshot(ctx, sessionID, content.ToolUseID, toolCall.ToolInputJSON, content.Content)
}
```

#### 3. Snapshot Capture Method
**File**: `hld/session/manager.go`
**Changes**: Add new method after processStreamEvent

```go
// captureFileSnapshot captures full file content for Read tool results
func (m *Manager) captureFileSnapshot(ctx context.Context, sessionID, toolID, toolInputJSON, toolResultContent string) {
    // Parse tool input to get file path
    var input map[string]interface{}
    if err := json.Unmarshal([]byte(toolInputJSON), &input); err != nil {
        slog.Error("failed to parse Read tool input", "error", err)
        return
    }
    
    filePath, ok := input["file_path"].(string)
    if !ok {
        slog.Error("Read tool input missing file_path")
        return
    }
    
    // Parse tool result
    var result ReadToolResult
    if err := json.Unmarshal([]byte(toolResultContent), &result); err != nil {
        slog.Error("failed to parse Read tool result", "error", err)
        return
    }
    
    var content string
    
    // If we have full content from tool result, use it directly
    if result.File.NumLines == result.File.TotalLines {
        content = result.File.Content
        slog.Debug("using full content from Read tool result", "path", filePath)
    } else {
        // Need to read full file from filesystem
        // Get session to access working directory
        session, err := m.store.GetSession(ctx, sessionID)
        if err != nil {
            slog.Error("failed to get session for snapshot", "error", err)
            return
        }
        
        // Construct full path for reading (but still store relative path)
        fullPath := filepath.Join(session.WorkingDir, filePath)
        
        // Read file with size limit (10MB)
        const maxFileSize = 10 * 1024 * 1024
        fileInfo, err := os.Stat(fullPath)
        if err != nil {
            slog.Error("failed to stat file for snapshot", "path", fullPath, "error", err)
            return
        }
        
        if fileInfo.Size() > maxFileSize {
            slog.Warn("file too large for snapshot, using partial content", "path", fullPath, "size", fileInfo.Size())
            // Store partial content from tool result as fallback
            content = result.File.Content
        } else {
            fileBytes, err := os.ReadFile(fullPath)
            if err != nil {
                slog.Error("failed to read file for snapshot", "path", fullPath, "error", err)
                return
            }
            content = string(fileBytes)
            slog.Debug("read full file content from filesystem", "path", fullPath)
        }
    }
    
    // Store snapshot with relative path from tool call
    snapshot := &store.FileSnapshot{
        ToolID:    toolID,
        SessionID: sessionID,
        FilePath:  filePath,  // Store exactly as provided in tool call
        Content:   content,
    }
    
    if err := m.store.CreateFileSnapshot(ctx, snapshot); err != nil {
        slog.Error("failed to store file snapshot", "error", err)
    }
}
```

#### 4. Add Imports
**File**: `hld/session/manager.go`
**Changes**: Add to imports

```go
import (
    "os"
    "path/filepath"
    // ... existing imports
)
```

### Success Criteria:

#### Automated Verification:
- [ ] Code compiles: `cd hld && go build ./...`
- [ ] Unit tests pass: `cd hld && go test ./session`

#### Manual Verification:
- [ ] Snapshots created for Read operations
- [ ] Full content used when available in tool result
- [ ] File reading works for partial reads
- [ ] Large files handled gracefully

---

## Testing Strategy

### Unit Tests:
- Store methods for snapshot CRUD operations
- Read tool result parsing logic
- File path resolution with working directory

### Integration Tests:
- End-to-end snapshot capture during Read operations
- Large file handling
- Concurrent snapshot creation

### Manual Testing Steps:
1. Launch Claude Code session with hld running
2. Have Claude read several files (full and partial)
3. Verify snapshots created in database
4. Test with large files (>10MB) to verify fallback behavior

## Performance Considerations

- Async snapshot capture to avoid blocking stream processing
- 10MB file size limit to prevent memory issues
- Database indexes on session_id and file_path for fast lookups
- No deduplication in MVP (can add hash-based dedup later if needed)

## Known Limitations

- File paths are stored as-is from tool calls (relative paths)
- No handling of CD commands - if Claude changes directories, snapshots may not match Edit operations
- Path matching logic will be addressed in a follow-up ticket

## Migration Notes

- Migration is forward-only (no rollback)
- Existing sessions will have no snapshots (expected)
- New table doesn't affect existing functionality

## References

- Original ticket: `thoughts/allison/tickets/eng_1520.md`
- Related research: `thoughts/shared/research/2025-07-03_09-43-22_wui_diff_view_tickets.md`
- RPC endpoint plan: `thoughts/shared/plans/file_snapshot_rpc.md`
- Similar async pattern: `hld/session/manager.go:168`