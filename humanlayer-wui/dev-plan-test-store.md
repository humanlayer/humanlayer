# Development Plan: Zustand Demo Store Test

## Objective
Create a proof-of-concept page that demonstrates how to use Zustand with React Context pattern (following the screenshot approach) to implement swappable real vs demo stores for the WUI marketing landing page.

## Core Concept
- Use Zustand's store factory pattern to create different store implementations
- Real store: Global instance, interactive with user controls
- Demo store: Created in React state, automated with pre-programmed state changes
- React Context for demo store following the pattern from screenshot
- Leverage Zustand subscriptions for external state control

## Implementation Steps

### 1. Create Simple Test Page (`/demo` route)
- Add a new page component `StoreDemo.tsx`
- Add route to `router.tsx`
- Keep it isolated from main app functionality

### 2. Implement Store Factory Pattern
```typescript
// Store interface
interface CounterStore {
  count: number
  increment: () => void
  decrement: () => void
  reset: () => void
}

// Factory that creates stores
function createCounterStore(isDemo: boolean): StoreApi<CounterStore>
```

### 3. Store Pattern Implementation
```typescript
// Real store: global instance
const realStore = createCounterStore(false)

// Demo store: created in React state within provider
const [demoStore, setDemoStore] = useState<ReturnType<typeof createCounterStore>>();
```

### 4. Demo Animator Class with Subscriptions
```typescript
class DemoAnimator {
  // Controls automated state updates
  // Uses store.setState() to update from outside React
  // Random intervals for realistic feel
  // Can use store.subscribe() to react to state changes
  // Proper cleanup with unsubscribe on destroy
}
```

### 5. Provider Pattern (Following Screenshot)
```typescript
function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [demoStore, setDemoStore] = useState<...>();
  
  useEffect(() => {
    const newStore = createCounterStore(true);
    setDemoStore(newStore);
    
    return () => {
      newStore.getState().agoraClient.leave();
      newStore.destroy();
    };
  }, []);
  
  if (!demoStore) return null;
  
  return (
    <DemoStoreContext.Provider value={demoStore}>
      {children}
    </DemoStoreContext.Provider>
  );
}
```

### 6. Component Architecture
- Single `Counter` component that works with either store
- Components don't know if they're using real or demo store
- Identical API surface for both stores
- Use typed selectors with useStore hook

### 7. Key Demonstrations
- Real store: Manual +/- buttons, user controlled
- Demo store: Auto-increments at random intervals (1-10s)
- Show both side-by-side to prove the concept
- Actions in demo mode are no-ops (don't affect state)
- Demonstrate subscriptions for logging/debugging

## Benefits of This Approach
1. **Follows established pattern** - Uses React Context pattern from screenshot for demo store
2. **Clean separation** - Real store is global, demo store is scoped to provider
3. **Proper cleanup** - Demo store destroyed on unmount with cleanup logic
4. **Subscription support** - Can leverage Zustand subscriptions for external monitoring
5. **Type-safe** - Same interface for both stores with proper typing

## Future Extensions
- Add more complex state (sessions, approvals, etc.)
- Create animation sequences with specific timings
- Load demo data from JSON files
- Support pause/play/reset for demos

## Testing Plan
1. Verify real store works with user interaction
2. Verify demo store ignores user actions
3. Confirm animations run smoothly
4. Test cleanup on unmount with store.destroy()
5. Ensure no state leakage between stores
6. Verify subscriptions are properly cleaned up
7. Test that demo store is recreated fresh on each mount

## Success Criteria
- Demonstrates feasibility of Zustand-only approach
- Shows how to implement no-op actions for demo mode
- Proves external state control via animator
- Clean, understandable code that can be extended