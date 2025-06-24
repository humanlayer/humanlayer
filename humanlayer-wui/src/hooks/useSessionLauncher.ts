import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'
import type { LaunchSessionRequest } from '@/lib/daemon/types'
import { useHotkeysContext } from 'react-hotkeys-hook'
import { SessionTableHotkeysScope } from '@/components/internal/SessionTable'

interface SessionConfig {
  query: string
  workingDir: string
  model?: string
  maxTurns?: number
}

interface LauncherState {
  isOpen: boolean
  mode: 'command' | 'search'
  view: 'menu' | 'input'
  query: string
  config: SessionConfig
  isLaunching: boolean
  error?: string
  gPrefixMode: boolean
  selectedMenuIndex: number

  // Actions
  open: (mode?: 'command' | 'search') => void
  close: () => void
  setQuery: (query: string) => void
  setConfig: (config: SessionConfig) => void
  setGPrefixMode: (enabled: boolean) => void
  setView: (view: 'menu' | 'input') => void
  setSelectedMenuIndex: (index: number) => void
  launchSession: () => Promise<void>
  createNewSession: () => void
  openSessionById: (sessionId: string) => void
  reset: () => void
}

export const useSessionLauncher = create<LauncherState>((set, get) => ({
  isOpen: false,
  mode: 'command',
  view: 'menu',
  query: '',
  config: { query: '', workingDir: '' },
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
      config: { query: '', workingDir: '' },
      selectedMenuIndex: 0,
      error: undefined,
      gPrefixMode: false,
    }),

  setQuery: query =>
    set(state => ({
      query,
      config: { ...state.config, query },
      error: undefined,
    })),

  setConfig: config => set({ config, error: undefined }),

  setGPrefixMode: enabled => set({ gPrefixMode: enabled }),

  setView: view => set({ view }),

  setSelectedMenuIndex: index => set({ selectedMenuIndex: index }),

  launchSession: async () => {
    const { query, config } = get()

    if (!query.trim()) {
      set({ error: 'Please enter a query to launch a session' })
      return
    }

    try {
      set({ isLaunching: true, error: undefined })

      // Build MCP config (approvals enabled by default)
      const mcpConfig = {
        mcpServers: {
          approvals: {
            command: 'npx',
            args: ['humanlayer', 'mcp', 'claude_approvals'],
          },
        },
      }

      const request: LaunchSessionRequest = {
        query: query.trim(),
        working_dir: config.workingDir || undefined,
        model: config.model || undefined,
        max_turns: config.maxTurns || undefined,
        mcp_config: mcpConfig,
        permission_prompt_tool: 'mcp__approvals__request_permission',
      }

      const response = await daemonClient.launchSession(request)

      // Navigate to new session (will be handled by parent component)
      window.location.hash = `#/sessions/${response.session_id}`

      // Close launcher
      get().close()

      // Trigger a session refresh
      // Import loadSessions from App or dispatch a custom event
      window.dispatchEvent(new CustomEvent('session-created'))
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
    window.location.hash = `#/sessions/${sessionId}`
    get().close()
  },

  reset: () =>
    set({
      isOpen: false,
      mode: 'command',
      view: 'menu',
      query: '',
      config: { query: '', workingDir: '' },
      selectedMenuIndex: 0,
      isLaunching: false,
      error: undefined,
      gPrefixMode: false,
    }),
}))

// Helper hook for global hotkey management
export function useSessionLauncherHotkeys() {
  const { activeScopes } = useHotkeysContext()

  const { open, close, isOpen, gPrefixMode, setGPrefixMode, createNewSession } = useSessionLauncher()

  // Helper to check if user is actively typing in a text input
  const isTypingInInput = () => {
    const active = document.activeElement
    if (!active) return false

    // Only block hotkeys when actively typing in actual input fields
    return (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      (active as HTMLElement).contentEditable === 'true'
    )
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
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !isTypingInInput()) {
        e.preventDefault()
        // Open launcher if not already open
        if (!isOpen) {
          open('command')
        }
        createNewSession()
        return
      }

      // / - Search sessions and approvals (only when not typing)
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !isTypingInInput() &&
        !activeScopes.includes(SessionTableHotkeysScope)
      ) {
        e.preventDefault()
        open('search')
        return
      }

      // G prefix navigation (prepare for Phase 2)
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !isTypingInInput()) {
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
        // Navigate to sessions view
        window.location.hash = '#/'
        return
      }
    },
  }
}
