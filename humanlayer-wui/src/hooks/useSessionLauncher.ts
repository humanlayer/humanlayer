import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'
import type { LaunchSessionRequest } from '@/lib/daemon/types'

interface ParsedQuery {
  query: string
  workingDir?: string
}

interface LauncherState {
  isOpen: boolean
  mode: 'command' | 'search'
  view: 'menu' | 'input'
  query: string
  isLaunching: boolean
  error?: string
  gPrefixMode: boolean
  selectedMenuIndex: number

  // Actions
  open: (mode?: 'command' | 'search') => void
  close: () => void
  setQuery: (query: string) => void
  setGPrefixMode: (enabled: boolean) => void
  setView: (view: 'menu' | 'input') => void
  setSelectedMenuIndex: (index: number) => void
  launchSession: () => Promise<void>
  createNewSession: () => void
  openSessionById: (sessionId: string) => void
  reset: () => void
}

// Parse basic query patterns
function parseQuery(query: string): ParsedQuery {
  const trimmed = query.trim()

  // Check for working directory pattern: "/path rest of query"
  if (trimmed.startsWith('/')) {
    const spaceIndex = trimmed.indexOf(' ')
    if (spaceIndex > 0) {
      return {
        query: trimmed.slice(spaceIndex + 1).trim(),
        workingDir: trimmed.slice(0, spaceIndex),
      }
    }
    // If just "/path" with no additional query, treat as working dir change
    return {
      query: '',
      workingDir: trimmed,
    }
  }

  return { query: trimmed }
}

export const useSessionLauncher = create<LauncherState>((set, get) => ({
  isOpen: false,
  mode: 'command',
  view: 'menu',
  query: '',
  isLaunching: false,
  gPrefixMode: false,
  selectedMenuIndex: 0,

  open: (mode = 'command') =>
    set({
      isOpen: true,
      mode,
      view: 'menu',
      selectedMenuIndex: 0,
      error: undefined,
    }),

  close: () =>
    set({
      isOpen: false,
      view: 'menu',
      query: '',
      selectedMenuIndex: 0,
      error: undefined,
      gPrefixMode: false,
    }),

  setQuery: query => set({ query, error: undefined }),

  setGPrefixMode: enabled => set({ gPrefixMode: enabled }),

  setView: view => set({ view }),

  setSelectedMenuIndex: index => set({ selectedMenuIndex: index }),

  launchSession: async () => {
    const { query } = get()
    const parsed = parseQuery(query)

    if (!parsed.query && !parsed.workingDir) {
      set({ error: 'Please enter a query to launch a session' })
      return
    }

    try {
      set({ isLaunching: true, error: undefined })

      const request: LaunchSessionRequest = {
        query: parsed.query || 'Help me with the current directory',
        working_dir: parsed.workingDir,
      }

      const response = await daemonClient.launchSession(request)

      // Navigate to new session (will be handled by parent component)
      window.location.hash = `#/session/${response.session_id}`

      // Close launcher
      get().close()
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to launch session',
      })
    } finally {
      set({ isLaunching: false })
    }
  },

  createNewSession: () => {
    // Switch to input mode for session creation
    set({ view: 'input', query: '', error: undefined })
  },

  openSessionById: (sessionId: string) => {
    // Navigate to existing session
    window.location.hash = `#/session/${sessionId}`
    get().close()
  },

  reset: () =>
    set({
      isOpen: false,
      mode: 'command',
      view: 'menu',
      query: '',
      selectedMenuIndex: 0,
      isLaunching: false,
      error: undefined,
      gPrefixMode: false,
    }),
}))

// Helper hook for global hotkey management
export function useSessionLauncherHotkeys() {
  const { open, close, isOpen, gPrefixMode, setGPrefixMode, createNewSession } = useSessionLauncher()

  // Helper to check if user is typing in an input
  const isInputFocused = () => {
    const active = document.activeElement
    if (!active) return false
    
    // Check for input and textarea elements
    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') {
      return true
    }
    
    // Check for contentEditable elements
    if ((active as HTMLElement).contentEditable === 'true') {
      return true
    }
    
    // Check if we're inside the command palette modal (more specific check)
    const commandPalette = document.querySelector('[data-command-palette]')
    if (commandPalette && commandPalette.contains(active)) {
      return true
    }
    
    return false
  }

  return {
    handleKeyDown: (e: KeyboardEvent) => {
      // Cmd+K - Global command palette (shows menu)
      if (e.metaKey && e.key === 'k') {
        e.preventDefault()
        if (isOpen) {
          close()
        } else {
          open('command')
        }
        return
      }

      // C - Create new session directly (bypasses command palette)
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !isInputFocused()) {
        e.preventDefault()
        createNewSession()
        return
      }

      // / - Search sessions and approvals (only when not typing)
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isInputFocused()) {
        e.preventDefault()
        open('search')
        return
      }

      // G prefix navigation (prepare for Phase 2)
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !isInputFocused()) {
        e.preventDefault()
        setGPrefixMode(true)
        setTimeout(() => setGPrefixMode(false), 2000)
        return
      }

      // G+A - Go to approvals (Phase 2)
      if (gPrefixMode && e.key === 'a') {
        e.preventDefault()
        setGPrefixMode(false)
        // TODO: Navigate to approvals view
        console.log('Navigate to approvals (Phase 2)')
        return
      }

      // G+S - Go to sessions (Phase 2)
      if (gPrefixMode && e.key === 's') {
        e.preventDefault()
        setGPrefixMode(false)
        // TODO: Navigate to sessions view
        console.log('Navigate to sessions (Phase 2)')
        return
      }
    },
  }
}
