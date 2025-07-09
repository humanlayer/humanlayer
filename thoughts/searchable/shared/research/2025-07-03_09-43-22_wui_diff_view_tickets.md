---
date: 2025-07-03 09:40:52 PDT
researcher: allison
git_commit: 2a35add3de1b410be5bb6e52f565a64c1c222d31
branch: main
repository: humanlayer
topic: "WUI Diff View Improvement Tickets"
tags: [research, codebase, wui, diff-views, file-content, daemon, snapshots, read-tool]
status: complete
last_updated: 2025-07-03
last_updated_by: allison
last_updated_note: "Simplified to single API endpoint and clarified why snapshots are the simplest working solution"
---

# Research: WUI Diff View Improvement Tickets

**Date**: 2025-07-03 09:40:52 PDT
**Researcher**: allison
**Git Commit**: 2a35add3de1b410be5bb6e52f565a64c1c222d31
**Branch**: main
**Repository**: humanlayer

## Research Question
How to improve diff views in the WUI (humanlayer-wui) by implementing proper file content retrieval and display, creating tickets for the required changes while considering both MVP and future extensibility needs.

## Summary
The WUI currently shows only isolated find/replace strings for Edit tool calls without surrounding file context. After analyzing multiple approaches, the recommended solution is to capture file snapshots during Read operations (regardless of offset/limit parameters) and provide these via a simple API to the frontend. This approach avoids the complexity of stitching partial reads together while keeping conversation events unmodified.

## Detailed Findings

### Current State Analysis

#### WUI Limitations
- Only shows exact find/replace strings without context (`humanlayer-wui/src/components/internal/SessionDetail.tsx:278-280`)
- Line numbers hidden due to lack of context
- No syntax highlighting for diffs
- Uses `react-diff-viewer-continued` but can't leverage it fully

#### Daemon Capabilities
- Stores tool calls with raw JSON input parameters (`hld/store/sqlite.go`)
- Tool results already stored in `tool_result_content` field
- Has access to session working directory
- SQLite database can handle large text content (up to 1GB)

#### Critical Discovery: Read Tool Limitations
The Read tool supports offset/limit parameters:
- Example: `offset=3, limit=3` returns only 3 lines starting from line 3
- Tool result structure includes: `numLines`, `startLine`, `totalLines`
- Cannot reliably use partial Read results for full diffs
- Claude often reads the same file multiple times with different offsets:
  - Read lines 1-50 (function signatures)
  - Read lines 100-150 (implementation)
  - Read lines 200-220 (tests)
  - Then edits line 125
- Stitching partial reads together is complex and error-prone

### Evolution of Solution Approach

#### Initial Approach (Rejected)
Tried to use existing Read tool results to construct diffs, but this fails because:
- Read operations may be partial (offset/limit)
- Files may change between Read and Edit
- No guarantee full content was ever read

#### Second Approach (Rejected)
Considered capturing snapshots at Edit/Write time, but this has downsides:
- Adds latency to edit operations
- Requires synchronous file reads during tool processing
- More complex error handling

#### Final Approach (Recommended)
Capture full file snapshots during Read operations:
- For full reads (totalLines == numLines): Use tool result directly
- For partial reads (offset/limit): Read full file from filesystem
- Process on tool result (not call) to ensure file exists
- Store Read metadata (numLines, startLine, totalLines) with snapshot
- Snapshots ready before edits occur ("primed")
- Separate API keeps conversation events clean
- Frontend matches snapshots by file path

### Architecture Insights

#### Why Read-triggered Snapshots Work Better
1. **Natural workflow**: Claude always reads before editing (per CLAUDE.md requirement)
2. **Pre-loaded data**: Content ready when edit UI needs it
3. **Clean separation**: Snapshots separate from conversation events
4. **Offset/limit solved**: Always store full content regardless of Read parameters
5. **Efficiency**: Use existing tool results when possible (no redundant file reads)
6. **Reliability**: Only snapshot files that Claude successfully accessed

#### API Design Considerations
- Conversation events remain unchanged (backward compatible)
- New snapshot API provides file content on demand
- Frontend can request snapshots by file path or tool_id
- Enables future caching strategies

## Code References
- `hld/store/sqlite.go:110-145` - Database schema for conversation events
- `hld/session/manager.go:641-656` - Tool result storage logic
- `hld/rpc/handlers.go:185-238` - GetConversation endpoint
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:258-321` - Current diff display
- `/tmp/claude_tool_output.json` - Sample tool formats showing Read structure

## Proposed Tickets

### Ticket 1: Implement File Snapshot System for Read Operations
**Status**: spec needed
**Priority**: High
**Scope**: Backend daemon (hld)

**Problem**: Need full file content for diffs, but Read tool may return partial content.

**Solution**: Create snapshot system that captures full file content during Read operations, intelligently using tool results when possible.

**Implementation**:
1. Add new `file_snapshots` table:
   ```sql
   CREATE TABLE file_snapshots (
     id TEXT PRIMARY KEY,
     tool_id TEXT NOT NULL,
     session_id TEXT NOT NULL,
     file_path TEXT NOT NULL,
     content TEXT NOT NULL,
     file_hash TEXT NOT NULL,
     file_size INTEGER NOT NULL,
     -- Metadata from Read tool
     num_lines INTEGER NOT NULL,
     start_line INTEGER NOT NULL,
     total_lines INTEGER NOT NULL,
     created_at TIMESTAMP NOT NULL,
     FOREIGN KEY (tool_id) REFERENCES conversation_events(tool_id)
   );
   CREATE INDEX idx_snapshots_session_path ON file_snapshots(session_id, file_path);
   CREATE INDEX idx_snapshots_tool ON file_snapshots(tool_id);
   ```

2. In `processStreamEvent` for Read tool **results** (not calls):
   - Parse tool result to extract file metadata
   - Check if `totalLines == numLines` (full file read):
     - If true: Use content from tool result directly
     - If false: Read full file from filesystem
   - Store snapshot with metadata linked to Read tool_id
   - Only process successful reads (ensures file exists)
   - Dedup by file_hash to save space

**Key Decisions**:
- Process on tool result, not tool call (ensures successful reads only)
- Use tool result when possible (avoid redundant file reads)
- Store Read metadata for future reference
- Only snapshot files that Claude successfully read

**Acceptance Criteria**:
- Snapshots created for all successful Read operations
- Full file stored (from result or filesystem)
- Metadata preserved from Read tool
- Performance: <50ms for full reads, <100ms for partial reads

### Ticket 2: Add File Snapshot Retrieval API
**Status**: spec needed
**Priority**: High
**Scope**: Backend daemon (hld)

**Problem**: Frontend needs access to file snapshots for diff display.

**Solution**: Create simple JSON-RPC endpoint for snapshot retrieval.

**Implementation**:
```go
// Single endpoint that returns all snapshots for a session
type GetSessionSnapshotsRequest struct {
    SessionID string `json:"session_id"`
}

type GetSessionSnapshotsResponse struct {
    Snapshots []FileSnapshot `json:"snapshots"`
}

type FileSnapshot struct {
    ToolID    string    `json:"tool_id"`
    FilePath  string    `json:"file_path"`
    Content   string    `json:"content"`
    FileHash  string    `json:"file_hash"`
    Timestamp time.Time `json:"timestamp"`
    // Read metadata
    NumLines   int `json:"num_lines"`
    StartLine  int `json:"start_line"`
    TotalLines int `json:"total_lines"`
}
```

**Key Decisions**:
- Single endpoint keeps it simple
- Return all snapshots for the session
- Frontend can filter/cache as needed
- Include Read metadata for context

**Acceptance Criteria**:
- Returns all snapshots for a session
- Ordered by timestamp (most recent first)
- Clear API documentation
- Performance: <100ms for typical session

### Ticket 3: Implement Enhanced Diff Views Using Snapshots
**Status**: spec needed
**Priority**: High
**Scope**: Frontend (humanlayer-wui)

**Problem**: Current UI can't display proper diffs without full file context.

**Solution**: Use snapshot API to show rich diffs for all file operations.

**Implementation**:
1. When rendering Edit/Write/MultiEdit tools:
   - Extract file path from tool input
   - Fetch latest snapshot for that file
   - For Edit: Apply changes to snapshot, show diff
   - For Write: Show full new content with syntax highlighting
   - For MultiEdit: Apply all edits, show unified diff

2. UI enhancements:
   - Use existing `react-diff-viewer-continued` with full context
   - Enable line numbers (now accurate)
   - Add syntax highlighting via starry-night
   - Show snapshot timestamp/freshness indicator

3. Caching strategy:
   - Cache snapshots in memory during session
   - Invalidate on new Read of same file
   - Prefetch for visible tool calls

**Edge Cases**:
- Missing snapshots: Show current behavior (find/replace only)
- Multiple snapshots per file: Use most recent before the edit
- Large files: Consider pagination or truncation in UI

**Acceptance Criteria**:
- Accurate diffs for all file operations
- Graceful handling of missing snapshots
- Performance: <200ms to display diff
- Clear indication of snapshot age/freshness

## Implementation Strategy

### Why This Approach Works

1. **Leverages existing patterns**: Read operations already trigger file access
2. **Solves offset/limit**: Always captures full content
3. **Clean architecture**: Snapshots separate from events
4. **Performance**: Data ready when needed
5. **Backwards compatible**: Old sessions still work

### Key Design Decisions

1. **Trigger on Read**: Natural point to capture state
2. **Separate API**: Keeps concerns isolated
3. **Store full content**: Solves partial read problem
4. **Index by path**: Enables efficient lookups

### Migration Path

1. **Phase 1**: Implement snapshot storage (Ticket 1)
   - Start capturing snapshots
   - No UI changes yet
   - Validate approach

2. **Phase 2**: Add retrieval API (Ticket 2)
   - Enable frontend access
   - Test performance

3. **Phase 3**: Update UI (Ticket 3)
   - Roll out enhanced diffs
   - Monitor user feedback

## Why This Is The Simplest Approach That Works

### Alternatives Considered

1. **Just use Read results directly**: 
   - ❌ Fails due to multiple partial reads of same file
   - ❌ Complex stitching logic needed

2. **Re-snapshot after edits**:
   - ❌ Over-engineering for MVP
   - ❌ Can't handle manual edits between tool calls
   - ❌ If find/replace succeeds, we know versions match anyway

3. **Complex staleness tracking**:
   - ❌ Adds complexity without clear benefit
   - ❌ Frontend can show timestamp if needed

### Why Snapshots Work

- **Handles partial reads**: Always captures full file
- **Simple logic**: One snapshot per Read, no stitching
- **Predictable**: Frontend knows what data is available
- **Incremental**: Can enhance later if needed

## Open Questions for Spec Phase

1. **Storage limits**: Max file size to snapshot?
2. **Binary files**: Auto-detect and skip?
3. **Performance**: Async snapshot capture for large files?

## Conclusion

After exploring multiple approaches, the snapshot system emerges as the simplest solution that actually handles the realities of how Claude reads files. By capturing full file content during Read operations (even partial ones) and exposing them through a single, simple API endpoint, we avoid the complexity of stitching partial reads while delivering accurate diff views. This approach is pragmatic, implementable, and provides immediate value to users reviewing AI-generated code changes.