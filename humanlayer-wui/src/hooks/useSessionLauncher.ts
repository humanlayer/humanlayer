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
  query: string
  isLaunching: boolean
  error?: string
  gPrefixMode: boolean

  // Actions
  open: (mode?: 'command' | 'search') => void
  close: () => void
  setQuery: (query: string) => void
  setGPrefixMode: (enabled: boolean) => void
  launchSession: () => Promise<void>
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
  query: '',
  isLaunching: false,
  gPrefixMode: false,

  open: (mode = 'command') =>
    set({
      isOpen: true,
      mode,
      error: undefined,
    }),

  close: () =>
    set({
      isOpen: false,
      query: '',
      error: undefined,
      gPrefixMode: false,
    }),

  setQuery: query => set({ query, error: undefined }),

  setGPrefixMode: enabled => set({ gPrefixMode: enabled }),

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

  reset: () =>
    set({
      isOpen: false,
      mode: 'command',
      query: '',
      isLaunching: false,
      error: undefined,
      gPrefixMode: false,
    }),
}))

// Helper hook for global hotkey management
export function useSessionLauncherHotkeys() {
  const { open, close, isOpen, gPrefixMode, setGPrefixMode } = useSessionLauncher()

  // Helper to check if user is typing in an input
  const isInputFocused = () => {
    const active = document.activeElement
    return (
      active?.tagName === 'INPUT' ||
      active?.tagName === 'TEXTAREA' ||
      (active as HTMLElement)?.contentEditable === 'true'
    )
  }

  return {
    handleKeyDown: (e: KeyboardEvent) => {
      // Cmd+K - Global command palette
      if (e.metaKey && e.key === 'k') {
        e.preventDefault()
        if (isOpen) {
          close()
        } else {
          open('command')
        }
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
