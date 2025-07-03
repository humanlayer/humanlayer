# WUI Marketing Demo Implementation Plan

## Overview
Convert all WUI components to use Zustand stores with swappable providers, enabling the same components to work in both the real app and marketing demos without any mode-specific props or logic.

## Core Architecture Principles

### 1. Components Are Pure Consumers
- Components use store hooks without knowing implementation details
- No `isDemo`, `mode`, or similar props on any component
- Behavior is determined entirely by which provider wraps the component tree
- See working example: `/humanlayer-wui/src/pages/StoreDemo.tsx`

### 2. Provider-Based Dependency Injection
Following the pattern established in our demo:
```typescript
// Components just use the store - no knowledge of real vs demo
function SessionTable() {
  const sessions = useAppStore(state => state.sessions)
  const selectSession = useAppStore(state => state.selectSession)
  // ... render logic
}

// Real app usage
<AppStoreProvider>
  <SessionTable />
</AppStoreProvider>

// Marketing demo usage
<DemoStoreProvider sequence={marketingSequence}>
  <SessionTable />
</DemoStoreProvider>
```

### 3. Demo Sequences as Data
```typescript
interface AnimationStep {
  state: Partial<AppState>
  delay: number // milliseconds before applying this state
}

const sessionDemoSequence: AnimationStep[] = [
  { state: { sessions: [] }, delay: 1000 },
  { state: { sessions: [mockSession1] }, delay: 2000 },
  { state: { sessions: [mockSession1, mockSession2] }, delay: 1500 },
  { state: { activeSessionId: mockSession1.id }, delay: 1000 },
  // ... more steps
]
```

## Implementation Phases

### Phase 1: Create Store Abstraction Layer (2 days)

#### 1.1 Update AppStore Pattern
Based on our StoreDemo at `/_store_demo`:
```typescript
// humanlayer-wui/src/stores/appStore.ts

// Real store with working actions
function createRealAppStore() {
  return create<AppState>((set, get) => ({
    // State
    sessions: [],
    focusedSession: null,
    approvals: [],
    notifiedItems: new Set<string>(),
    isLoading: false,
    activeSessionId: null,
    
    // Working actions
    setFocusedSession: (session: SessionInfo | null) => {
      set({ focusedSession: session })
    },
    
    updateSession: (sessionId: string, updates: Partial<SessionInfo>) => {
      set(state => ({
        sessions: state.sessions.map(session =>
          session.id === sessionId ? { ...session, ...updates } : session
        ),
        focusedSession:
          state.focusedSession?.id === sessionId
            ? { ...state.focusedSession, ...updates }
            : state.focusedSession,
      }))
    },
    
    focusNextSession: () => {
      // Implementation from AppStore.ts
    },
    
    focusPreviousSession: () => {
      // Implementation from AppStore.ts
    },
  }))
}

// Demo store with no-op actions (state controlled by animator)
function createDemoAppStore() {
  return create<AppState>(() => ({
    // State
    sessions: [],
    focusedSession: null,
    approvals: [],
    notifiedItems: new Set<string>(),
    isLoading: false,
    activeSessionId: null,
    
    // No-op actions
    setFocusedSession: () => {},
    updateSession: () => {},
    focusNextSession: () => {},
    focusPreviousSession: () => {},
  }))
}
```

#### 1.2 Create Context and Providers
```typescript
// Single context - components don't choose between real/demo
const AppStoreContext = createContext<StoreApi<AppState> | null>(null)

// Hook that all components use
function useAppStore<T>(selector: (state: AppState) => T): T {
  const store = useContext(AppStoreContext)
  if (!store) throw new Error('useAppStore must be used within AppStoreProvider')
  return useStore(store, selector)
}
```

#### 1.3 Real Store Provider
```typescript
function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createRealAppStore())
  
  // Connect to daemon, set up subscriptions, etc.
  useEffect(() => {
    // Real daemon connection logic here
  }, [])
  
  return (
    <AppStoreContext.Provider value={store}>
      {children}
    </AppStoreContext.Provider>
  )
}
```

#### 1.4 Demo Store Provider
```typescript
function DemoStoreProvider({ 
  children, 
  sequence 
}: { 
  children: React.ReactNode
  sequence: AnimationStep[]
}) {
  const [store] = useState(() => createDemoAppStore())
  const [animator] = useState(() => new DemoAnimator(store, sequence))
  
  useEffect(() => {
    animator.start()
    return () => animator.stop()
  }, [animator])
  
  return (
    <AppStoreContext.Provider value={store}>
      {children}
    </AppStoreContext.Provider>
  )
}
```

### Phase 2: Refactor Components (3 days)

#### 2.1 Component Migration Order
1. **Simple Components First**
   - SessionTable - Already mostly props-based
   - ApprovalsPanel - Straightforward state usage
   - NotificationToasts - Simple subscriptions

2. **Complex Components**
   - SessionDetail - Break into smaller pieces
   - Layout - Extract daemon logic to provider
   - ConversationView - Separate display from data fetching

#### 2.2 Migration Pattern
Before:
```typescript
function SessionTable() {
  const { sessions, isLoading } = useSessions() // Direct daemon hook
  const { selectSession } = useSessionActions() // Direct daemon hook
  
  return <Table data={sessions} onSelect={selectSession} />
}
```

After:
```typescript
function SessionTable() {
  const sessions = useAppStore(state => state.sessions)
  const selectSession = useAppStore(state => state.selectSession)
  const isLoading = useAppStore(state => state.isLoading)
  
  return <Table data={sessions} onSelect={selectSession} />
}
```

### Phase 3: Implement Demo Animation System (2 days)

#### 3.1 DemoAnimator Class
Extend the pattern from StoreDemo:
```typescript
class DemoAnimator {
  private store: StoreApi<AppState>
  private sequence: AnimationStep[]
  private currentIndex: number = 0
  private timeoutId: NodeJS.Timeout | null = null
  
  constructor(store: StoreApi<AppState>, sequence: AnimationStep[]) {
    this.store = store
    this.sequence = sequence
  }
  
  start() { /* Play through sequence */ }
  stop() { /* Cleanup */ }
  pause() { /* Pause playback */ }
  reset() { /* Reset to beginning */ }
}
```

#### 3.2 Pre-built Demo Sequences
```typescript
// humanlayer-wui/src/demos/sequences/newSession.ts
import { SessionStatus } from '@/lib/daemon/types'

export const newSessionSequence: AnimationStep[] = [
  { 
    state: { 
      sessions: [],
      focusedSession: null,
      activeSessionId: null
    }, 
    delay: 1000 
  },
  {
    state: {
      sessions: [{
        id: 'demo-1',
        status: SessionStatus.Starting,
        query: 'Analyzing codebase...',
        claude_session_id: null,
        current_directory: '/project',
        agent_flags: [],
        commit_sha: 'abc123',
        branch: 'main',
        created_at: new Date().toISOString(),
        model: 'claude-3-opus'
      }],
      focusedSession: null,
      activeSessionId: 'demo-1'
    },
    delay: 2000
  },
  {
    state: {
      sessions: [{
        id: 'demo-1',
        status: SessionStatus.Running,
        query: 'Analyzing codebase...',
        claude_session_id: 'claude-123',
        current_directory: '/project',
        agent_flags: [],
        commit_sha: 'abc123',
        branch: 'main',
        created_at: new Date().toISOString(),
        model: 'claude-3-opus'
      }],
      activeSessionId: 'demo-1'
    },
    delay: 3000
  },
  // ... more steps following real state machine
]
```

### Phase 4: Marketing Site Integration (2 days)

#### 4.1 Export Components Package
```json
// humanlayer-wui/package.json
{
  "exports": {
    "./components": "./src/components/index.ts",
    "./demos": "./src/demos/index.ts"
  }
}
```

#### 4.2 Marketing Site Usage
```typescript
// marketing-site/pages/demo.tsx
import { SessionView, DemoStoreProvider } from '@humanlayer/wui'
import { sessionDemoSequence } from '@humanlayer/wui/demos'

export default function DemoPage() {
  return (
    <DemoStoreProvider sequence={sessionDemoSequence}>
      <div className="demo-container">
        <SessionView />
      </div>
    </DemoStoreProvider>
  )
}
```

## Key Implementation Details

### No Mode Props
Components should NEVER have props like:
- ❌ `<SessionTable isDemo={true} />`
- ❌ `<ApprovalCard mode="demo" />`
- ❌ `<Counter variant="real" />`

Instead, behavior changes via providers:
- ✅ `<DemoStoreProvider><SessionTable /></DemoStoreProvider>`
- ✅ `<AppStoreProvider><SessionTable /></AppStoreProvider>`

### State Shape Consistency
Demo state must match real state shape exactly:
```typescript
interface AppState {
  // Sessions (from current AppStore.ts)
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  
  // Approvals (tracked separately via daemon)
  approvals: UnifiedApprovalRequest[]
  
  // UI State (from various components)
  isLoading: boolean
  activeSessionId: string | null
  
  // Notifications
  notifiedItems: Set<string>
  
  // Actions
  setFocusedSession: (session: SessionInfo | null) => void
  updateSession: (sessionId: string, updates: Partial<SessionInfo>) => void
  focusNextSession: () => void
  focusPreviousSession: () => void
  // ... etc
}
```

### Daemon Abstraction
All daemon communication moves to the provider:
```typescript
// Before: Direct in components
const { data } = useDaemonQuery('/sessions')

// After: Provider handles daemon, updates store
// Component just reads from store
const sessions = useAppStore(state => state.sessions)
```

## Testing Strategy

### 1. Component Tests
```typescript
// Same component, different providers
it('handles real interactions', () => {
  render(
    <AppStoreProvider>
      <SessionTable />
    </AppStoreProvider>
  )
  // Test real behavior
})

it('plays demo sequence', () => {
  render(
    <DemoStoreProvider sequence={testSequence}>
      <SessionTable />
    </DemoStoreProvider>
  )
  // Test demo behavior
})
```

### 2. Sequence Validation
- Ensure demo sequences follow real state machine rules
- Validate timing feels natural
- Test loop behavior
- Verify cleanup on unmount

## Success Metrics

1. **Zero mode-specific props** on any component
2. **100% component reuse** between app and marketing
3. **Demo sequences are pure JSON** (no code)
4. **Marketing team can edit sequences** without developer help
5. **Same test suite** works for both real and demo modes

## References

- Working demo implementation: `/humanlayer-wui/src/pages/StoreDemo.tsx`
- Route to demo: `/_store_demo`
- Original research: `/thoughts/shared/research/2025-07-01_15-50-24_wui-zustand-demo-store-conversion.md`
- Session state machine: `/thoughts/global/allison/specifications/hld/workflows/session_state_machine.md`
- Current store implementation: `/humanlayer-wui/src/AppStore.ts`
- Event types: `/humanlayer-wui/src/lib/daemon/types.ts`

## Next Steps

1. Review and approve this plan
2. Create feature branch for implementation
3. Start with Phase 1 (Store Abstraction)
4. Implement one component as proof of concept
5. Continue with remaining components
6. Create demo sequences for marketing scenarios
7. Integrate with marketing site
8. When implementation is complete, cleanup the StoreDemo at `/_store_demo`

## Appendix

For a comprehensive list of all possible UI states with JSON examples, see:
**[WUI Marketing Demo States Appendix](./wui-marketing-demo-plan-appendix-states.md)**

This appendix includes:
- 40+ detailed state examples covering every UI scenario
- JSON state objects ready for use in demo sequences
- Toast and notification states (using Sonner)
- Complex multi-step workflows
- Error and loading states
- Search and filter combinations
- Complete approval flow states including deny modals

Each state includes a description and can be combined to create compelling marketing demonstrations.