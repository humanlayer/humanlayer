import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'
import type { LaunchSessionRequest } from '@/lib/daemon/types'

interface ParsedQuery {
  query: string
  workingDir?: string
}

interface LauncherState {
  isOpen: boolean
  query: string
  isLaunching: boolean
  error?: string
  
  // Actions
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  launchSession: () => Promise<void>
  reset: () => void
}

// Parse query for working directory patterns
function parseQuery(input: string): ParsedQuery {
  const trimmed = input.trim()
  
  // Check if query starts with a path pattern like "/src" or "./path"
  const pathMatch = trimmed.match(/^(\/[^\s]*|\.\/[^\s]*)\s*(.*)$/)
  
  if (pathMatch) {
    return {
      workingDir: pathMatch[1],
      query: pathMatch[2].trim()
    }
  }
  
  return {
    query: trimmed
  }
}

export const useSessionLauncher = create<LauncherState>((set, get) => ({
  isOpen: false,
  query: '',
  isLaunching: false,
  error: undefined,
  
  open: () => set({ isOpen: true }),
  
  close: () => set({ 
    isOpen: false, 
    query: '', 
    error: undefined,
    isLaunching: false 
  }),
  
  setQuery: (query: string) => set({ query, error: undefined }),
  
  reset: () => set({ 
    query: '', 
    error: undefined, 
    isLaunching: false 
  }),
  
  launchSession: async () => {
    const state = get()
    if (!state.query.trim()) {
      set({ error: 'Please enter a query to launch a session' })
      return
    }
    
    try {
      set({ isLaunching: true, error: undefined })
      
      const parsed = parseQuery(state.query)
      const request: LaunchSessionRequest = {
        query: parsed.query,
        working_dir: parsed.workingDir
      }
      
      const response = await daemonClient.launchSession(request)
      
      // Success - the session was launched
      // Navigation will be handled by the component using this hook
      console.log('Session launched successfully:', response)
      
      // Close the launcher and reset state
      state.close()
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to launch session'
      set({ error: errorMessage })
    } finally {
      set({ isLaunching: false })
    }
  }
}))