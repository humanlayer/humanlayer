---
date: 2025-07-01T15:09:55-07:00
researcher: dex
git_commit: c254d36798b5aaf29383d939aac50b532ee7f1fb
branch: dexter/eng-1456-humanlayerdevcode-landing-page-with-waitlist-signup
repository: humanlayer
topic: "Creating state-free demo version of SessionTable components for WUI"
tags: [research, codebase, wui, sessiontable, state-management, demo-mode, zustand]
status: complete
last_updated: 2025-07-01
last_updated_by: dex
---

# Research: Creating state-free demo version of SessionTable components for WUI

**Date**: 2025-07-01 15:09:55 PDT
**Researcher**: dex
**Git Commit**: c254d36798b5aaf29383d939aac50b532ee7f1fb
**Branch**: dexter/eng-1456-humanlayerdevcode-landing-page-with-waitlist-signup
**Repository**: humanlayer

## Research Question
Create a bare, state-free version of the SessionTable and SessionsList component, so that I can wrap with a state provider that can use timeouts to push the component through a series of state transitions (e.g. starting on the session table, launching 3 sessions, drilling into each session, changing the active page/route, etc) - just one global JSON object that can set fields to represent any combination of states. All actions in this mode should have no effect. Propose a route that allows maintaining a single component tree for both real usage (hooked up to daemon read/write actions) and a fake version with a fake state provider for "animated" usage as part of marketing or landing page.

## Summary
The WUI uses Zustand for state management and has a clean separation between UI components and daemon communication through hooks. There's no existing demo mode, but the architecture supports creating a state-free version by:
1. Abstracting daemon interactions into a provider pattern
2. Creating pure components that receive all state via props
3. Using a demo state provider that simulates state transitions without daemon calls
4. Leveraging Zustand's flexibility to swap stores based on a demo mode flag

## Detailed Findings

### SessionTable Component Structure
- **Main Component**: `humanlayer-wui/src/components/internal/SessionTable.tsx:1-160`
  - Already mostly state-free, receives sessions and callbacks via props
  - Dependencies: fuzzy search highlighting, keyboard navigation, UI components
  - Props interface allows full control from parent component

- **Parent Component**: `humanlayer-wui/src/components/SessionTablePage.tsx:21-140`
  - Manages filtering, search, and navigation
  - Uses hooks for daemon communication and state
  - Good candidate for abstraction

- **Note**: SessionsList component doesn't exist - only SessionTable

### Current State Management Architecture
- **Global Store**: `humanlayer-wui/src/AppStore.ts:7-114`
  - Zustand store managing sessions, focused session, notifications
  - Actions: initSessions, updateSession, refreshSessions, navigation helpers
  - Clean interface for mocking

- **Key Hooks**:
  - `useSessions`: Fetches session list from daemon
  - `useSessionFilter`: Local filtering logic (already state-free)
  - `useSessionEventsWithNotifications`: Real-time updates via subscriptions
  - `useDaemonConnection`: Connection management

### Daemon Communication Layer
- **Client**: `humanlayer-wui/src/lib/daemon/client.ts:17-98`
  - Singleton pattern wrapping Tauri IPC calls
  - All daemon interactions go through this layer
  - Easy to mock by providing alternative implementation

- **Communication Flow**:
  ```
  Component → Hook → DaemonClient → Tauri → Rust → Unix Socket → Daemon
  ```

### Architecture Insights
1. **Clean Separation**: UI components are already mostly presentation-focused
2. **Hook-based Side Effects**: All daemon communication isolated in hooks
3. **Type Safety**: Full TypeScript types throughout the stack
4. **Event-driven Updates**: Subscription pattern for real-time changes
5. **No Existing Demo Mode**: No mocks or demo infrastructure found

### Historical Context (from thoughts/)
- `thoughts/dex/wui-next-steps.md` - Known UI issues to avoid in demo
- `specifications/hld/components/session_manager_spec.md` - Session state machine details
- `workflows/session_state_machine.md` - Complete state transition logic
- `research/2025-06-25_15-25-33_wui_error_handling.md` - Error handling patterns
- No existing demo mode or marketing features documented

## Code References
- `humanlayer-wui/src/components/internal/SessionTable.tsx:19-29` - SessionTable props interface
- `humanlayer-wui/src/AppStore.ts:7-15` - Zustand store interface
- `humanlayer-wui/src/lib/daemon/client.ts:17-98` - Daemon client to mock
- `humanlayer-wui/src/hooks/useSessions.ts:15-83` - Hook to replace for demo
- `humanlayer-wui/src/components/Layout.tsx:14-217` - Main app shell
- `humanlayer-wui/src/router.tsx:1-28` - Router configuration

## Architectural Proposal

### Option 1: Provider-based Approach (Recommended)
Create a `DemoModeProvider` that wraps the app and provides alternative implementations:

```typescript
// contexts/DemoModeContext.tsx
interface DemoModeContextValue {
  isDemoMode: boolean
  demoState: DemoState
  setDemoState: (state: DemoState) => void
}

interface DemoState {
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  currentRoute: string
  approvals: ApprovalRequest[]
  // ... other state fields
}

// providers/DemoModeProvider.tsx
export function DemoModeProvider({ children, isDemoMode = false }) {
  const [demoState, setDemoState] = useState<DemoState>(initialDemoState)
  
  // Run animations on mount if in demo mode
  useEffect(() => {
    if (isDemoMode) {
      runDemoAnimations(setDemoState)
    }
  }, [isDemoMode])
  
  return (
    <DemoModeContext.Provider value={{ isDemoMode, demoState, setDemoState }}>
      {children}
    </DemoModeContext.Provider>
  )
}
```

### Option 2: Store Swapping Approach
Use Zustand's flexibility to swap stores based on demo mode:

```typescript
// stores/demoStore.ts
export const createDemoStore = () => create<AppState>((set, get) => ({
  // Same interface as real store but with demo data
  sessions: generateDemoSessions(),
  refreshSessions: async () => {
    // No-op or simulate delay
    await sleep(500)
    set({ sessions: generateDemoSessions() })
  },
  // ... other actions as no-ops or simulations
}))

// In app initialization
const store = isDemoMode ? createDemoStore() : createAppStore()
```

### Option 3: Hook Abstraction Layer
Create alternative hook implementations:

```typescript
// hooks/demo/useDemoSessions.ts
export function useDemoSessions() {
  const { demoState } = useDemoMode()
  return {
    sessions: demoState.sessions,
    isLoading: false,
    error: null,
    refreshSessions: () => Promise.resolve()
  }
}

// hooks/index.ts
export const useSessions = isDemoMode ? useDemoSessions : useRealSessions
```

### Recommended Implementation Strategy

1. **Phase 1: Abstract Daemon Communication**
   - Create `DaemonProvider` context
   - Move `daemonClient` behind provider
   - Allow injection of mock implementation

2. **Phase 2: Create Pure Components**
   - Extract remaining state from SessionTable (already mostly done)
   - Create `PureSessionTablePage` that receives all data via props
   - Ensure no direct daemon calls in components

3. **Phase 3: Implement Demo Mode**
   - Create `DemoModeProvider` with animation sequences
   - Define demo state shape matching real data
   - Implement state transition functions

4. **Phase 4: Animation Sequences**
   ```typescript
   const demoSequence = [
     { delay: 0, action: 'showEmptyTable' },
     { delay: 1000, action: 'launchSession', data: { id: 'demo-1' } },
     { delay: 2000, action: 'launchSession', data: { id: 'demo-2' } },
     { delay: 3000, action: 'updateSessionStatus', data: { id: 'demo-1', status: 'running' } },
     { delay: 4000, action: 'navigateToSession', data: { id: 'demo-1' } },
     { delay: 6000, action: 'showApproval' },
     { delay: 8000, action: 'approveAction' },
     // ... more transitions
   ]
   ```

### Demo State Shape
```typescript
interface DemoState {
  // Core state
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  activeSessionId: string | null
  
  // UI state
  currentRoute: string
  searchText: string
  statusFilter: SessionStatus | 'all'
  
  // Approvals
  approvals: ApprovalRequest[]
  
  // Animation control
  isAnimating: boolean
  currentStep: number
  
  // Feature flags
  showNotifications: boolean
  simulateErrors: boolean
}
```

## Related Research
- No existing research documents on demo modes or marketing features in WUI

## Open Questions
1. Should demo mode be a build-time flag or runtime configuration?
2. How to handle routing in demo mode (real React Router vs simulated)?
3. Should demo animations be deterministic or have some randomness?
4. How to package demo mode for landing page integration (iframe, web component, etc)?
5. Performance considerations for animation timing and smoothness