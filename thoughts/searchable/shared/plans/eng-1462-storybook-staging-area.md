# ENG-1462: Storybook Staging Area for Synthetic Product Shots - Implementation Plan

## Overview

Implementation plan for creating a comprehensive demo staging area in the HumanLayer WUI for generating synthetic product shots. This system provides controllable, animated demonstrations of the complete application experience including session management, launcher workflows, and theme variations.

## Current State Analysis

### What's Been Completed ✅

Based on the conversation history and current codebase state:

#### Phase 1: Basic Demo Infrastructure (COMPLETED)
- **WUI Demo Page** (`humanlayer-wui/src/pages/WuiDemo.tsx`): Complete session table with animations
- **Route Integration** (`humanlayer-wui/src/router.tsx`): Added `/_wui_demo` route  
- **Theme Selector Integration**: Fixed positioning to prevent overflow off screen
- **Mock Data System**: Realistic session data with various statuses for demonstrations

#### Phase 2: Comprehensive App State Control (COMPLETED)
- **Demo App Store** (`humanlayer-wui/src/stores/demoAppStore.ts`): 305-line comprehensive state management
- **Launcher Integration**: Full modal workflow animations with session creation
- **Multi-Sequence Support**: Three animation types (launcher workflow, status changes, theme showcase)
- **Session Table Integration**: Complete filtering, search, and keyboard navigation

### Key Discoveries:
- **Zustand Store Pattern**: Established comprehensive app state control with `createDemoAppStore()`
- **Animation System**: `DemoAppAnimator` class with step-based sequences and descriptions
- **Component Integration**: Successfully integrated launcher modal with session table
- **Theme System**: All 9 themes working with animated transitions
- **Performance**: Smooth animations without memory leaks

### Current Architecture Issues:
- **Monolithic Store**: Single large store mixing concerns (sessions, launcher, theme, etc.)
- **Tightly Coupled**: Animation sequences directly manipulate all state properties
- **Limited Reusability**: Hard to reuse specific slices in other contexts
- **Testing Complexity**: Difficult to test individual concerns in isolation

## What We're NOT Doing

- Real daemon integration for demo sequences (uses mock data only)
- Persistent state across page reloads for demo mode
- Complex user interaction during automated animations
- Performance optimization for production usage
- Mobile-specific demo sequences
- Integration with actual Storybook framework

## Implementation Approach

Refactor to a **slice-based Zustand architecture** with **modular animation system** while maintaining all existing functionality. This enables better maintainability, testability, and reusability of individual state concerns.

---

## Phase 3: Zustand Slices Architecture Refactor

### Overview
Break down the monolithic `demoAppStore.ts` into focused, reusable slices that can be composed together or used independently.

### Changes Required:

#### 1. Session Management Slice
**File**: `humanlayer-wui/src/stores/slices/sessionSlice.ts`
**Changes**: Extract session-specific state and actions

```typescript
import { StateCreator } from 'zustand'
import { SessionInfo } from '@/lib/daemon/types'

export interface SessionSlice {
  // State
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  searchQuery: string
  
  // Actions  
  setSessions: (sessions: SessionInfo[]) => void
  setFocusedSession: (session: SessionInfo | null) => void
  setSearchQuery: (query: string) => void
  addSession: (session: SessionInfo) => void
  updateSession: (id: string, updates: Partial<SessionInfo>) => void
  removeSession: (id: string) => void
  clearSessions: () => void
  
  // Computed/derived state
  runningSessionsCount: () => number
  completedSessionsCount: () => number
}

export const createSessionSlice: StateCreator<
  SessionSlice,
  [],
  [],
  SessionSlice
> = (set, get) => ({
  sessions: [],
  focusedSession: null,
  searchQuery: '',
  
  setSessions: (sessions) => set({ sessions }),
  setFocusedSession: (session) => set({ focusedSession: session }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  
  addSession: (session) => set((state) => ({ 
    sessions: [...state.sessions, session] 
  })),
  
  updateSession: (id, updates) => set((state) => ({
    sessions: state.sessions.map(s => 
      s.id === id ? { ...s, ...updates } : s
    )
  })),
  
  removeSession: (id) => set((state) => ({
    sessions: state.sessions.filter(s => s.id !== id),
    focusedSession: state.focusedSession?.id === id ? null : state.focusedSession
  })),
  
  clearSessions: () => set({ sessions: [], focusedSession: null }),
  
  // Computed properties as functions
  runningSessionsCount: () => {
    const { sessions } = get()
    return sessions.filter(s => s.status === 'running').length
  },
  
  completedSessionsCount: () => {
    const { sessions } = get()
    return sessions.filter(s => s.status === 'completed').length
  }
})
```

#### 2. Launcher State Slice  
**File**: `humanlayer-wui/src/stores/slices/launcherSlice.ts`
**Changes**: Extract launcher modal state and workflows

```typescript
import { StateCreator } from 'zustand'

export interface LauncherSlice {
  // State
  isOpen: boolean
  mode: 'command' | 'search'
  view: 'menu' | 'input'
  query: string
  isLaunching: boolean
  error?: string
  selectedMenuIndex: number
  
  // Actions
  setOpen: (open: boolean) => void
  setMode: (mode: 'command' | 'search') => void
  setView: (view: 'menu' | 'input') => void
  setQuery: (query: string) => void
  setIsLaunching: (loading: boolean) => void
  setError: (error?: string) => void
  setSelectedMenuIndex: (index: number) => void
  
  // Workflow actions
  openLauncher: (mode?: 'command' | 'search') => void
  closeLauncher: () => void
  startLaunchingWorkflow: () => void
  finishLaunchingWorkflow: () => void
  resetLauncher: () => void
}

export const createLauncherSlice: StateCreator<
  LauncherSlice,
  [],
  [],
  LauncherSlice
> = (set, get) => ({
  isOpen: false,
  mode: 'command',
  view: 'menu',
  query: '',
  isLaunching: false,
  error: undefined,
  selectedMenuIndex: 0,
  
  setOpen: (open) => set({ isOpen: open }),
  setMode: (mode) => set({ mode }),
  setView: (view) => set({ view }),
  setQuery: (query) => set({ query, error: undefined }),
  setIsLaunching: (loading) => set({ isLaunching: loading }),
  setError: (error) => set({ error }),
  setSelectedMenuIndex: (index) => set({ selectedMenuIndex: index }),
  
  openLauncher: (mode = 'command') => set({ 
    isOpen: true, 
    mode,
    view: 'menu', 
    error: undefined,
    selectedMenuIndex: 0 
  }),
  
  closeLauncher: () => set({ 
    isOpen: false, 
    view: 'menu', 
    query: '', 
    error: undefined,
    isLaunching: false,
    selectedMenuIndex: 0
  }),
  
  startLaunchingWorkflow: () => set({ 
    isLaunching: true, 
    error: undefined 
  }),
  
  finishLaunchingWorkflow: () => set({ 
    isLaunching: false,
    isOpen: false,
    query: '',
    view: 'menu'
  }),
  
  resetLauncher: () => set({
    isOpen: false,
    mode: 'command',
    view: 'menu',
    query: '',
    isLaunching: false,
    error: undefined,
    selectedMenuIndex: 0
  })
})
```

#### 3. Theme Management Slice
**File**: `humanlayer-wui/src/stores/slices/themeSlice.ts`
**Changes**: Extract theme switching with animation support

```typescript
import { StateCreator } from 'zustand'
import { Theme } from '@/contexts/ThemeContext'

export interface ThemeSlice {
  // State
  theme: Theme
  previousTheme?: Theme
  isTransitioning: boolean
  
  // Actions
  setTheme: (theme: Theme) => void
  setThemeWithTransition: (theme: Theme, duration?: number) => void
  cycleTheme: () => void
  resetTheme: () => void
  getPreviousTheme: () => Theme | undefined
}

const availableThemes: Theme[] = [
  'solarized-dark',
  'solarized-light', 
  'catppuccin',
  'framer-dark',
  'framer-light',
  'gruvbox-dark',
  'gruvbox-light',
  'cappuccino',
  'high-contrast'
]

export const createThemeSlice: StateCreator<
  ThemeSlice,
  [],
  [],
  ThemeSlice  
> = (set, get) => ({
  theme: 'solarized-dark',
  previousTheme: undefined,
  isTransitioning: false,
  
  setTheme: (theme) => {
    const { theme: currentTheme } = get()
    set({ theme, previousTheme: currentTheme })
    
    // Update DOM in demo mode
    document.documentElement.setAttribute('data-theme', theme)
  },
  
  setThemeWithTransition: (theme, duration = 300) => {
    const { theme: currentTheme } = get()
    
    set({ isTransitioning: true })
    
    // Add transition class for smooth change
    document.body.classList.add('theme-transitioning')
    
    setTimeout(() => {
      set({ 
        theme, 
        previousTheme: currentTheme,
        isTransitioning: false 
      })
      document.documentElement.setAttribute('data-theme', theme)
      document.body.classList.remove('theme-transitioning')
    }, duration)
  },
  
  cycleTheme: () => {
    const { theme } = get()
    const currentIndex = availableThemes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % availableThemes.length
    const nextTheme = availableThemes[nextIndex]
    
    get().setThemeWithTransition(nextTheme)
  },
  
  resetTheme: () => {
    get().setTheme('solarized-dark')
  },
  
  getPreviousTheme: () => get().previousTheme
})
```

#### 4. Application State Slice
**File**: `humanlayer-wui/src/stores/slices/appSlice.ts`
**Changes**: Extract general app state (connection, status, etc.)

```typescript
import { StateCreator } from 'zustand'

export interface AppSlice {
  // State
  connected: boolean
  status: string
  approvals: any[]
  currentRoute: string
  
  // Actions
  setConnected: (connected: boolean) => void
  setStatus: (status: string) => void
  setApprovals: (approvals: any[]) => void
  setCurrentRoute: (route: string) => void
  addApproval: (approval: any) => void
  removeApproval: (approvalId: string) => void
  
  // Derived state
  hasApprovals: () => boolean
  approvalsCount: () => number
}

export const createAppSlice: StateCreator<
  AppSlice,
  [],
  [],
  AppSlice
> = (set, get) => ({
  connected: true,
  status: 'Connected! Daemon @ v1.0.0',
  approvals: [],
  currentRoute: '/',
  
  setConnected: (connected) => set({ connected }),
  setStatus: (status) => set({ status }),
  setApprovals: (approvals) => set({ approvals }),
  setCurrentRoute: (route) => set({ currentRoute: route }),
  
  addApproval: (approval) => set((state) => ({
    approvals: [...state.approvals, approval]
  })),
  
  removeApproval: (approvalId) => set((state) => ({
    approvals: state.approvals.filter(a => a.id !== approvalId)
  })),
  
  hasApprovals: () => get().approvals.length > 0,
  approvalsCount: () => get().approvals.length
})
```

#### 5. Composed Store with Slices
**File**: `humanlayer-wui/src/stores/demoAppStore.ts`
**Changes**: Refactor to use slice composition with middleware

```typescript
import { create, StoreApi } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { SessionSlice, createSessionSlice } from './slices/sessionSlice'
import { LauncherSlice, createLauncherSlice } from './slices/launcherSlice'
import { ThemeSlice, createThemeSlice } from './slices/themeSlice'
import { AppSlice, createAppSlice } from './slices/appSlice'

// Combined store type
export type DemoAppStore = SessionSlice & LauncherSlice & ThemeSlice & AppSlice & {
  // Global actions that work across slices
  resetAll: () => void
  getStoreSnapshot: () => Partial<DemoAppStore>
  restoreFromSnapshot: (snapshot: Partial<DemoAppStore>) => void
}

// Animation step interface for the new slice-based approach
export interface AppAnimationStep {
  // Target specific slices for cleaner animations
  sessionState?: Partial<SessionSlice>
  launcherState?: Partial<LauncherSlice>
  themeState?: Partial<ThemeSlice>
  appState?: Partial<AppSlice>
  delay: number
  description?: string
}

// Store factory with demo/real mode support
export const createDemoAppStore = (isDemo: boolean = false) => {
  return create<DemoAppStore>()(
    devtools(
      subscribeWithSelector(
        immer((set, get, api) => ({
          // Compose all slices
          ...createSessionSlice(set, get, api),
          ...createLauncherSlice(set, get, api),
          ...createThemeSlice(set, get, api),
          ...createAppSlice(set, get, api),
          
          // Global actions
          resetAll: () => {
            // Reset each slice individually
            get().clearSessions()
            get().resetLauncher()
            get().resetTheme()
            set((state) => {
              state.connected = true
              state.status = 'Connected! Daemon @ v1.0.0'
              state.approvals = []
              state.currentRoute = '/'
            })
          },
          
          getStoreSnapshot: () => {
            const state = get()
            return {
              // Session slice
              sessions: state.sessions,
              focusedSession: state.focusedSession,
              searchQuery: state.searchQuery,
              // Launcher slice
              isOpen: state.isOpen,
              mode: state.mode,
              view: state.view,
              query: state.query,
              isLaunching: state.isLaunching,
              error: state.error,
              selectedMenuIndex: state.selectedMenuIndex,
              // Theme slice
              theme: state.theme,
              previousTheme: state.previousTheme,
              // App slice
              connected: state.connected,
              status: state.status,
              approvals: state.approvals,
              currentRoute: state.currentRoute
            }
          },
          
          restoreFromSnapshot: (snapshot) => {
            set((state) => {
              Object.assign(state, snapshot)
            })
          }
        }))
      ),
      { 
        name: 'demo-app-store',
        enabled: process.env.NODE_ENV === 'development'
      }
    )
  )
}

// Enhanced animator that works with slices
export class DemoAppAnimator {
  private store: StoreApi<DemoAppStore>
  private sequence: AppAnimationStep[]
  private currentIndex: number = 0
  private timeoutId: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private unsubscribe: (() => void) | null = null

  constructor(store: StoreApi<DemoAppStore>, sequence: AppAnimationStep[]) {
    this.store = store
    this.sequence = sequence

    // Subscribe to slice-specific changes for better logging
    this.unsubscribe = store.subscribe(
      state => ({
        sessionsCount: state.sessions.length,
        launcherOpen: state.isOpen,
        currentTheme: state.theme,
        connected: state.connected
      }),
      (state) => {
        console.log('[Demo App Store] Slice updates:', state)
      }
    )
  }

  start() {
    this.isRunning = true
    this.currentIndex = 0
    this.playNext()
  }

  stop() {
    this.isRunning = false
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  private playNext() {
    if (!this.isRunning || this.currentIndex >= this.sequence.length) {
      if (this.isRunning) {
        // Loop back to start
        this.currentIndex = 0
        this.playNext()
      }
      return
    }

    const step = this.sequence[this.currentIndex]
    
    this.timeoutId = setTimeout(() => {
      console.log(`[Demo Animator] Step ${this.currentIndex + 1}/${this.sequence.length}: ${step.description || 'State update'}`)
      
      // Apply updates to specific slices
      const updates: any = {}
      
      if (step.sessionState) {
        Object.assign(updates, step.sessionState)
      }
      if (step.launcherState) {
        Object.assign(updates, step.launcherState)
      }
      if (step.themeState) {
        Object.assign(updates, step.themeState)
      }
      if (step.appState) {
        Object.assign(updates, step.appState)
      }
      
      this.store.setState(updates)
      
      this.currentIndex++
      this.playNext()
    }, step.delay)
  }
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation succeeds: `npm run typecheck`
- [ ] ESLint passes without errors: `npm run lint`
- [ ] All existing demo sequences work identically: Manual test of all three sequences
- [ ] Store slices are properly typed and accessible
- [ ] Zustand devtools integration works correctly

#### Manual Verification:
- [ ] All animation sequences work identically to before refactor
- [ ] Each slice can be independently updated without affecting others
- [ ] Theme changes propagate correctly to DOM and components
- [ ] Launcher workflows complete successfully end-to-end
- [ ] Session management operations work as expected
- [ ] Performance is equal or better than monolithic approach

---

## Phase 4: Enhanced Animation Sequences

### Overview
Create more sophisticated animation sequences that showcase advanced workflows and edge cases using the new slice-based architecture.

### Changes Required:

#### 1. Enhanced Sequence Definitions
**File**: `humanlayer-wui/src/stores/animations/advancedSequences.ts`
**Changes**: Add sophisticated workflow demonstrations

```typescript
import { AppAnimationStep } from '../demoAppStore'
import { mockSessions } from '../mockData'

// Complete user journey from empty state to productive use
export const fullUserJourneySequence: AppAnimationStep[] = [
  {
    sessionState: { sessions: [] },
    themeState: { theme: 'solarized-dark' },
    appState: { currentRoute: '/' },
    delay: 1000,
    description: "User starts with empty dashboard"
  },
  {
    launcherState: { isOpen: true, mode: 'command', view: 'menu' },
    delay: 1500,
    description: "User opens launcher with Cmd+K"
  },
  {
    launcherState: { view: 'input' },
    delay: 1000,
    description: "User selects 'Create New Session'"
  },
  {
    launcherState: { query: 'H' },
    delay: 200,
    description: "User starts typing"
  },
  {
    launcherState: { query: 'Help me debug this React component' },
    delay: 1800,
    description: "User completes typing query"
  },
  {
    launcherState: { isLaunching: true },
    delay: 500,
    description: "User presses Enter to launch"
  },
  {
    launcherState: { 
      isOpen: false, 
      isLaunching: false, 
      query: '',
      view: 'menu'
    },
    sessionState: { sessions: [mockSessions[0]] },
    appState: { currentRoute: `/sessions/${mockSessions[0].id}` },
    delay: 2000,
    description: "Session created successfully, navigated to detail"
  },
  {
    sessionState: { 
      sessions: [{ ...mockSessions[0], status: 'running' }]
    },
    delay: 3000,
    description: "Session begins running"
  },
  {
    sessionState: { 
      sessions: [{ ...mockSessions[0], status: 'waiting_input' }]
    },
    delay: 4000,
    description: "Claude requests clarification"
  },
  {
    sessionState: { 
      sessions: [{ ...mockSessions[0], status: 'completed' }]
    },
    delay: 3000,
    description: "Session completed successfully"
  },
  {
    appState: { currentRoute: '/' },
    delay: 1000,
    description: "User returns to session table"
  },
  {
    themeState: { theme: 'catppuccin' },
    delay: 1000,
    description: "User experiments with different theme"
  },
  {
    themeState: { theme: 'framer-dark' },
    delay: 1000,
    description: "User tries another theme"
  },
  {
    themeState: { theme: 'solarized-dark' },
    delay: 2000,
    description: "User settles on preferred theme"
  }
]

// Power user workflow with multiple sessions
export const powerUserWorkflowSequence: AppAnimationStep[] = [
  {
    sessionState: { sessions: mockSessions.slice(0, 3) },
    delay: 1000,
    description: "Power user has multiple ongoing sessions"
  },
  {
    sessionState: { searchQuery: 'debug' },
    delay: 1500,
    description: "User searches for specific sessions"
  },
  {
    sessionState: { focusedSession: mockSessions[0] },
    delay: 1000,
    description: "User focuses on first debugging session"
  },
  {
    sessionState: { searchQuery: 'status:running' },
    delay: 2000,
    description: "User filters by running sessions"
  },
  {
    sessionState: { searchQuery: '' },
    delay: 1000,
    description: "User clears search to see all sessions"
  },
  {
    launcherState: { 
      isOpen: true, 
      view: 'input', 
      query: 'Create comprehensive unit tests for the authentication module'
    },
    delay: 2000,
    description: "User launches another session in parallel"
  },
  {
    launcherState: { isOpen: false, query: '' },
    sessionState: { 
      sessions: [...mockSessions.slice(0, 3), mockSessions[3]],
      focusedSession: mockSessions[3]
    },
    delay: 1500,
    description: "New session added and focused"
  },
  {
    sessionState: {
      sessions: mockSessions.slice(0, 4).map((s, i) => 
        i < 2 ? { ...s, status: 'completed' } : s
      )
    },
    delay: 3000,
    description: "First two sessions complete"
  }
]

// Error handling and recovery demonstration  
export const errorHandlingSequence: AppAnimationStep[] = [
  {
    launcherState: { isOpen: true, view: 'input' },
    delay: 1000,
    description: "User opens launcher"
  },
  {
    launcherState: { query: 'rm -rf / --no-preserve-root' },
    delay: 2000,
    description: "User types dangerous command"
  },
  {
    launcherState: { isLaunching: true },
    delay: 500,
    description: "User attempts to launch"
  },
  {
    launcherState: { 
      isLaunching: false, 
      error: 'Safety check failed: Potentially dangerous command detected'
    },
    delay: 1500,
    description: "System displays safety error"
  },
  {
    launcherState: { 
      query: 'Help me safely clean up temporary files in my project',
      error: undefined
    },
    delay: 2000,
    description: "User rephrases request safely"
  },
  {
    launcherState: { isLaunching: true },
    delay: 500,
    description: "User tries again with safe query"
  },
  {
    launcherState: { 
      isOpen: false,
      isLaunching: false,
      query: ''
    },
    sessionState: { sessions: [mockSessions[0]] },
    delay: 2000,
    description: "Success - safe session created"
  }
]
```

#### 2. Sequence Manager  
**File**: `humanlayer-wui/src/stores/animations/sequenceManager.ts`
**Changes**: Add centralized sequence management

```typescript
import { AppAnimationStep } from '../demoAppStore'
import { fullUserJourneySequence, powerUserWorkflowSequence, errorHandlingSequence } from './advancedSequences'

export interface SequenceDefinition {
  id: string
  name: string
  description: string
  steps: AppAnimationStep[]
  category: 'basic' | 'advanced' | 'showcase' | 'error-handling'
  estimatedDuration: number // in seconds
}

export const availableSequences: SequenceDefinition[] = [
  {
    id: 'launcher-workflow',
    name: 'Launcher Workflow',
    description: 'Complete session creation workflow',
    steps: fullUserJourneySequence,
    category: 'basic',
    estimatedDuration: 25
  },
  {
    id: 'power-user',
    name: 'Power User Workflow', 
    description: 'Advanced multi-session management',
    steps: powerUserWorkflowSequence,
    category: 'advanced',
    estimatedDuration: 18
  },
  {
    id: 'error-handling',
    name: 'Error Handling',
    description: 'Safety features and error recovery',
    steps: errorHandlingSequence,
    category: 'error-handling',
    estimatedDuration: 12
  },
  {
    id: 'theme-showcase',
    name: 'Theme Showcase',
    description: 'Visual theme demonstration',
    steps: [], // Will be dynamically generated
    category: 'showcase', 
    estimatedDuration: 15
  }
]

export class SequenceManager {
  static getSequence(id: string): SequenceDefinition | undefined {
    return availableSequences.find(seq => seq.id === id)
  }
  
  static getSequencesByCategory(category: SequenceDefinition['category']): SequenceDefinition[] {
    return availableSequences.filter(seq => seq.category === category)
  }
  
  static generateThemeShowcaseSequence(): AppAnimationStep[] {
    const themes = ['solarized-dark', 'solarized-light', 'catppuccin', 'framer-dark', 'gruvbox-dark']
    const steps: AppAnimationStep[] = []
    
    // Start with sessions visible
    steps.push({
      sessionState: { sessions: mockSessions },
      themeState: { theme: 'solarized-dark' },
      delay: 1000,
      description: "Start with populated session table"
    })
    
    // Cycle through themes
    themes.forEach((theme, index) => {
      steps.push({
        themeState: { theme: theme as any },
        delay: 2000,
        description: `Switch to ${theme} theme`
      })
    })
    
    // Reset to default
    steps.push({
      themeState: { theme: 'solarized-dark' },
      delay: 2000,
      description: "Return to default theme"
    })
    
    return steps
  }
}
```

### Success Criteria:

#### Automated Verification:
- [ ] All sequence definitions compile without TypeScript errors
- [ ] Sequence manager can load and execute all sequences
- [ ] Performance metrics remain stable during complex sequences
- [ ] Memory usage doesn't increase during long sequences

#### Manual Verification:
- [ ] All sequences tell compelling stories about the product
- [ ] Error sequences effectively demonstrate safety features
- [ ] Complex workflows showcase advanced capabilities
- [ ] Sequences are suitable for different audiences (basic users, power users, etc.)

---

## Phase 5: Production Polish and Documentation

### Overview
Polish the demo system for production use with comprehensive documentation, configuration options, and deployment readiness.

### Changes Required:

#### 1. Configuration System
**File**: `humanlayer-wui/src/stores/config/demoConfig.ts`
**Changes**: Add flexible configuration for different demo modes

```typescript
export interface DemoConfig {
  mode: 'development' | 'presentation' | 'marketing' | 'testing'
  animationSpeed: 'slow' | 'normal' | 'fast'
  autoLoop: boolean
  showDescriptions: boolean
  enablePerformanceMode: boolean
  allowInterruption: boolean
  debugMode: boolean
}

export const demoConfigs: Record<string, DemoConfig> = {
  development: {
    mode: 'development',
    animationSpeed: 'fast',
    autoLoop: false,
    showDescriptions: true,
    enablePerformanceMode: true,
    allowInterruption: true,
    debugMode: true
  },
  presentation: {
    mode: 'presentation',
    animationSpeed: 'slow',
    autoLoop: true,
    showDescriptions: false,
    enablePerformanceMode: false,
    allowInterruption: false,
    debugMode: false
  },
  marketing: {
    mode: 'marketing',
    animationSpeed: 'normal',
    autoLoop: true,
    showDescriptions: false,
    enablePerformanceMode: false,
    allowInterruption: false,
    debugMode: false
  },
  testing: {
    mode: 'testing',
    animationSpeed: 'fast',
    autoLoop: false,
    showDescriptions: true,
    enablePerformanceMode: true,
    allowInterruption: true,
    debugMode: true
  }
}

export function getConfigForMode(mode: string): DemoConfig {
  return demoConfigs[mode] || demoConfigs.development
}
```

#### 2. Enhanced WUI Demo Page
**File**: `humanlayer-wui/src/pages/WuiDemo.tsx`
**Changes**: Update to use new slice-based architecture

```typescript
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ThemeSelector } from '@/components/ThemeSelector'
import { SessionTableWrapper } from '@/components/demo/SessionTableWrapper'
import { LauncherWrapper } from '@/components/demo/LauncherWrapper'
import { DemoAppStoreProvider } from '@/stores/providers/DemoAppStoreProvider'
import { SequenceManager, availableSequences } from '@/stores/animations/sequenceManager'
import { getConfigForMode } from '@/stores/config/demoConfig'

export default function WuiDemo() {
  const [selectedSequenceId, setSelectedSequenceId] = useState('launcher-workflow')
  const [demoMode, setDemoMode] = useState('presentation')
  const [isPlaying, setIsPlaying] = useState(false)
  
  const sequence = SequenceManager.getSequence(selectedSequenceId)
  const config = getConfigForMode(demoMode)
  
  const handleSequenceChange = (sequenceId: string) => {
    setSelectedSequenceId(sequenceId)
    setIsPlaying(false) // Stop current sequence
  }
  
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying)
  }

  return (
    <div className="container mx-auto p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">HumanLayer WUI Demo</h1>
          <p className="text-muted-foreground">
            Comprehensive application state demonstrations for synthetic product shots
          </p>
        </div>

        {/* Demo Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Demo Controls</CardTitle>
            <CardDescription>Configure the demonstration experience</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Sequence</label>
                <Select value={selectedSequenceId} onValueChange={handleSequenceChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSequences.map(seq => (
                      <SelectItem key={seq.id} value={seq.id}>
                        {seq.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Mode</label>
                <Select value={demoMode} onValueChange={setDemoMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="development">Development</SelectItem>
                    <SelectItem value="presentation">Presentation</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="testing">Testing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Theme</label>
                <ThemeSelector />
              </div>
              
              <div className="flex items-end">
                <Button 
                  onClick={handlePlayPause}
                  variant={isPlaying ? "destructive" : "default"}
                  className="w-full"
                >
                  {isPlaying ? "Stop" : "Play"} Demo
                </Button>
              </div>
            </div>
            
            {sequence && (
              <div className="text-sm text-muted-foreground">
                <strong>{sequence.name}:</strong> {sequence.description} 
                (≈{sequence.estimatedDuration}s)
              </div>
            )}
          </CardContent>
        </Card>

        {/* Demo Display */}
        <div className="flex justify-center">
          <div className="w-full max-w-4xl">
            <DemoAppStoreProvider 
              sequence={sequence?.steps || []} 
              config={config}
              isPlaying={isPlaying}
              onSequenceComplete={() => setIsPlaying(false)}
              key={`${selectedSequenceId}-${demoMode}`}
            >
              <div className="space-y-2">
                <Badge variant="secondary" className="text-sm">
                  Live Demo - {sequence?.name || 'No Sequence'}
                </Badge>
                <Card className="w-full">
                  <CardContent className="p-4">
                    <SessionTableWrapper />
                  </CardContent>
                </Card>
                <LauncherWrapper />
              </div>
            </DemoAppStoreProvider>
          </div>
        </div>

        {/* Documentation */}
        <Card>
          <CardHeader>
            <CardTitle>Implementation Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-1">Zustand Slice Architecture:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li><strong>SessionSlice:</strong> Manages session data, search, and focus state</li>
                <li><strong>LauncherSlice:</strong> Controls launcher modal workflows and form state</li>
                <li><strong>ThemeSlice:</strong> Handles theme switching with transition support</li>
                <li><strong>AppSlice:</strong> Manages connection status and application-wide state</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-1">Animation System:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Slice-specific updates for targeted state changes</li>
                <li>Configurable sequences with descriptions and timing</li>
                <li>Performance optimizations with RAF and transition classes</li>
                <li>Memory leak prevention with proper cleanup</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-1">Demo Features:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Multiple sequence types for different use cases</li>
                <li>Configurable demo modes (development, presentation, marketing)</li>
                <li>Real-time theme switching during animations</li>
                <li>Complete application workflows including error handling</li>
                <li>Perfect for synthetic product shots and marketing materials</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

#### 3. Documentation
**File**: `humanlayer-wui/src/stores/README.md`
**Changes**: Comprehensive documentation for the demo system

```markdown
# HumanLayer WUI Demo Store System

## Overview

The demo store system provides comprehensive application state control for creating synthetic product shots and demonstrations of the HumanLayer WUI. Built on Zustand with a slice-based architecture for modularity and maintainability.

## Architecture

### Zustand Slices

#### SessionSlice (`slices/sessionSlice.ts`)
Manages session-related state and operations:
- Session data (list, focused session, search query)
- CRUD operations (add, update, remove sessions)
- Computed properties (running/completed counts)

#### LauncherSlice (`slices/launcherSlice.ts`)  
Controls launcher modal workflows:
- Modal state (open/closed, view mode, form data)
- Launch workflows (start, progress, completion)
- Error handling and validation

#### ThemeSlice (`slices/themeSlice.ts`)
Handles theme management:
- Theme switching with transition support
- Theme cycling and history
- DOM integration for theme application

#### AppSlice (`slices/appSlice.ts`)
Manages application-wide state:
- Connection status and health
- Approval management
- Navigation state

### Animation System

#### DemoAppAnimator (`demoAppStore.ts`)
Orchestrates complex state transitions:
- Slice-specific updates for targeted changes
- Configurable timing and descriptions
- Memory leak prevention with proper cleanup
- Performance optimization with requestAnimationFrame

#### Sequence Management (`animations/sequenceManager.ts`)
Centralized sequence definitions:
- Categorized sequences (basic, advanced, showcase)
- Dynamic sequence generation
- Estimated duration tracking

## Usage

### Basic Setup

```typescript
import { createDemoAppStore } from './demoAppStore'

const store = createDemoAppStore(true) // Demo mode
```

### Using Individual Slices

```typescript
const MySessionComponent = () => {
  const sessions = useDemoAppStore(state => state.sessions)
  const addSession = useDemoAppStore(state => state.addSession)
  
  return (
    // Component JSX
  )
}
```

### Creating Custom Sequences

```typescript
const mySequence: AppAnimationStep[] = [
  {
    sessionState: { sessions: [] },
    delay: 1000,
    description: "Start with empty sessions"
  },
  {
    launcherState: { isOpen: true },
    delay: 1500,
    description: "Open launcher"
  }
  // ... more steps
]
```

### Configuration

```typescript
import { getConfigForMode } from './config/demoConfig'

const config = getConfigForMode('presentation')
// Automatically configures speed, looping, descriptions, etc.
```

## Testing

### Unit Tests
Test each slice independently:
```bash
npm test -- --testPathPattern=slices
```

### Integration Tests  
Test slice interactions and animations:
```bash
npm test -- --testPathPattern=integration
```

### Performance Tests
Monitor memory usage and animation performance:
```bash
npm run test:performance
```

## Performance Considerations

- **Selective Subscriptions**: Use `subscribeWithSelector` for targeted updates
- **Batch Updates**: Group related state changes in single transactions  
- **Memory Management**: Proper cleanup of animation timers and subscriptions
- **Transition Optimization**: Use CSS transforms and will-change for smooth animations

## Best Practices

1. **Slice Separation**: Keep slices focused on single concerns
2. **Immutable Updates**: Use Immer middleware for complex state updates
3. **TypeScript**: Maintain strict typing across all slices and animations
4. **Performance**: Monitor and optimize animation performance
5. **Testing**: Test slices in isolation and integration scenarios
```

### Success Criteria:

#### Automated Verification:
- [ ] All documentation is complete and accurate: Review README and inline docs
- [ ] TypeScript compilation succeeds: `npm run typecheck`
- [ ] All tests pass: `npm run test`
- [ ] Linting passes: `npm run lint`
- [ ] Performance benchmarks meet requirements: Load testing

#### Manual Verification:
- [ ] All demo sequences work flawlessly across different modes
- [ ] Configuration system provides appropriate flexibility
- [ ] Documentation is clear and helpful for new developers
- [ ] System is ready for production deployment and marketing use
- [ ] Demo sequences are polished and professional

---

## Testing Strategy

### Unit Tests:
- **Slice Logic**: Test each slice's state management independently
- **Animation System**: Test sequence execution and timing
- **Configuration**: Test demo mode configurations
- **Performance**: Test memory usage during long sequences

### Integration Tests:
- **Slice Interactions**: Test cross-slice communication and updates
- **Component Integration**: Test store-component binding
- **Full Workflows**: Test complete user journey sequences
- **Theme Integration**: Test theme changes during animations

### Manual Testing Steps:
1. Load `/_wui_demo` and verify all controls work
2. Test each sequence type with different demo modes
3. Verify theme switching works during active animations
4. Test error sequences and recovery workflows
5. Verify performance on different devices and browsers
6. Confirm suitability for marketing and training use

## Performance Considerations

- **Memory Management**: Proper cleanup of animation timers and subscriptions
- **Batch Updates**: Group related state changes to minimize re-renders
- **Selective Subscriptions**: Use targeted subscriptions for performance
- **Animation Optimization**: Use CSS transforms and requestAnimationFrame

## Migration Notes

This refactoring is backwards compatible. Existing code using the monolithic store will continue to work, but new code should use the slice-based approach for better maintainability and testability.

## References

- **Original Implementation**: ENG-1462 storybook staging area
- **Zustand Documentation**: https://zustand-demo.pmnd.rs/
- **Current Files**: 
  - `humanlayer-wui/src/stores/demoAppStore.ts` (monolithic version)
  - `humanlayer-wui/src/pages/WuiDemo.tsx` (demo page)
  - `humanlayer-wui/src/router.tsx` (route configuration)