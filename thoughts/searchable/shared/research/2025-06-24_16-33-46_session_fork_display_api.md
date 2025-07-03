---
date: 2025-06-24 16:10:00 PDT
researcher: allison
git_commit: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
branch: main
repository: humanlayer
topic: "Session Fork Display and API Options"
tags: [research, codebase, sessions, api]
status: complete
last_updated: 2025-06-24
last_updated_by: allison
---

# Research: Session Fork Display and API Options

**Date**: 2025-06-24 16:10:00 PDT
**Researcher**: allison
**Git Commit**: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
**Branch**: main
**Repository**: humanlayer
## Research Question

How should we handle session display when there are multiple sessions with parent-child relationships? What are the API options for hiding intermediate sessions in linear chains and only showing fork points? How should the frontend handle session state updates when sessions are resumed?

## Summary

The backend already has full infrastructure for session trees via parent-child relationships, but lacks fork detection and tree-aware API responses. The current `listSessions` endpoint returns all sessions as a flat list, requiring frontend logic to build tree structures. Three main API approaches are viable: backend tree calculation, frontend tree building, or a new specialized endpoint.

## Detailed Findings

### Current Session Data Model

- Sessions have a `parent_session_id` field that establishes parent-child relationships (`hld/store/store.go:48`)
- Each session generates new IDs even when continuing: `session_id`, `run_id`, and `claude_session_id` (`hld/session/manager.go:738-739`)
- No bidirectional tracking - children know parents, but parents don't track children
- Database stores only one-way parent reference, no child arrays (`hld/store/sqlite.go:68`)

### API Endpoints and Current Behavior

- **listSessions** (`hld/rpc/handlers.go:112-128`): Returns ALL sessions ordered by `last_activity_at DESC`
- **getConversation** (`hld/rpc/handlers.go:130-183`): Properly walks parent chain to reconstruct full history
- **continueSession** (`hld/rpc/handlers.go:237-286`): Creates new child session with parent reference
- **No fork detection or tree calculation** exists in the API layer

### Missing Fork Detection Logic

- No algorithms to identify when a parent has multiple children (`hld/session/` - searched but not found)
- No tree traversal utilities or recursive queries
- No methods to find leaf sessions or most recent children
- No "newest per branch" calculation

### UI Implementation Status

- **SessionTable** (`humanlayer-wui/src/components/internal/SessionTable.tsx`): Displays flat list
- **SessionDetail** (`humanlayer-wui/src/components/internal/SessionDetail.tsx:920-925`): Has parent navigation via "P" key
- Shows `[continued]` indicator for child sessions (`SessionDetail.tsx:932`)
- "Double escape" pattern exists for navigation but not for fork creation (`SessionDetail.tsx:895-903`)

## Code References

- `hld/store/store.go:48` - ParentSessionID field definition
- `hld/session/manager.go:738-743` - New ID generation for continued sessions
- `hld/rpc/handlers.go:112-128` - listSessions endpoint implementation
- `hld/store/sqlite.go:403-472` - Database query returning all sessions
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:835-857` - Continue session UI

## Architecture Insights

1. **Linear Parent Chain Design**: Each session has at most one parent (not a DAG)
2. **ID Generation Pattern**: Every continue operation creates new session_id and run_id
3. **Claude Resume Integration**: Parent's claude_session_id used for `--resume` flag
4. **One-way Relationships**: Database optimization assumes traversing child-to-parent only
5. **Event-driven Updates**: Real-time session status changes via subscriptions

## Historical Context (from thoughts/)

- `thoughts/shared/research/2025-06-24_12-29-39_session_fork_display.md` - Previous research confirming backend supports forking but UI lacks visualization
- `thoughts/allison/plans/inject-query-as-first-event.md` - Plan for query injection as first conversation event
- The system was designed for linear chains, fork support was added later without UI updates

## Related Research

- `thoughts/shared/research/2025-06-24_12-29-39_session_fork_display.md` - Earlier session fork display research
- `thoughts/shared/research/2025-01-24_14-48-00_inject-query-plan-review.md` - Query injection implementation

## API Options Analysis

### Option 1: Backend Tree Calculation (Modify listSessions)

**Implementation**:

```go
// In handlers.go listSessions
sessions := manager.ListSessions()
trees := buildSessionTrees(sessions)
leafSessions := extractLeafNodes(trees)
return leafSessions
```

**Pros**:

- Single source of truth for tree logic
- Reduces network payload
- Consistent behavior across all clients

**Cons**:

- Breaking change to existing API
- Loses ability to see all sessions
- Complex tree calculation on every request

### Option 2: New Tree-Aware Endpoint

**Implementation**:

```go
// New endpoint: getSessionTrees
type SessionTree struct {
    Session     SessionInfo
    Children    []SessionTree
    HasForks    bool
    IsLeaf      bool
}
```

**Pros**:

- Non-breaking addition
- Rich tree structure for UI
- Can include fork metadata

**Cons**:

- Duplicates some logic
- Requires frontend changes
- More complex API surface

### Option 3: Frontend Tree Building (Current Approach)

**Implementation**:

```typescript
// In useSessions hook
const buildTree = (sessions: SessionInfo[]): SessionTree => {
  const map = new Map(sessions.map(s => [s.session_id, s]))
  const roots = []
  const children = new Map<string, string[]>()

  sessions.forEach(s => {
    if (s.parent_session_id) {
      const siblings = children.get(s.parent_session_id) || []
      siblings.push(s.session_id)
      children.set(s.parent_session_id, siblings)
    } else {
      roots.push(s)
    }
  })

  // Only show leaves unless forked
  return filterToLeaves(roots, children)
}
```

**Pros**:

- No backend changes needed
- Full flexibility in UI
- Can experiment with different visualizations

**Cons**:

- Logic duplication across clients
- Larger network payloads
- Client-side performance cost

### Option 4: Virtual Session IDs (Pointer Concept)

**Implementation**:

```go
// Add to Session model
type Session struct {
    ID           string
    VirtualID    string  // Pointer that moves to newest child
    RealID       string  // Actual session ID
}
```

**Pros**:

- Transparent to frontend
- Sessions appear to update in place
- No fork display logic needed

**Cons**:

- Complex ID management
- Breaking change to data model
- Harder to debug issues

## Recommended Approach

**Short-term (Option 3)**: Implement frontend tree building

- Use existing flat API response
- Build tree structure in JavaScript
- Hide intermediate nodes unless forked
- Show only leaf nodes per branch

**Long-term (Option 2)**: Add specialized tree endpoint

- `/api/v1/sessionTrees` returns hierarchical data
- Include fork counts and branch metadata
- Deprecate flat list for UI use

**Implementation Priority**:

1. Frontend tree building logic
2. Fork detection algorithm
3. UI components for tree visualization
4. Backend tree endpoint (future)

## Open Questions

1. Should we add database indexes on `parent_session_id` for better query performance?
2. How deep should session trees go before UI truncation?
3. Should the API return session metrics (child count, depth) to help UI decisions?
4. How to handle the "double escape to fork" interaction with the new tree display?
