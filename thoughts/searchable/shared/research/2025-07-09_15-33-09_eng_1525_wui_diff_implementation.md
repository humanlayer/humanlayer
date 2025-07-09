---
date: 2025-07-09 15:32:05 PDT
researcher: allison
git_commit: 65080b2e1dae9040e9476bce49a3022b04337d6c
branch: main
repository: humanlayer
topic: "ENG-1525 WUI Rich Diff Implementation with Current Codebase State"
tags: [research, codebase, wui, diff-views, file-snapshots, react, frontend]
status: complete
last_updated: 2025-07-09
last_updated_by: allison
---

# Research: ENG-1525 WUI Rich Diff Implementation with Current Codebase State

**Date**: 2025-07-09 15:32:05 PDT
**Researcher**: allison
**Git Commit**: 65080b2e1dae9040e9476bce49a3022b04337d6c
**Branch**: main
**Repository**: humanlayer

## Research Question
What is needed to implement ENG-1525 (rich diff views in WUI) given that ENG-1520 (file snapshot system) and ENG-1523 (JSON-RPC endpoint) have been completed and merged?

## Summary
The backend infrastructure for file snapshots is fully implemented and working. The WUI has a custom diff viewer that already supports displaying full file context with line numbers, but it's not yet connected to the snapshot API. The main implementation work involves fetching snapshots from the backend, caching them appropriately, and passing the file content to the existing CustomDiffViewer component.

## Detailed Findings

### Backend Implementation (Complete)

#### File Snapshot System (ENG-1520)
- Database table `file_snapshots` exists with proper schema (`hld/store/sqlite.go:398-432`)
- Snapshot capture logic implemented in `captureFileSnapshot` (`hld/session/manager.go:717-808`)
- Intelligently handles full vs partial reads:
  - Full reads: Uses tool result content directly
  - Partial reads: Reads full file from filesystem (10MB limit)
- Asynchronous processing to avoid blocking stream events
- Proper path handling for both absolute and relative paths

#### JSON-RPC Endpoint (ENG-1523)
- Endpoint `getSessionSnapshots` implemented (`hld/rpc/handlers.go:242-286`)
- Request: `GetSessionSnapshotsRequest { session_id: string }`
- Response: `GetSessionSnapshotsResponse { snapshots: FileSnapshotInfo[] }`
- FileSnapshotInfo includes: `tool_id`, `file_path`, `content`, `created_at`
- Returns all snapshots for a session, ordered by creation time (newest first)

### Frontend Current State

#### CustomDiffViewer Component
- **NOT using react-diff-viewer-continued** - custom implementation (`humanlayer-wui/src/components/internal/SessionDetail/components/CustomDiffViewer.tsx`)
- Already supports showing full file context with line numbers
- Implements LCS-based diff algorithm for line and word diffs
- Supports unified and split view modes
- Has `fileContents` prop that enables context display

#### Event Rendering Logic
- Edit/Write/MultiEdit tools rendered in `eventToDisplayObject.tsx:243-314`
- Currently shows diffs without file context
- Tool inputs parsed from `tool_input_json` field
- Approval status affects styling

#### Syntax Highlighting
- `@wooorm/starry-night` v3.8.0 already installed
- Currently only JSON and Markdown grammars loaded
- Custom terminal theme CSS exists (`starry-night-terminal.css`)

### Implementation Requirements

#### 1. Add RPC Client Method
- Add `getSessionSnapshots` to daemon client (`humanlayer-wui/src/lib/daemon/client.ts`)
- TypeScript types matching the RPC response structure

#### 2. Fetch and Cache Snapshots
- Fetch snapshots when loading session (in SessionDetail component)
- Store in zustand AppStore or local component state
- Key snapshots by file path for efficient lookup

#### 3. Update Event Rendering
- In `eventToDisplayObject.tsx`, when rendering Edit/MultiEdit:
  - Look up snapshot by file path
  - Pass `fileContents` prop to CustomDiffViewer
  - Handle missing snapshots gracefully (fallback to current behavior)

#### 4. Enhance Syntax Highlighting
- Load additional starry-night grammars for common languages
- Apply syntax highlighting to diff content

#### 5. Performance Optimizations
- Cache snapshots in memory during session
- Consider prefetching for visible tool calls
- Handle large files appropriately

## Code References
- `hld/store/sqlite.go:398-432` - File snapshots database schema
- `hld/session/manager.go:717-808` - Snapshot capture logic
- `hld/rpc/handlers.go:242-286` - RPC endpoint implementation
- `humanlayer-wui/src/components/internal/SessionDetail/components/CustomDiffViewer.tsx` - Diff viewer component
- `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:243-314` - Tool rendering logic
- `humanlayer-wui/src/lib/daemon/client.ts` - Daemon client (needs update)
- `humanlayer-wui/src/AppStore.ts` - State management (for caching)

## Architecture Insights
- The system was designed with pragmatic trade-offs prioritizing simplicity
- CustomDiffViewer already has the capabilities needed - just needs data
- Snapshot system handles edge cases like partial reads and large files
- Path matching uses exact paths from tool calls (no normalization)

## Historical Context (from thoughts/)
- 10MB file size limit chosen as reasonable constraint (`thoughts/allison/tickets/eng_1520.md`)
- Snapshot capture at Read time leverages Claude's required workflow
- System designed for extensibility (hash deduplication, path normalization deferred)
- Team values performance optimizations from industry leaders (VS Code diff research)

## Implementation Steps

1. **Update Daemon Client**
   ```typescript
   async getSessionSnapshots(sessionId: string): Promise<GetSessionSnapshotsResponse>
   ```

2. **Fetch Snapshots in SessionDetail**
   ```typescript
   useEffect(() => {
     if (sessionId) {
       fetchSessionSnapshots(sessionId);
     }
   }, [sessionId]);
   ```

3. **Update eventToDisplayObject.tsx**
   ```typescript
   // For Edit tool
   const snapshot = snapshots.find(s => s.file_path === input.file_path);
   return {
     ...
     fileContents: snapshot?.content,
   };
   ```

4. **Load More Syntax Grammars**
   ```typescript
   // Add common languages: typescript, javascript, python, go, etc.
   await starryNight.register([...grammars]);
   ```

## Edge Cases to Handle
- Missing snapshots (file not read before edit)
- Multiple snapshots for same file (use most recent before edit)
- Large file content (consider truncation in UI)
- Path mismatches (CD commands changing working directory)

## Open Questions
1. Should we show snapshot timestamp/freshness indicator in UI?
2. How to handle binary files that might have been snapshotted?
3. Should we implement prefetching for better performance?

## Related Research
- `thoughts/shared/research/2025-07-03_09-43-22_wui_diff_view_tickets.md` - Original design research
- `thoughts/shared/research/2025-07-09_10-18-12_diff_viewer_implementation.md` - VS Code diff viewer analysis