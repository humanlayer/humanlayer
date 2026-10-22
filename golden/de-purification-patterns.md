# De-purification Patterns for React Components

This document captures the patterns demonstrated in the ENG-2678 "De-purify ConversationStream" PR. Use these patterns when moving state management down the component tree to improve render isolation and reduce prop drilling.

## When to Apply These Patterns

Apply de-purification when you see:
- **High prop count** (15+ props passed through component boundaries)
- **Multi-level prop drilling** (same props passed unchanged through 2+ levels)
- **List re-renders** (entire list re-renders when one item updates)
- **State managed far from usage** (route manages state only used by deeply nested component)

## Pattern 1: Wired Wrapper vs Pure Leaf Components

**Problem**: Pure components in `packages/ui` need to stay pure for Storybook, but we want to reduce prop drilling.

**Solution**: Create "Connected" or "Wired" wrapper components in `apps/riptide-ui` that wrap pure components.

```typescript
// packages/ui/src/components/conversation-stream/conversation-event-row.tsx
// Pure component - receives all data as props, used in Storybook
export function ConversationEventRow({ event, isFocused, onApprove, ... }: Props) {
  return <div>...</div>
}

// apps/riptide-ui/src/components/conversation-stream/ConnectedConversationEventRow.tsx
// Connected wrapper - queries data, consumes stores, wraps pure component
export const ConnectedConversationEventRow = memo(function ConnectedConversationEventRow({
  eventId,  // Only needs ID, not full event object
  sessionId,
  eventsCollection,
}: Props) {
  // Query own data
  const { data } = useLiveQuery(...)

  // Subscribe to stores
  const isFocused = useFocusStore((s) => s.focusedEventId === eventId)

  // Wrap pure component
  return <ConversationEventRow event={transformedEvent} isFocused={isFocused} />
})
```

**Key insight**: The pure component stays unchanged and works in Storybook with mock data. The connected wrapper is only used in the app where database context exists.

## Pattern 2: Data Fetching at the Lowest Level

**Problem**: Parent queries all data and passes it down, causing all children to re-render when any data changes.

**Solution**: Each component queries its own data via `useLiveQuery`.

### Before (Parent queries everything)
```typescript
// Route queries all events
const { data: allEvents } = useLiveQuery(...)

// Maps over events, creating new objects each render
const events = allEvents.map(e => transform(e))

// All rows re-render when any event updates
{events.map(event => <Row event={event} />)}
```

### After (Each row queries its own data)
```typescript
// Parent queries only IDs
const { data: eventIds } = useLiveQuery(
  (q) => q.from({ events }).select(({ events }) => ({ id: events.id }))
)

// Child queries its own event data
function ConnectedRow({ eventId }) {
  const { data } = useLiveQuery(
    (q) => q.from({ events }).where(({ events }) => eq(events.id, eventId))
  )
  // Only this row re-renders when its data changes
}
```

**Key insight**: `useLiveQuery` with a specific `where` clause only triggers re-renders when that specific data changes.

## Pattern 3: Memoization Strategies for Append-Only Data

**Problem**: Even querying only IDs, the ID array reference changes on every query result.

**Solution**: For append-only data (like conversation events), memoize based on array length.

```typescript
// Query returns new array reference each time
const { data: eventIds } = useLiveQuery(...)

// Memoize by length - only changes when new events are added
const stableEventIds = useMemo(
  () => eventIds ?? [],
  [eventIds?.length, sessionId]  // Length is sufficient for append-only
)
```

**When this works**: Conversation events, chat messages, log entries - anything that only appends.

**When this doesn't work**: Data that can be deleted or reordered - use content hash or full comparison.

## Pattern 4: Shared State via Zustand Stores

**Problem**: Focus, selection, or approval state needs to be shared across many components but prop drilling is verbose.

**Solution**: Create focused zustand stores with selector-based subscriptions.

### Store Definition
```typescript
// apps/riptide-ui/src/hooks/stores/focusStore.ts
interface FocusState {
  focusedEventId: string | null
  focusSource: 'mouse' | 'keyboard' | null
  setFocusedEventId: (id: string | null, source: 'mouse' | 'keyboard') => void
  clearFocus: () => void
}

export const useFocusStore = create<FocusState>((set) => ({
  focusedEventId: null,
  focusSource: null,
  setFocusedEventId: (id, source) => set({ focusedEventId: id, focusSource: source }),
  clearFocus: () => set({ focusedEventId: null, focusSource: null }),
}))
```

### Selector-Based Subscription
```typescript
// GOOD: Only re-renders when THIS row's focus changes
const isFocused = useFocusStore((s) => s.focusedEventId === eventId)

// BAD: Re-renders on ANY focus change
const focusedEventId = useFocusStore((s) => s.focusedEventId)
const isFocused = focusedEventId === eventId  // Comparison happens after subscription
```

**Key insight**: The selector `(s) => s.focusedEventId === eventId` returns a boolean. Zustand only triggers re-render when this boolean changes, not when the underlying ID changes to a different value.

## Pattern 5: Re-render Isolation via React.memo

**Problem**: Parent re-renders cause all children to re-render even with stable props.

**Solution**: Wrap connected components in `React.memo` and ensure props are stable primitives.

```typescript
// Wrap in memo
export const ConnectedRow = memo(function ConnectedRow({
  eventId,     // string - primitive, stable
  sessionId,   // string - primitive, stable
  onApprove,   // function - must be wrapped in useCallback at parent
}: Props) {
  // ...
})

// Parent must use useCallback for function props
const handleApprove = useCallback((id: string) => {
  // ...
}, [dependencies])
```

**Props to avoid passing**:
- Objects that are recreated each render (`{ id: event.id }`)
- Arrays that are recreated each render (`[event]`)
- Functions not wrapped in `useCallback`

## Anti-Patterns to Avoid

### Anti-Pattern 1: Passing Full Objects When IDs Suffice
```typescript
// BAD: event object recreated each render, defeats memo
<Row event={{ id: e.id, name: e.name, ... }} />

// GOOD: primitive ID is stable, row queries its own data
<ConnectedRow eventId={e.id} />
```

### Anti-Pattern 2: Parent-Level Grouping Computation
```typescript
// BAD: Grouping at parent means all children re-render on any change
const groups = useMemo(() => buildGroups(events), [events])
{groups.map(g => <Group group={g} />)}

// GOOD: Each group component queries its own children
<ConnectedGroup groupId={id} />  // Queries children internally
```

### Anti-Pattern 3: Prop Drilling State Through Multiple Layers
```typescript
// BAD: State defined at route, passed through 3 levels
<Page focusedId={id} onFocus={setId}>
  <List focusedId={id} onFocus={setId}>
    <Row isFocused={focusedId === myId} onFocus={setId} />

// GOOD: State in store, each component subscribes directly
const isFocused = useFocusStore((s) => s.focusedEventId === eventId)
```

### Anti-Pattern 4: Full Store Subscription
```typescript
// BAD: Re-renders on ANY store change
const store = useFocusStore()
const isFocused = store.focusedEventId === eventId

// GOOD: Re-renders only when selector result changes
const isFocused = useFocusStore((s) => s.focusedEventId === eventId)
```

## Storybook Compatibility

These patterns maintain Storybook compatibility:

1. **Pure components** in `packages/ui` receive all data as props
2. **Storybook stories** use pure components with mock data
3. **Connected components** in `apps/riptide-ui` are NOT used in Storybook
4. **Storybook wrappers** (e.g., `WiredConversationStream.tsx`) can demo stateful behavior with mock interactions

## Verification Checklist

After applying these patterns, verify:

- [ ] `bun run typecheck` passes
- [ ] `bun run quality` passes
- [ ] Storybook stories still render correctly
- [ ] React DevTools shows isolated re-renders (one event update = one row re-render)
- [ ] Keyboard navigation works (if applicable)
- [ ] Focus state updates correctly across components

## Reference Implementation

See the following files from the ENG-2678 PR:

- `apps/riptide-ui/src/components/conversation-stream/ConnectedConversationEventRow.tsx`
- `apps/riptide-ui/src/components/conversation-stream/ConnectedTaskGroupEventRow.tsx`
- `apps/riptide-ui/src/components/conversation-stream/ConnectedConversationStream.tsx`
- `apps/riptide-ui/src/hooks/stores/focusStore.ts`
- `apps/riptide-ui/src/hooks/stores/approvalStore.ts`
- `apps/riptide-ui/src/hooks/stores/expansionStore.ts`
