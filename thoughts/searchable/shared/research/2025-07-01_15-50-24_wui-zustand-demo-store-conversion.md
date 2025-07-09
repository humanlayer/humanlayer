---
date: 2025-07-01T15:50:03-07:00
researcher: dex
git_commit: c254d36798b5aaf29383d939aac50b532ee7f1fb
branch: dexter/eng-1456-humanlayerdevcode-landing-page-with-waitlist-signup
repository: humanlayer
topic: "Converting WUI components to Zustand with DemoStoreProvider support"
tags: [research, codebase, wui, zustand, demo-mode, state-management]
status: complete
last_updated: 2025-07-01
last_updated_by: dex
---

# Research: Converting WUI Components to Zustand with DemoStoreProvider Support

**Date**: 2025-07-01 15:50:03 PDT
**Researcher**: dex
**Git Commit**: c254d36798b5aaf29383d939aac50b532ee7f1fb
**Branch**: dexter/eng-1456-humanlayerdevcode-landing-page-with-waitlist-signup
**Repository**: humanlayer

## Research Question
Prepare a plan to convert all WUI components to keep all state in Zustand with the ability to use a `<DemoStoreProvider>` wrapper. No component should use any hooks related to daemon communications, and it should be possible to implement a demo store that 1) makes all actions into no-ops and 2) can be explicitly fed any state. The ideal flow is to leave the entire app state working while being able to render a version of the component tree that uses a DemoStore with animated state sequences for marketing purposes.

## Summary
The WUI codebase already uses Zustand for state management but lacks abstraction for daemon communication. Converting to a provider-based architecture with DemoStore support requires: 1) Creating a DaemonProvider abstraction layer, 2) Refactoring components to receive data via props, 3) Implementing a pluggable store architecture, and 4) Building an animation system for demo sequences. The existing architecture supports this transformation without major structural changes.

## Detailed Findings

### Current State Management Architecture

#### Zustand Implementation
- **Primary Store**: `humanlayer-wui/src/AppStore.ts` - manages sessions, notifications, and UI state
- **Secondary Store**: `humanlayer-wui/src/hooks/useSessionLauncher.ts` - handles session launching
- **Direct Import Pattern**: No provider or injection mechanism exists
- **Version**: Zustand v5.0.5 (latest stable)

#### Daemon Communication Layer
All daemon communication goes through custom hooks in `humanlayer-wui/src/hooks/`:
- `useDaemonConnection` - Connection management and health checks
- `useApprovals/useApprovalsWithSubscription` - Approval CRUD operations
- `useSessions/useSession` - Session management
- `useConversation/useFormattedConversation` - Conversation event polling
- `useSubscriptions/useSessionSubscriptions` - Real-time event subscriptions

### Component Dependency Analysis

#### Tightly Coupled Components (Need Refactoring)
1. **Layout.tsx** - Manages daemon connection, global subscriptions
2. **ApprovalsPanel.tsx** - Direct approval fetching and actions
3. **SessionDetail.tsx** - Complex component with multiple daemon dependencies
4. **SessionLauncher.tsx** - Launches sessions via daemon

#### Already State-Free Components
1. **SessionTable.tsx** - Receives data via props, minimal refactoring needed
2. **All UI primitives** in `/ui/` directory - Pure presentational components
3. **Utility components** - FuzzySearchInput, CommandToken, Breadcrumbs

### Historical Context from Previous Research

The file `thoughts/shared/research/2025-07-01_15-13-47_wui-state-free-demo-components.md` provides key insights:

#### Recommended Provider Pattern
```typescript
interface DaemonContextValue {
  client: DaemonClient | MockDaemonClient
  isDemo: boolean
}

const DaemonContext = createContext<DaemonContextValue>()
```

#### Demo State Shape
```typescript
interface DemoState {
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  activeSessionId: string | null
  currentRoute: string
  searchText: string
  statusFilter: SessionStatus | 'all'
  approvals: ApprovalRequest[]
  isAnimating: boolean
  currentStep: number
}
```

## Architecture Insights

### Clean Separation Already Exists
- UI components are well-separated from business logic
- Hooks provide a clear abstraction boundary
- Zustand stores are relatively simple and focused

### Provider Pattern is Natural Fit
- Codebase already uses providers (ThemeProvider, HotkeysProvider)
- React Context is familiar pattern in this codebase
- No anti-patterns preventing provider implementation

### Animation Requirements
- Session state machine from `thoughts/global/allison/specifications/hld/workflows/session_state_machine.md` defines exact transitions
- States: starting → running → waiting_input → completed/failed
- Demo animations should follow real state transitions for authenticity

## Implementation Plan

### Phase 1: Create Abstraction Layer (2-3 days)
1. **Create DaemonProvider Context**
   ```typescript
   interface DaemonProviderProps {
     client?: DaemonClient
     mockData?: DemoState
     animationSequence?: AnimationStep[]
   }
   ```

2. **Abstract All Daemon Hooks**
   - Create interface for each hook
   - Implement production version (current implementation)
   - Implement demo version (returns mock data)

3. **Wrap App in DaemonProvider**
   - Default to production client
   - Allow injection of demo client

### Phase 2: Refactor Components (3-4 days)
1. **Start with Simple Components**
   - SessionTable (already mostly props-based)
   - ApprovalsPanel (straightforward refactor)

2. **Tackle Complex Components**
   - Split SessionDetail into smaller pieces
   - Extract Layout connection logic

3. **Update Hook Usage**
   - Replace direct hook imports with context-based hooks
   - Ensure all components work with both real and demo data

### Phase 3: Implement Demo Store (2-3 days)
1. **Create DemoStore Class**
   ```typescript
   class DemoStore {
     private states: DemoState[]
     private currentIndex: number
     private animationTimer: NodeJS.Timer
     
     constructor(sequence: AnimationSequence) {}
     play() {}
     pause() {}
     reset() {}
   }
   ```

2. **Implement Animation Engine**
   - Time-based state transitions
   - Support for delays and durations
   - Smooth interpolation for counters

3. **Create Demo Sequences**
   - "New Session Launch" sequence
   - "Approval Flow" sequence
   - "Multi-Session Management" sequence

### Phase 4: Integration and Testing (2 days)
1. **Create Demo Wrapper Component**
   ```typescript
   <DemoStoreProvider sequence={marketingSequence}>
     <App />
   </DemoStoreProvider>
   ```

2. **Test All Scenarios**
   - Verify production mode unchanged
   - Test each demo sequence
   - Ensure smooth animations

3. **Create JSON Configuration**
   - Define sequences in JSON files
   - Load dynamically for different demos

## Code References
- `humanlayer-wui/src/AppStore.ts:1-80` - Current Zustand store implementation
- `humanlayer-wui/src/hooks/useDaemonConnection.ts:1-50` - Connection management to abstract
- `humanlayer-wui/src/components/Layout.tsx:50-150` - Main refactoring target
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:1-300` - Complex component needing split
- `thoughts/shared/research/2025-07-01_15-13-47_wui-state-free-demo-components.md` - Previous research with detailed recommendations

## Migration Strategy

### Component Refactoring Order
1. **Week 1**: Infrastructure
   - DaemonProvider implementation
   - Hook abstraction interfaces
   - Basic demo store

2. **Week 2**: Component Migration
   - SessionTable, ApprovalsPanel (easy wins)
   - SessionDetail decomposition
   - Layout refactoring

3. **Week 3**: Demo Implementation
   - Animation engine
   - Demo sequences
   - Testing and polish

### Risk Mitigation
- Keep changes behind feature flag initially
- Maintain backward compatibility
- Extensive testing at each phase
- Progressive rollout

## Open Questions
1. **Build vs Runtime Configuration**: Should demo mode be compile-time or runtime switchable?
2. **Animation Complexity**: How sophisticated should the animation engine be?
3. **Sequence Storage**: JSON files, TypeScript configs, or database?
4. **Performance**: What's acceptable overhead for animation system?
5. **Embedding Strategy**: iframe, web component, or standalone build?

## Related Research
- `thoughts/shared/research/2025-07-01_15-13-47_wui-state-free-demo-components.md` - Initial exploration of state-free components
- `thoughts/global/allison/specifications/hld/workflows/session_state_machine.md` - Session state transitions
- `thoughts/dex/wui-next-steps.md` - Known UI issues to address