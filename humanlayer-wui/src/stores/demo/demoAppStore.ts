import { create, StoreApi } from 'zustand'
import { SessionInfo, SessionStatus } from '@/lib/daemon/types'
import { Theme } from '@/contexts/ThemeContext'

// Comprehensive app state for demo animations
interface DemoAppState {
  // Session data
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null

  // Launcher state
  launcherOpen: boolean
  launcherMode: 'command' | 'search'
  launcherView: 'menu' | 'input'
  launcherQuery: string
  launcherIsLaunching: boolean
  launcherError?: string
  launcherSelectedMenuIndex: number

  // App connection state
  connected: boolean
  status: string

  // Approvals state
  approvals: any[]

  // Theme
  theme: Theme

  // Navigation state
  currentRoute: string

  // Focus and UI state
  searchQuery: string

  // Actions for demo control
  setSessions: (sessions: SessionInfo[]) => void
  setFocusedSession: (session: SessionInfo | null) => void
  setLauncherOpen: (open: boolean) => void
  setLauncherMode: (mode: 'command' | 'search') => void
  setLauncherView: (view: 'menu' | 'input') => void
  setLauncherQuery: (query: string) => void
  setLauncherIsLaunching: (loading: boolean) => void
  setLauncherError: (error?: string) => void
  setLauncherSelectedMenuIndex: (index: number) => void
  setConnected: (connected: boolean) => void
  setStatus: (status: string) => void
  setApprovals: (approvals: any[]) => void
  setTheme: (theme: Theme) => void
  setCurrentRoute: (route: string) => void
  setSearchQuery: (query: string) => void

  // Convenience actions
  addSession: (session: SessionInfo) => void
  updateSession: (id: string, updates: Partial<SessionInfo>) => void
  removeSession: (id: string) => void
  clearSessions: () => void

  // Complex workflow actions
  simulateLaunchSession: (query: string) => void
  simulateSessionComplete: (sessionId: string) => void
  simulateSessionFailed: (sessionId: string, error: string) => void
}

// Animation step for comprehensive app state
export interface AppAnimationStep {
  state: Partial<DemoAppState>
  delay: number
  description?: string
}

// Create demo app store factory
export function createDemoAppStore(isDemo: boolean = false): StoreApi<DemoAppState> {
  return create<DemoAppState>((set, get) => ({
    // Initial state
    sessions: [],
    focusedSession: null,
    launcherOpen: false,
    launcherMode: 'command',
    launcherView: 'menu',
    launcherQuery: '',
    launcherIsLaunching: false,
    launcherError: undefined,
    launcherSelectedMenuIndex: 0,
    connected: true,
    status: 'Connected! Daemon @ v1.0.0',
    approvals: [],
    theme: 'solarized-dark',
    currentRoute: '/',
    searchQuery: '',

    // Basic setters
    setSessions: sessions => {
      if (!isDemo) set({ sessions })
    },
    setFocusedSession: session => {
      if (!isDemo) set({ focusedSession: session })
    },
    setLauncherOpen: open => {
      if (!isDemo) set({ launcherOpen: open })
    },
    setLauncherMode: mode => {
      if (!isDemo) set({ launcherMode: mode })
    },
    setLauncherView: view => {
      if (!isDemo) set({ launcherView: view })
    },
    setLauncherQuery: query => {
      if (!isDemo) set({ launcherQuery: query })
    },
    setLauncherIsLaunching: loading => {
      if (!isDemo) set({ launcherIsLaunching: loading })
    },
    setLauncherError: error => {
      if (!isDemo) set({ launcherError: error })
    },
    setLauncherSelectedMenuIndex: index => {
      if (!isDemo) set({ launcherSelectedMenuIndex: index })
    },
    setConnected: connected => {
      if (!isDemo) set({ connected })
    },
    setStatus: status => {
      if (!isDemo) set({ status })
    },
    setApprovals: approvals => {
      if (!isDemo) set({ approvals })
    },
    setTheme: theme => {
      if (!isDemo) {
        set({ theme })
        // In real mode, also update the actual theme
        document.documentElement.setAttribute('data-theme', theme)
        localStorage.setItem('wui-theme', theme)
      }
    },
    setCurrentRoute: route => {
      if (!isDemo) set({ currentRoute: route })
    },
    setSearchQuery: query => {
      if (!isDemo) set({ searchQuery: query })
    },

    // Convenience actions
    addSession: session => {
      if (!isDemo) {
        set(state => ({
          sessions: [...state.sessions, session],
        }))
      }
    },
    updateSession: (id, updates) => {
      if (!isDemo) {
        set(state => ({
          sessions: state.sessions.map(s => (s.id === id ? { ...s, ...updates } : s)),
        }))
      }
    },
    removeSession: id => {
      if (!isDemo) {
        set(state => ({
          sessions: state.sessions.filter(s => s.id !== id),
          focusedSession: state.focusedSession?.id === id ? null : state.focusedSession,
        }))
      }
    },
    clearSessions: () => {
      if (!isDemo) {
        set({ sessions: [], focusedSession: null })
      }
    },

    // Complex workflow actions
    simulateLaunchSession: query => {
      if (!isDemo) {
        const state = get()

        // Start launcher sequence
        set({
          launcherOpen: true,
          launcherMode: 'command',
          launcherView: 'input',
          launcherQuery: query,
          launcherIsLaunching: true,
          launcherError: undefined,
        })

        // Simulate delay and create session
        setTimeout(() => {
          const newSession: SessionInfo = {
            id: `session-${Date.now()}`,
            run_id: `run-${Date.now()}`,
            claude_session_id: `claude-${Date.now()}`,
            status: SessionStatus.Starting,
            start_time: new Date().toISOString(),
            last_activity_at: new Date().toISOString(),
            query: query,
            summary: query.length > 50 ? query.substring(0, 50) + '...' : query,
            model: 'claude-3-5-sonnet-20241022',
            working_dir: '/demo/working/dir',
          }

          set(currentState => ({
            sessions: [...currentState.sessions, newSession],
            launcherOpen: false,
            launcherIsLaunching: false,
            launcherQuery: '',
            launcherView: 'menu',
            currentRoute: `/sessions/${newSession.id}`,
          }))
        }, 2000)
      }
    },

    simulateSessionComplete: sessionId => {
      if (!isDemo) {
        get().updateSession(sessionId, {
          status: SessionStatus.Completed,
          end_time: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        })
      }
    },

    simulateSessionFailed: (sessionId, error) => {
      if (!isDemo) {
        get().updateSession(sessionId, {
          status: SessionStatus.Failed,
          end_time: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
          error: error,
        })
      }
    },
  }))
}

// Demo animator for comprehensive app state
export class DemoAppAnimator {
  private store: StoreApi<DemoAppState>
  private sequence: AppAnimationStep[]
  private currentIndex: number = 0
  private timeoutId: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private unsubscribe: (() => void) | null = null

  constructor(store: StoreApi<DemoAppState>, sequence: AppAnimationStep[]) {
    this.store = store
    this.sequence = sequence

    // Subscribe to store changes for logging
    this.unsubscribe = store.subscribe(
      state => ({
        sessions: state.sessions.length,
        launcher: state.launcherOpen,
        theme: state.theme,
      }),
      state => {
        console.log('[Demo App Store] State updated:', state)
      },
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
        this.currentIndex = 0
        this.playNext()
      }
      return
    }

    const step = this.sequence[this.currentIndex]

    this.timeoutId = setTimeout(() => {
      console.log(
        `[Demo App Animator] Step ${this.currentIndex + 1}/${this.sequence.length}: ${step.description || 'State update'}`,
      )

      // Apply the state from the sequence
      this.store.setState(step.state as DemoAppState)

      // Move to next step
      this.currentIndex++
      this.playNext()
    }, step.delay)
  }
}
