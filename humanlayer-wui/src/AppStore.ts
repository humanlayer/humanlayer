import type { SessionInfo } from '@/lib/daemon/types'
import { ViewMode } from '@/lib/daemon/types'
import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'

interface StoreState {
  /* Sessions */
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  viewMode: ViewMode
  selectedSessions: Set<string> // For bulk selection
  selectionAnchor: string | null // Anchor point for range selection
  initSessions: (sessions: SessionInfo[]) => void
  updateSession: (sessionId: string, updates: Partial<SessionInfo>) => void
  refreshSessions: () => Promise<void>
  setFocusedSession: (session: SessionInfo | null) => void
  focusNextSession: () => void
  focusPreviousSession: () => void
  interruptSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string, archived: boolean) => Promise<void>
  bulkArchiveSessions: (sessionIds: string[], archived: boolean) => Promise<void>
  setViewMode: (mode: ViewMode) => void
  toggleSessionSelection: (sessionId: string) => void
  clearSelection: () => void
  setSelectionAnchor: (sessionId: string | null) => void
  clearSelectionAnchor: () => void
  selectRange: (anchorId: string, targetId: string) => void

  /* Notifications */
  notifiedItems: Set<string> // Set of unique notification IDs
  addNotifiedItem: (notificationId: string) => void
  removeNotifiedItem: (notificationId: string) => void
  isItemNotified: (notificationId: string) => boolean
  clearNotificationsForSession: (sessionId: string) => void
}

export const useStore = create<StoreState>((set, get) => ({
  sessions: [],
  focusedSession: null,
  viewMode: ViewMode.Normal,
  selectedSessions: new Set<string>(),
  selectionAnchor: null,
  initSessions: (sessions: SessionInfo[]) => set({ sessions }),
  updateSession: (sessionId: string, updates: Partial<SessionInfo>) =>
    set(state => ({
      sessions: state.sessions.map(session =>
        session.id === sessionId ? { ...session, ...updates } : session,
      ),
      focusedSession:
        state.focusedSession?.id === sessionId
          ? { ...state.focusedSession, ...updates }
          : state.focusedSession,
    })),
  refreshSessions: async () => {
    try {
      const { viewMode } = get()
      const response = await daemonClient.getSessionLeaves({
        include_archived: viewMode === ViewMode.Archived,
        archived_only: viewMode === ViewMode.Archived,
      })
      set({ sessions: response.sessions })
    } catch (error) {
      console.error('Failed to refresh sessions:', error)
    }
  },
  setFocusedSession: (session: SessionInfo | null) => set({ focusedSession: session }),
  focusNextSession: () =>
    set(state => {
      const { sessions, focusedSession } = state
      if (sessions.length === 0) return state

      const currentIndex = focusedSession ? sessions.findIndex(s => s.id === focusedSession.id) : -1

      // If no session is focused or we're at the last session, focus the first session
      if (currentIndex === -1 || currentIndex === sessions.length - 1) {
        return { focusedSession: sessions[0] }
      }

      // Focus the next session
      return { focusedSession: sessions[currentIndex + 1] }
    }),
  focusPreviousSession: () =>
    set(state => {
      const { sessions, focusedSession } = state
      if (sessions.length === 0) return state

      const currentIndex = focusedSession ? sessions.findIndex(s => s.id === focusedSession.id) : -1

      // If no session is focused or we're at the first session, focus the last session
      if (currentIndex === -1 || currentIndex === 0) {
        return { focusedSession: sessions[sessions.length - 1] }
      }

      // Focus the previous session
      return { focusedSession: sessions[currentIndex - 1] }
    }),
  interruptSession: async (sessionId: string) => {
    try {
      await daemonClient.interruptSession(sessionId)
      // The session status will be updated via the subscription
    } catch (error) {
      console.error('Failed to interrupt session:', error)
    }
  },
  archiveSession: async (sessionId: string, archived: boolean) => {
    try {
      await daemonClient.archiveSession({ session_id: sessionId, archived })
      // Update local state immediately for better UX
      get().updateSession(sessionId, { archived })
      // Refresh sessions to update the list based on current view mode
      await get().refreshSessions()
    } catch (error) {
      console.error('Failed to archive session:', error)
      throw error
    }
  },
  bulkArchiveSessions: async (sessionIds: string[], archived: boolean) => {
    try {
      const response = await daemonClient.bulkArchiveSessions({ session_ids: sessionIds, archived })
      if (!response.success && response.failed_sessions) {
        console.error('Some sessions failed to archive:', response.failed_sessions)
      }
      // Refresh sessions to update the list
      await get().refreshSessions()
      // Clear selection after bulk operation
      get().clearSelection()
    } catch (error) {
      console.error('Failed to bulk archive sessions:', error)
      throw error
    }
  },
  setViewMode: (mode: ViewMode) => {
    set({ viewMode: mode })
    // Refresh sessions when view mode changes
    get().refreshSessions()
  },
  toggleSessionSelection: (sessionId: string) =>
    set(state => {
      const newSet = new Set(state.selectedSessions)
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId)
      } else {
        newSet.add(sessionId)
      }
      return { selectedSessions: newSet }
    }),
  clearSelection: () => set({ selectedSessions: new Set<string>() }),
  setSelectionAnchor: (sessionId: string | null) => set({ selectionAnchor: sessionId }),
  clearSelectionAnchor: () => set({ selectionAnchor: null }),
  selectRange: (anchorId: string, targetId: string) =>
    set(state => {
      const { sessions } = state
      const anchorIndex = sessions.findIndex(s => s.id === anchorId)
      const targetIndex = sessions.findIndex(s => s.id === targetId)

      if (anchorIndex === -1 || targetIndex === -1) {
        return state // Return unchanged if sessions not found
      }

      // Determine the range (handle both directions)
      const startIndex = Math.min(anchorIndex, targetIndex)
      const endIndex = Math.max(anchorIndex, targetIndex)

      // Select all sessions in the range
      const newSelection = new Set<string>()
      for (let i = startIndex; i <= endIndex; i++) {
        newSelection.add(sessions[i].id)
      }

      return { selectedSessions: newSelection }
    }),

  // Notification management
  notifiedItems: new Set<string>(),
  addNotifiedItem: (notificationId: string) =>
    set(state => ({
      notifiedItems: new Set(state.notifiedItems).add(notificationId),
    })),
  removeNotifiedItem: (notificationId: string) =>
    set(state => {
      const newSet = new Set(state.notifiedItems)
      newSet.delete(notificationId)
      return { notifiedItems: newSet }
    }),
  isItemNotified: (notificationId: string) => {
    return get().notifiedItems.has(notificationId)
  },
  clearNotificationsForSession: (sessionId: string) =>
    set(state => {
      const newSet = new Set<string>()
      // Keep notifications that don't belong to this session
      state.notifiedItems.forEach(id => {
        if (!id.includes(sessionId)) {
          newSet.add(id)
        }
      })
      return { notifiedItems: newSet }
    }),
}))
