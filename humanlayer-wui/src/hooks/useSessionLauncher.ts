import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'
import type { LaunchSessionRequest } from '@/lib/daemon/types'
import { useHotkeysContext } from 'react-hotkeys-hook'
import { SessionTableHotkeysScope } from '@/components/internal/SessionTable'
import { exists } from '@tauri-apps/plugin-fs'
import { homeDir } from '@tauri-apps/api/path'
import { logger } from '@/lib/logging'

interface SessionConfig {
  title?: string
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

const LAST_WORKING_DIR_KEY = 'humanlayer-last-working-dir'

// Helper function to get default working directory
const getDefaultWorkingDir = (): string => {
  const stored = localStorage.getItem(LAST_WORKING_DIR_KEY)
  return stored || '~/' // Default to home directory on first launch
}

export const useSessionLauncher = create<LauncherState>((set, get) => ({
  isOpen: false,
  mode: 'command',
  view: 'menu',
  query: '',
  config: { workingDir: getDefaultWorkingDir() },
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

  close: () => {
    set({
      isOpen: false,
      view: 'menu',
      query: '',
      config: { workingDir: getDefaultWorkingDir() },
      selectedMenuIndex: 0,
      error: undefined,
      gPrefixMode: false,
    })
  },

  setQuery: query =>
    set({
      query,
      error: undefined,
    }),

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

    // Validate working directory if provided
    if (config.workingDir) {
      try {
        // Expand ~ to home directory
        let pathToCheck = config.workingDir
        if (pathToCheck.startsWith('~')) {
          const home = await homeDir()
          pathToCheck = pathToCheck.replace(/^~(?=$|\/|\\)/, home)
        }

        // Check if the path exists
        const pathExists = await exists(pathToCheck)
        if (!pathExists) {
          set({ error: `Directory does not exist: ${config.workingDir}` })
          return
        }
      } catch (err) {
        set({ error: `Error checking directory: ${err}` })
        return
      }
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
        title: config.title || undefined,
        working_dir: config.workingDir || undefined,
        model: config.model || undefined,
        max_turns: config.maxTurns || undefined,
        mcp_config: mcpConfig,
        permission_prompt_tool: 'mcp__approvals__request_permission',
      }

      const response = await daemonClient.launchSession(request)

      // Save the working directory to localStorage for next time
      if (config.workingDir) {
        localStorage.setItem(LAST_WORKING_DIR_KEY, config.workingDir)
      }

      // Navigate to new session (will be handled by parent component)
      window.location.hash = `#/sessions/${response.sessionId}`

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
    set({
      view: 'input',
      query: '',
      config: { workingDir: getDefaultWorkingDir() },
      error: undefined,
    })
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
      config: { workingDir: getDefaultWorkingDir() },
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
      // Note: Check !e.shiftKey to allow shift+/ (?) to be handled by other hotkeys
      if (
        e.key === '/' &&
        !e.shiftKey &&
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
        logger.log('Navigate to approvals (Phase 2)')
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
