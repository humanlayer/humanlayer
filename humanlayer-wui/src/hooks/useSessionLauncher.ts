import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'
import type { LaunchSessionRequest } from '@/lib/daemon/types'
import { useHotkeys } from 'react-hotkeys-hook'
import { exists } from '@tauri-apps/plugin-fs'
import { homeDir } from '@tauri-apps/api/path'
import { logger } from '@/lib/logging'
import { useStore } from '@/AppStore'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

interface SessionConfig {
  title?: string
  workingDir: string
  provider?: 'anthropic' | 'openrouter' | 'baseten'
  model?: string
  maxTurns?: number
  openRouterApiKey?: string
  basetenApiKey?: string
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
  createNewSession: () => Promise<void>
  openSessionById: (sessionId: string) => void
  reset: () => void
}

const isViewingSessionDetail = (): boolean => {
  const hash = window.location.hash
  return /^#\/sessions\/[^/]+$/.test(hash)
}

export const LAST_WORKING_DIR_KEY = 'humanlayer-last-working-dir'
const SESSION_LAUNCHER_QUERY_KEY = 'session-launcher-query'
const OPENROUTER_API_KEY = 'humanlayer-openrouter-api-key'
const BASETEN_API_KEY = 'humanlayer-baseten-api-key'
const ADDITIONAL_DIRECTORIES_KEY = 'humanlayer-additional-directories'
const PROVIDER_KEY = 'humanlayer-provider'
const MODEL_KEY = 'humanlayer-model'
const OPENROUTER_MODEL_KEY = 'humanlayer-openrouter-model'
const BASETEN_MODEL_KEY = 'humanlayer-baseten-model'

// Helper function to get saved provider
const getSavedProvider = (): 'anthropic' | 'openrouter' | 'baseten' => {
  const stored = localStorage.getItem(PROVIDER_KEY)
  if (stored === 'openrouter' || stored === 'baseten') {
    return stored
  }
  return 'anthropic' // Default to Anthropic
}

// Helper function to get saved model based on provider
const getSavedModel = (provider: 'anthropic' | 'openrouter' | 'baseten'): string | undefined => {
  if (provider === 'anthropic') {
    return localStorage.getItem(MODEL_KEY) || undefined
  } else if (provider === 'openrouter') {
    return localStorage.getItem(OPENROUTER_MODEL_KEY) || undefined
  } else if (provider === 'baseten') {
    return localStorage.getItem(BASETEN_MODEL_KEY) || undefined
  }
  return undefined
}

// Helper function to clear all saved model preferences
export const clearSavedModelPreferences = (): void => {
  localStorage.removeItem(PROVIDER_KEY)
  localStorage.removeItem(MODEL_KEY)
  localStorage.removeItem(OPENROUTER_MODEL_KEY)
  localStorage.removeItem(BASETEN_MODEL_KEY)
}

// Export localStorage key helpers (used by other components)
export const getLastWorkingDir = () => localStorage.getItem(LAST_WORKING_DIR_KEY)
export const setLastWorkingDir = (dir: string) => localStorage.setItem(LAST_WORKING_DIR_KEY, dir)

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

// Helper function to get saved additional directories
const getSavedAdditionalDirectories = (): string[] => {
  const stored = localStorage.getItem(ADDITIONAL_DIRECTORIES_KEY)
  if (!stored) return []

  try {
    const parsed = JSON.parse(stored)
    // Ensure we have an array of strings
    if (Array.isArray(parsed)) {
      return parsed.filter(item => typeof item === 'string')
    }
    return []
  } catch {
    // If parsing fails, return empty array
    return []
  }
}

export const useSessionLauncher = create<LauncherState>((set, get) => ({
  isOpen: false,
  mode: 'command',
  view: 'menu',
  query: getSavedQuery(),
  config: {
    workingDir: getDefaultWorkingDir(),
    provider: getSavedProvider(),
    model: getSavedModel(getSavedProvider()),
    openRouterApiKey: getSavedOpenRouterKey(),
    basetenApiKey: getSavedBasetenKey(),
    additionalDirectories: getSavedAdditionalDirectories(),
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
    const savedProvider = getSavedProvider()
    set({
      isOpen: false,
      view: 'menu',
      query: savedQuery,
      config: {
        workingDir: getDefaultWorkingDir(),
        provider: savedProvider,
        model: getSavedModel(savedProvider),
        openRouterApiKey: getSavedOpenRouterKey(),
        basetenApiKey: getSavedBasetenKey(),
        additionalDirectories: getSavedAdditionalDirectories(),
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
    // Save provider if it changed
    if (config.provider) {
      localStorage.setItem(PROVIDER_KEY, config.provider)
    }

    // Save model based on provider
    if (config.model !== undefined) {
      const modelKey =
        config.provider === 'anthropic'
          ? MODEL_KEY
          : config.provider === 'openrouter'
            ? OPENROUTER_MODEL_KEY
            : config.provider === 'baseten'
              ? BASETEN_MODEL_KEY
              : null

      if (modelKey) {
        if (config.model) {
          localStorage.setItem(modelKey, config.model)
        } else {
          localStorage.removeItem(modelKey)
        }
      }
    }

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
    // Save or remove additional directories from localStorage
    if (config.additionalDirectories && config.additionalDirectories.length > 0) {
      localStorage.setItem(ADDITIONAL_DIRECTORIES_KEY, JSON.stringify(config.additionalDirectories))
    } else if (
      config.additionalDirectories === undefined ||
      config.additionalDirectories === null ||
      (Array.isArray(config.additionalDirectories) && config.additionalDirectories.length === 0)
    ) {
      // Remove from localStorage when cleared to avoid stale state
      localStorage.removeItem(ADDITIONAL_DIRECTORIES_KEY)
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

    // Validate additional directories if provided
    if (config.additionalDirectories && config.additionalDirectories.length > 0) {
      for (const dir of config.additionalDirectories) {
        try {
          // Expand ~ to home directory
          let pathToCheck = dir
          if (pathToCheck.startsWith('~')) {
            const home = await homeDir()
            pathToCheck = pathToCheck.replace(/^~(?=$|\/|\\)/, home)
          }

          // Check if the path exists
          const pathExists = await exists(pathToCheck)
          if (!pathExists) {
            set({ error: `Additional directory does not exist: ${dir}` })
            return
          }
        } catch (err) {
          set({ error: `Error checking additional directory ${dir}: ${err}` })
          return
        }
      }
    }

    try {
      set({ isLaunching: true, error: undefined })

      // MCP config is now injected by daemon

      console.log('Config before launch:', config)
      console.log('Additional directories:', config.additionalDirectories)

      const request: LaunchSessionRequest = {
        query: query.trim(),
        title: config.title || undefined,
        working_dir: config.workingDir || undefined,
        additional_directories: config.additionalDirectories || undefined,
        provider: config.provider || 'anthropic',
        model: config.model || undefined,
        max_turns: config.maxTurns || undefined,
        // MCP config is now injected by daemon
        permission_prompt_tool: 'mcp__codelayer__request_permission',
        // Add OpenRouter proxy configuration if provider is openrouter
        ...(config.provider === 'openrouter' && config.openRouterApiKey
          ? {
              proxy_enabled: true,
              proxy_base_url: 'https://openrouter.ai/api/v1',
              proxy_model_override: config.model || 'openai/gpt-4o-mini',
              proxy_api_key: config.openRouterApiKey,
            }
          : {}),
        // Add Baseten proxy configuration if provider is baseten
        ...(config.provider === 'baseten' && config.basetenApiKey
          ? {
              proxy_enabled: true,
              proxy_base_url: 'https://inference.baseten.co/v1',
              proxy_model_override: config.model || 'deepseek-ai/DeepSeek-V3.1',
              proxy_api_key: config.basetenApiKey,
            }
          : {}),
      }

      console.log('Launch request:', request)
      console.log('Launch request additional_directories specifically:', request.additional_directories)

      const response = await daemonClient.launchSession(request)

      // Save the working directory to localStorage for next time
      if (config.workingDir) {
        localStorage.setItem(LAST_WORKING_DIR_KEY, config.workingDir)
      }

      // Clear the saved query after successful launch
      localStorage.removeItem(SESSION_LAUNCHER_QUERY_KEY)

      // Clear the saved additional directories after successful launch (matching query behavior)
      localStorage.removeItem(ADDITIONAL_DIRECTORIES_KEY)

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

  createNewSession: async () => {
    // Create draft session and navigate directly
    try {
      const response = await daemonClient.launchSession({
        query: '', // Empty initial query for draft
        working_dir: getLastWorkingDir() || '~/',
        draft: true, // Create as draft
      })

      // Refresh sessions to include the new draft
      await useStore.getState().refreshSessions()

      // Close the command palette
      get().close()

      // Navigate directly to SessionDetail
      window.location.hash = `#/sessions/${response.sessionId}`
    } catch (error) {
      logger.error('Failed to create draft session:', error)
      set({ error: 'Failed to create draft session' })
    }
  },

  openSessionById: (sessionId: string) => {
    // Navigate to existing session
    window.location.hash = `#/sessions/${sessionId}`
    get().close()
  },

  reset: () => {
    const savedQuery = getSavedQuery()
    const savedProvider = getSavedProvider()
    return set({
      isOpen: false,
      mode: 'command',
      view: 'menu',
      query: savedQuery,
      config: {
        workingDir: getDefaultWorkingDir(),
        provider: savedProvider,
        model: getSavedModel(savedProvider),
        openRouterApiKey: getSavedOpenRouterKey(),
        basetenApiKey: getSavedBasetenKey(),
        additionalDirectories: getSavedAdditionalDirectories(),
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
  const { open, close, isOpen, setGPrefixMode } = useSessionLauncher()

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

  // Cmd+K - Command palette (root scope)
  useHotkeys(
    'meta+k, ctrl+k',
    () => {
      if (!isOpen) {
        open()
      } else {
        close()
      }
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      preventDefault: true,
    },
  )

  // C - Navigate to new draft session route (root scope)
  useHotkeys(
    'c',
    () => {
      // Navigate to draft route without creating a session
      // The draft will be created lazily when user starts typing
      window.location.hash = '/sessions/draft'
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      enabled: !isTypingInInput(),
      preventDefault: true,
    },
  )

  // G - G prefix mode (root scope)
  useHotkeys(
    'g',
    () => {
      setGPrefixMode(true)
      setTimeout(() => setGPrefixMode(false), 2000)
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      enabled: !isTypingInInput(),
      preventDefault: true,
    },
  )

  // Note: G>S, G>E, G>I are already handled in Layout.tsx with the new scope system
  // They don't need to be duplicated here

  // For backward compatibility, return an empty handleKeyDown
  // This can be removed once Layout.tsx is updated to not use it
  return {
    handleKeyDown: () => {
      // No-op - hotkeys are now handled via useHotkeys with proper scopes
    },
  }
}
