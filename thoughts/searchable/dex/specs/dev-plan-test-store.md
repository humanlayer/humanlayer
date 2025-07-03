# Development Plan: Zustand Demo Store Test

## Objective
Create a proof-of-concept page that demonstrates how to use Zustand with React Context pattern (following the screenshot approach) to implement swappable real vs demo stores for the WUI marketing landing page.

## Core Concept
- Create two separate store creation functions for real and demo modes
- Real store: Working actions, interactive with user controls
- Demo store: No-op actions, state controlled by external animator
- Both stores use React Context pattern for dependency injection
- Leverage Zustand subscriptions for external state control
- Components remain pure - unaware of which store type they're using

## Implementation Steps

### 1. Create Simple Test Page (`/demo` route)
- Add a new page component `StoreDemo.tsx`
- Add route to `router.tsx`
- Keep it isolated from main app functionality

### 2. Implement Store Creation Functions
```typescript
// Store interface
interface CounterStore {
  count: number
  increment: () => void
  decrement: () => void
  reset: () => void
}

// Real store with working actions
function createRealCounterStore(): StoreApi<CounterStore>

// Demo store with no-op actions
function createDemoCounterStore(): StoreApi<CounterStore>
```

### 3. Store Pattern Implementation
```typescript
// Real store: created in provider
const [realStore] = useState(() => createRealCounterStore())

// Demo store: created in provider
const [demoStore] = useState(() => createDemoCounterStore())
```

### 4. Demo Animator Class with Sequences
```typescript
class DemoAnimator {
  // Controls automated state updates
  // Uses store.setState() to update from outside React
  // Plays through predefined animation sequences
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
- Demo store: Plays through animation sequences with defined timings
- Show both side-by-side to prove the concept
- Demo store actions are no-ops (don't affect state)
- Real store actions work normally
- Demonstrate subscriptions for logging/debugging

## Benefits of This Approach
1. **Clean separation** - Two distinct store creation functions, no conditional logic in actions
2. **Follows established pattern** - Uses React Context pattern for both store types
3. **Proper cleanup** - Store destroyed on unmount with cleanup logic
4. **Subscription support** - Can leverage Zustand subscriptions for external monitoring
5. **Type-safe** - Same interface for both stores with proper typing
6. **Clarity** - It's immediately obvious which store type is being created
7. **Maintainable** - No need to track isDemo flags throughout the codebase

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