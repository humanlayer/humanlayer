import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'
import type { LaunchSessionRequest } from '@/lib/daemon/types'
import { useHotkeysContext } from 'react-hotkeys-hook'
import { exists } from '@tauri-apps/plugin-fs'
import { homeDir } from '@tauri-apps/api/path'
import { logger } from '@/lib/logging'

interface SessionConfig {
  title?: string
  workingDir: string
  provider?: string
  model?: string
  maxTurns?: number
  openRouterApiKey?: string
  basetenApiKey?: string
  zAiApiKey?: string
  additionalDirectories?: string[]
}

interface LauncherState {
  isOpen: boolean
  mode: 'command'
  view: 'menu' | 'input'
  query: string
  config: SessionConfig
  isLaunching: boolean
  error?: string
  gPrefixMode: boolean
  selectedMenuIndex: number

  // Actions
  open: () => void
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

const isViewingSessionDetail = (): boolean => {
  const hash = window.location.hash
  return /^#\/sessions\/[^/]+$/.test(hash)
}

const LAST_WORKING_DIR_KEY = 'humanlayer-last-working-dir'
const SESSION_LAUNCHER_QUERY_KEY = 'session-launcher-query'
const OPENROUTER_API_KEY = 'humanlayer-openrouter-api-key'
const BASETEN_API_KEY = 'humanlayer-baseten-api-key'
const Z_AI_API_KEY = 'humanlayer-z-ai-api-key'

// Helper function to get default working directory
const getDefaultWorkingDir = (): string => {
  const stored = localStorage.getItem(LAST_WORKING_DIR_KEY)
  return stored || '~/' // Default to home directory on first launch
}

// Helper function to get saved query
const getSavedQuery = (): string => {
  return localStorage.getItem(SESSION_LAUNCHER_QUERY_KEY) || ''
}

// Helper function to get saved OpenRouter API key
const getSavedOpenRouterKey = (): string | undefined => {
  return localStorage.getItem(OPENROUTER_API_KEY) || undefined
}

// Helper function to get saved Baseten API key
const getSavedBasetenKey = (): string | undefined => {
  return localStorage.getItem(BASETEN_API_KEY) || undefined
}

// Helper function to get saved Z-AI API key
const getSavedZAIKey = (): string | undefined => {
  return localStorage.getItem(Z_AI_API_KEY) || undefined
}

export const useSessionLauncher = create<LauncherState>((set, get) => ({
  isOpen: false,
  mode: 'command',
  view: 'menu',
  query: getSavedQuery(),
  config: {
    workingDir: getDefaultWorkingDir(),
    provider: 'anthropic',
    openRouterApiKey: getSavedOpenRouterKey(),
    basetenApiKey: getSavedBasetenKey(),
    zAiApiKey: getSavedZAIKey(),
    additionalDirectories: [],
  },
  isLaunching: false,
  gPrefixMode: false,
  selectedMenuIndex: 0,

  open: () =>
    set({
      isOpen: true,
      mode: 'command', // Always command mode
      view: 'menu',
      selectedMenuIndex: 0,
      error: undefined,
    }),

  close: () => {
    const savedQuery = getSavedQuery()
    set({
      isOpen: false,
      view: 'menu',
      query: savedQuery,
      config: {
        workingDir: getDefaultWorkingDir(),
        provider: 'anthropic',
        openRouterApiKey: getSavedOpenRouterKey(),
        basetenApiKey: getSavedBasetenKey(),
        zAiApiKey: getSavedZAIKey(),
        additionalDirectories: [],
      },
      selectedMenuIndex: 0,
      error: undefined,
      gPrefixMode: false,
    })
  },

  setQuery: query => {
    // Save to localStorage on every change
    localStorage.setItem(SESSION_LAUNCHER_QUERY_KEY, query)
    return set({
      query,
      error: undefined,
    })
  },

  setConfig: config => {
    // Save or remove OpenRouter API key from localStorage
    if (config.openRouterApiKey) {
      localStorage.setItem(OPENROUTER_API_KEY, config.openRouterApiKey)
    } else if (
      config.openRouterApiKey === undefined ||
      config.openRouterApiKey === null ||
      config.openRouterApiKey === ''
    ) {
      // Remove from localStorage when cleared to avoid stale state
      localStorage.removeItem(OPENROUTER_API_KEY)
    }
    // Save or remove Baseten API key from localStorage
    if (config.basetenApiKey) {
      localStorage.setItem(BASETEN_API_KEY, config.basetenApiKey)
    } else if (
      config.basetenApiKey === undefined ||
      config.basetenApiKey === null ||
      config.basetenApiKey === ''
    ) {
      // Remove from localStorage when cleared to avoid stale state
      localStorage.removeItem(BASETEN_API_KEY)
    }
    // Save or remove Z-AI API key from localStorage
    if (config.zAiApiKey) {
      localStorage.setItem(Z_AI_API_KEY, config.zAiApiKey)
    } else if (
      config.zAiApiKey === undefined ||
      config.zAiApiKey === null ||
      config.zAiApiKey === ''
    ) {
      // Remove from localStorage when cleared to avoid stale state
      localStorage.removeItem(Z_AI_API_KEY)
    }
    return set({ config, error: undefined })
  },

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

      // MCP config is now injected by daemon

      console.log('useSessionLauncher config:', config)
      console.log('useSessionLauncher provider:', config.provider)
      
      const request: LaunchSessionRequest = {
        query: query.trim(),
        title: config.title || undefined,
        working_dir: config.workingDir || undefined,
        provider: config.provider || 'anthropic',
        model: config.model || undefined,
        max_turns: config.maxTurns || undefined,
        // MCP config is now injected by daemon
        permission_prompt_tool: 'mcp__codelayer__request_permission',
        // For non-Anthropic providers, enable proxy and pass API key if provided
        // The daemon will handle all routing and transformation based on the provider
        ...(config.provider && config.provider !== 'anthropic'
          ? {
              proxy_enabled: true,
              proxy_model_override: config.model || undefined,
              // Pass the appropriate API key based on provider
              ...(config.provider === 'openrouter' && config.openRouterApiKey
                ? { proxy_api_key: config.openRouterApiKey }
                : {}),
              ...(config.provider === 'baseten' && config.basetenApiKey
                ? { proxy_api_key: config.basetenApiKey }
                : {}),
              ...(config.provider === 'z_ai' && config.zAiApiKey
                ? { proxy_api_key: config.zAiApiKey }
                : {}),
            }
          : {}),
      }

      console.log('useSessionLauncher request:', request)
      const response = await daemonClient.launchSession(request)

      // Save the working directory to localStorage for next time
      if (config.workingDir) {
        localStorage.setItem(LAST_WORKING_DIR_KEY, config.workingDir)
      }

      // Clear the saved query after successful launch
      localStorage.removeItem(SESSION_LAUNCHER_QUERY_KEY)

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
    const savedQuery = getSavedQuery()
    // Switch to input mode for session creation
    set({
      view: 'input',
      query: savedQuery,
      config: {
        workingDir: getDefaultWorkingDir(),
        provider: 'anthropic',
        openRouterApiKey: getSavedOpenRouterKey(),
        basetenApiKey: getSavedBasetenKey(),
        zAiApiKey: getSavedZAIKey(),
        additionalDirectories: [],
      },
      error: undefined,
    })
  },

  openSessionById: (sessionId: string) => {
    // Navigate to existing session
    window.location.hash = `#/sessions/${sessionId}`
    get().close()
  },

  reset: () => {
    const savedQuery = getSavedQuery()
    return set({
      isOpen: false,
      mode: 'command',
      view: 'menu',
      query: savedQuery,
      config: {
        workingDir: getDefaultWorkingDir(),
        provider: 'anthropic',
        openRouterApiKey: getSavedOpenRouterKey(),
        basetenApiKey: getSavedBasetenKey(),
        zAiApiKey: getSavedZAIKey(),
        additionalDirectories: [],
      },
      selectedMenuIndex: 0,
      isLaunching: false,
      error: undefined,
      gPrefixMode: false,
    })
  },
}))

// Export helper function
export { isViewingSessionDetail }

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

  // Check if a modal scope is active (indicating a modal is open)
  const isModalScopeActive = () => {
    // Only check for specific modals that should block global hotkeys
    // Don't include all modals - for example, we want 'c' to work in SessionDetail
    return activeScopes.some(
      scope =>
        scope === 'tool-result-modal' || // Tool result modal (opened with 'i')
        scope === 'session-launcher' || // Session launcher itself
        scope === 'fork-view-modal' || // Fork view modal
        scope === 'dangerously-skip-permissions-dialog', // Permissions dialog
    )
  }

  return {
    handleKeyDown: (e: KeyboardEvent) => {
      // Cmd+K - Global command palette (shows menu)
      if (e.metaKey && e.key === 'k') {
        e.preventDefault()
        if (!isOpen) {
          open()
        } else {
          close()
        }
        return
      }

      // C - Create new session directly (bypasses command palette)
      // Don't trigger if a modal is already open
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !isTypingInInput()) {
        if (!isModalScopeActive()) {
          e.preventDefault()
          // Open launcher if not already open
          if (!isOpen) {
            open()
          }
          createNewSession()
          return
        }
      }

      // G prefix navigation (prepare for Phase 2)
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !isTypingInInput() && !isModalScopeActive()) {
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
