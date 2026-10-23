# Conversation Stream Architecture

This directory contains the wired conversation stream components for riptide-ui.

## Component Hierarchy

```
Route ($sessionId.tsx)
├── queries event IDs for keyboard navigation & sidebar
├── uses useAgentGrouping for expansion logic
└── renders WiredConversationStream
    ├── queries root event IDs (memoized by length)
    └── renders WiredConversationEventRow or WiredAgentGroupEventRow per ID
        ├── event rows query their event, tool result, and approval via useLiveQuery
        ├── agent-group rows query their parent event via useLiveQuery
        ├── subscribes to focus/approval stores via zustand selectors
        └── wraps pure components from @humanlayer/ui
```

## Pure vs Wired Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ConversationEventRow` | `packages/ui` | Pure component, receives all props, used in Storybook |
| `WiredConversationEventRow` | `apps/riptide-ui` | Queries row data by ID; owns session actions and store reads |
| `AgentGroupEventRow` | `packages/ui` | Pure component for agent groups |
| `WiredAgentGroupEventRow` | `apps/riptide-ui` | Queries its parent event by ID, wraps pure component |
| `ConversationStream` | `packages/ui` | Pure component, used in Storybook |
| `WiredConversationStream` | `apps/riptide-ui` | Virtualizes events and composes wired rows, used in app |
| `ConversationStreamShellDemo` | `apps/riptide-ui` | Demo wrapper for Storybook with mock interactions |

## State Management

- **Focus state**: `useFocusStore` - rows subscribe via selector `(s) => s.focusedEventId === eventId`
- **Approval state**: `useApprovalStore` - tracks which approval is being approved/denied
- **Expansion state**: `useExpansionStore` - tracks which agent groups are expanded (used by wired rows)
- **Agent grouping**: `useAgentGrouping` hook - manages expansion with auto-expand for pending approvals (used by route for keyboard nav)

## Re-render Isolation

Each row only re-renders when:
1. Its event primitives change (agent-group parents update via their leaf `useLiveQuery`)
2. Its focus state changes (via zustand selector)
3. Its approval state changes (via zustand selector)

This means when one event updates, only that row re-renders (not all 100+ rows).

## Key Patterns

### Stable IDs and Leaf Queries

Rows receive stable primitive identifiers instead of event objects. Event rows query their event,
matching tool result, and approval themselves. Agent-group rows query their parent event. The
regular row's memo contract is six primitives/flags (`eventId`, `sessionId`, `isGroupItem`,
`canForkFromMessage`, `presentation`, `showGitHubPushCard`, plus the pinned-click handler); the
group row compares two IDs:

```typescript
// Parent queries only IDs
const { data: rootEventIds } = useLiveQuery(
  (q) => q.from({ events }).select(({ events }) => ({ id: events.id, tool_name: events.tool_name }))
)

// Pass primitives to child
<WiredConversationEventRow
  key={event.id}
  eventId={event.id}
  sessionId={sessionId}
  isLast={isLast}
  isGroupItem={isGroupItem}
  canForkFromMessage={event.id !== firstUserMessageId}
  showGitHubPushCard={event.id === latestPush?.eventId}
/>

// Child queries its own data
const { data: eventData } = useLiveQuery(
  (q) => q.from({ events }).where(({ events }) => eq(events.id, parentAgentEventId))
)
```

### GitHub Push Card

The stream computes the session's most recent completed `git push` Bash call
(`latestGitPushEventId` over `rootEvents`) and flags that one row with `showGitHubPushCard`. The
row renders `WiredGitHubPushCard` under itself; when the push is folded into a collapsed working
block, the stream renders the card under the block instead. The card's attention dot on the GitHub
tab is reported by `WiredGitHubPushAttention`, mounted by the stream outside the virtualized list,
so it holds while the push row is scrolled out of view. The same component ends the pull request
card's notice when the reader leaves the session, or earlier if the GitHub tab is opened, so that
notice shows once.

### Zustand Selectors for Isolated State

Each row subscribes to only the state it needs:

```typescript
// Only re-renders when THIS row's focus changes
const isFocused = useFocusStore((s) => s.focusedEventId === eventId)
```

## Storybook

Pure components in `packages/ui` are used directly in Storybook with mock data.
Wired components are NOT used in Storybook - they require database context.
`ConversationStreamShellDemo` provides a Storybook-friendly wrapper with mock interactions.
