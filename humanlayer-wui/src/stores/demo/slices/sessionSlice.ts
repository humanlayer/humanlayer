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
  
  // Navigation actions
  focusNextSession: () => void
  focusPreviousSession: () => void
  
  // Utility actions
  findSessionById: (id: string) => SessionInfo | undefined
  getSessionCount: () => number
  hasSession: (id: string) => boolean
}

export const createSessionSlice: StateCreator<
  SessionSlice,
  [],
  [],
  SessionSlice
> = (set, get) => ({
  // Initial state
  sessions: [],
  focusedSession: null,
  searchQuery: '',
  
  // Basic setters
  setSessions: (sessions) => set({ sessions }),
  setFocusedSession: (session) => set({ focusedSession: session }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  
  // Session CRUD operations
  addSession: (session) => set((state) => ({ 
    sessions: [...state.sessions, session] 
  })),
  
  updateSession: (id, updates) => set((state) => ({
    sessions: state.sessions.map(s => 
      s.id === id ? { ...s, ...updates } : s
    ),
    focusedSession: state.focusedSession?.id === id 
      ? { ...state.focusedSession, ...updates }
      : state.focusedSession
  })),
  
  removeSession: (id) => set((state) => ({
    sessions: state.sessions.filter(s => s.id !== id),
    focusedSession: state.focusedSession?.id === id ? null : state.focusedSession
  })),
  
  clearSessions: () => set({ sessions: [], focusedSession: null }),
  
  // Navigation actions
  focusNextSession: () => set((state) => {
    const { sessions, focusedSession } = state
    if (sessions.length === 0) return state

    const currentIndex = focusedSession 
      ? sessions.findIndex(s => s.id === focusedSession.id) 
      : -1

    // If no session is focused or we're at the last session, focus the first session
    if (currentIndex === -1 || currentIndex === sessions.length - 1) {
      return { focusedSession: sessions[0] }
    }

    // Focus the next session
    return { focusedSession: sessions[currentIndex + 1] }
  }),
  
  focusPreviousSession: () => set((state) => {
    const { sessions, focusedSession } = state
    if (sessions.length === 0) return state

    const currentIndex = focusedSession 
      ? sessions.findIndex(s => s.id === focusedSession.id) 
      : -1

    // If no session is focused or we're at the first session, focus the last session
    if (currentIndex === -1 || currentIndex === 0) {
      return { focusedSession: sessions[sessions.length - 1] }
    }

    // Focus the previous session
    return { focusedSession: sessions[currentIndex - 1] }
  }),
  
  // Utility methods
  findSessionById: (id) => {
    const state = get()
    return state.sessions.find(s => s.id === id)
  },
  
  getSessionCount: () => {
    const state = get()
    return state.sessions.length
  },
  
  hasSession: (id) => {
    const state = get()
    return state.sessions.some(s => s.id === id)
  }
})