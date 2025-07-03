---
date: 2025-06-24 12:28:52 PDT
researcher: dex
git_commit: 69ae0ace6525c6265c9d5c2d85956f2a6e2d1bed
branch: test-branch-5
repository: humanlayer
topic: "Session Fork Display & Navigation Implementation"
tags: [research, codebase, sessions]
status: complete
last_updated: 2025-06-24
last_updated_by: dex
---

# Research: Session Fork Display & Navigation Implementation

**Date**: 2025-06-24 12:28:52 PDT
**Researcher**: dex
**Git Commit**: 69ae0ace6525c6265c9d5c2d85956f2a6e2d1bed
**Branch**: test-branch-5
**Repository**: humanlayer
## Research Question

How to implement sophisticated session fork display and navigation logic similar to Claude Code's interactive double escape, including:

- Displaying nested parent/child sessions intelligently
- Hiding intermediate sessions when there's only a single fork line
- Implementing "jump to previous message" functionality that creates forks
- Managing complex tree display when multiple forks exist

## Summary

The HumanLayer system **already has a sophisticated session forking architecture** implemented through "Continue Session" functionality, but lacks advanced UI for fork visualization and navigation. The existing infrastructure provides all necessary backend capabilities - the challenge is purely frontend display logic and UX design.

## Current Architecture Strengths

### Robust Backend Foundation

- **Complete session tree support**: `parent_session_id` relationships with full database persistence
- **Conversation reconstruction**: `GetSessionConversation()` rebuilds complete history across parent chains
- **Session continuation API**: `ContinueSession()` creates child sessions with inheritance
- **Claude Code integration**: Native `--resume` support with session ID persistence

### Existing UI Components

- **Session navigation**: Keyboard shortcuts (j/k/P) for session and parent navigation
- **Real-time updates**: Event subscription system for live session changes
- **Command palette**: Global session search and navigation (Cmd+K)
- **Parent indication**: Visual "[continued]" labels for child sessions

## Detailed Implementation Plan

### 1. Session Tree Data Structure Enhancement

**File**: `humanlayer-wui/src/hooks/useSessions.ts`

Add session tree computation hook:

```typescript
export function useSessionTrees() {
  const { sessions } = useSessions()

  return useMemo(() => {
    const trees = buildSessionTrees(sessions)
    return trees.map(tree => ({
      ...tree,
      displayNode: computeDisplayNode(tree),
      shouldHideIntermediates: shouldCollapseLinearChain(tree),
    }))
  }, [sessions])
}

function buildSessionTrees(sessions: SessionInfo[]): SessionTree[] {
  // Build parent-child relationships
  // Identify root sessions (no parent)
  // Create tree structures with depth tracking
}

function computeDisplayNode(tree: SessionTree): SessionInfo {
  // If single linear chain, return newest child
  // If multiple forks, return newest in each branch
  // Handle complex multi-level trees
}
```

### 2. Fork Detection and Display Logic

**File**: `humanlayer-wui/src/components/internal/SessionTable.tsx`

Replace flat session list with tree-aware display:

```typescript
function SessionTreeTable({ trees }: { trees: SessionTree[] }) {
  const displaySessions = useMemo(() => {
    return trees.flatMap(tree => {
      if (tree.shouldHideIntermediates) {
        // Single linear chain - show only newest child
        return [tree.displayNode];
      } else {
        // Multiple forks - show newest from each branch
        return tree.branches.map(branch => branch.newest);
      }
    });
  }, [trees]);

  return (
    <Table>
      {displaySessions.map(session => (
        <SessionRow
          key={session.id}
          session={session}
          treeContext={getTreeContext(session)}
        />
      ))}
    </Table>
  );
}
```

### 3. Message-Level Navigation & Fork Creation

**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`

Implement message selection and fork creation:

```typescript
function ConversationContent({ events }: { events: ConversationEvent[] }) {
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);

  const handleMessageClick = useCallback((index: number, event: ConversationEvent) => {
    if (event.role === 'user') {
      // This is the "jump back to user message" functionality
      setSelectedMessageIndex(index);
      showForkPrompt(event);
    }
  }, []);

  const handleCreateFork = useCallback(async (fromMessage: ConversationEvent, newQuery: string) => {
    // Create new session from parent point
    const parentSessionId = findParentAtMessage(fromMessage);
    const childSession = await continueSession({
      parent_session_id: parentSessionId,
      query: newQuery,
      // Inherit config from original session
    });

    // Navigate to new session with query as "in-progress"
    navigate(`/sessions/${childSession.id}?draft=${encodeURIComponent(newQuery)}`);
  }, []);

  return (
    <div className="conversation-events">
      {events.map((event, index) => (
        <ConversationEvent
          key={`${event.sequence}`}
          event={event}
          isSelectable={event.role === 'user'}
          isSelected={selectedMessageIndex === index}
          onClick={() => handleMessageClick(index, event)}
        />
      ))}
      {selectedMessageIndex !== null && (
        <ForkPromptModal
          originalMessage={events[selectedMessageIndex]}
          onCreateFork={handleCreateFork}
          onCancel={() => setSelectedMessageIndex(null)}
        />
      )}
    </div>
  );
}
```

### 4. Multi-Fork Display Management

**File**: `humanlayer-wui/src/components/internal/SessionTreeView.tsx`

New component for complex fork visualization:

```typescript
function SessionTreeView({ tree }: { tree: SessionTree }) {
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());

  if (tree.branches.length <= 1) {
    // Single linear chain - use existing SessionDetail
    return <SessionDetail sessionId={tree.displayNode.id} />;
  }

  return (
    <div className="session-tree-view">
      {tree.branches.map(branch => (
        <div key={branch.id} className="branch-container">
          <BranchHeader
            branch={branch}
            isExpanded={expandedBranches.has(branch.id)}
            onToggle={() => toggleBranchExpansion(branch.id)}
          />
          {expandedBranches.has(branch.id) && (
            <SessionDetail sessionId={branch.newest.id} />
          )}
        </div>
      ))}
    </div>
  );
}
```

### 5. URL and Navigation State Management

**File**: `humanlayer-wui/src/router.tsx`

Enhanced routing for fork navigation:

```typescript
const router = createBrowserRouter([
  {
    path: "/",
    element: <SessionTablePage />,
  },
  {
    path: "/sessions/:sessionId",
    element: <SessionDetailPage />,
  },
  {
    path: "/trees/:rootSessionId", // New route for tree view
    element: <SessionTreePage />,
  },
]);
```

**File**: `humanlayer-wui/src/pages/SessionDetailPage.tsx`

Handle draft query parameter:

```typescript
function SessionDetailPage() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const draftQuery = searchParams.get('draft');

  return (
    <SessionDetail
      sessionId={sessionId}
      initialDraft={draftQuery}
    />
  );
}
```

## Code References

Key files requiring modification:

### Backend (Already Complete)

- `hld/session/manager.go:643-844` - ContinueSession implementation
- `hld/store/sqlite.go:68` - Parent relationship database schema
- `hld/rpc/handlers.go:237-286` - Continue session API endpoint

### Frontend (Needs Implementation)

- `humanlayer-wui/src/hooks/useSessions.ts:15-83` - Add tree computation
- `humanlayer-wui/src/components/internal/SessionTable.tsx:1-142` - Tree-aware display
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:356-519` - Message selection
- `humanlayer-wui/src/router.tsx:6-21` - Enhanced routing

### New Components Needed

- `SessionTreeView.tsx` - Multi-fork visualization
- `ForkPromptModal.tsx` - Message-to-fork conversion
- `BranchHeader.tsx` - Branch expansion/collapse

## Architecture Insights

### Design Patterns Found

1. **Event-Driven Architecture**: Real-time session updates via event subscriptions
2. **Command Pattern**: Session actions (launch, continue, interrupt) as discrete operations
3. **Tree Traversal**: Conversation reconstruction walks parent chains recursively
4. **Inheritance Pattern**: Child sessions inherit configuration from parents

### Key Technical Decisions

1. **Linear Parent Chain**: Each session has max one parent (not DAG)
2. **Separate Conversations**: Each session maintains independent conversation history
3. **Configuration Inheritance**: Working directory, model, MCP config copied to children
4. **UUID-Based IDs**: Session identity managed with UUIDs for uniqueness

## Historical Context (from thoughts/)

### Known Issues to Address

- **Permission Inheritance Bug** (`thoughts/shared/research/2025-06-24_11-18-51_resumed_sessions_permissions.md`): Child sessions don't inherit approval permissions
- **MCP Config Loss** (`thoughts/dex/mcp-diagnosis.md`): Continue session doesn't copy MCP configuration
- **Tool Call Correlation** (`thoughts/allison/old_stuff/TODO.md`): Batched calls break approval correlation

### Previous Design Decisions

- **API-First Architecture** (`thoughts/allison/daemon_api/docs/design-rationale.md`): REST API chosen for type safety and industry standards
- **Approval-Centric UX** (`thoughts/allison/old_stuff/tui_new.md`): HumanLayer is "approval company" - approvals remain primary interface

## Implementation Priority

### Phase 1: Basic Tree Display

1. Implement `useSessionTrees()` hook
2. Add tree-aware session table display
3. Hide intermediate sessions in linear chains

### Phase 2: Message-Level Navigation

1. Add message selection in conversation view
2. Implement fork creation from user messages
3. Handle draft query state in URLs

### Phase 3: Multi-Fork Management

1. Build `SessionTreeView` component
2. Add branch expansion/collapse
3. Implement complex tree navigation

### Phase 4: Performance & Polish

1. Optimize tree computation for large session counts
2. Add keyboard shortcuts for fork navigation
3. Implement session tree search/filtering

## Open Questions

1. **Tree Depth Limits**: How deep should session trees display before truncation?
2. **Branch Naming**: How to distinguish between multiple child sessions?
3. **Memory Management**: How to handle large conversation trees efficiently?
4. **Mobile UX**: How to adapt tree visualization for mobile interfaces?

## Related Research

- `thoughts/shared/research/2025-06-24_11-18-51_resumed_sessions_permissions.md` - Permission inheritance issues
- `thoughts/shared/research/2025-06-24_10-42-32_wui_color_schemes_gruvbox.md` - UI theming system
- `thoughts/allison/daemon_api/docs/design-rationale.md` - System architecture principles
