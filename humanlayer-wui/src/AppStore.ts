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
  selectRange: (anchorId: string, targetId: string) => void
  addRangeToSelection: (anchorId: string, targetId: string) => void
  updateCurrentRange: (anchorId: string, targetId: string) => void
  bulkSelect: (sessionId: string, direction: 'asc' | 'desc') => void

  /* Notifications */
  notifiedItems: Set<string> // Set of unique notification IDs
  addNotifiedItem: (notificationId: string) => void
  removeNotifiedItem: (notificationId: string) => void
  isItemNotified: (notificationId: string) => boolean
  clearNotificationsForSession: (sessionId: string) => void

  /* Navigation tracking */
  recentNavigations: Map<string, number> // sessionId -> timestamp
  trackNavigationFrom: (sessionId: string) => void
  wasRecentlyNavigatedFrom: (sessionId: string, withinMs?: number) => boolean

  /* UI State */
  isHotkeyPanelOpen: boolean
  setHotkeyPanelOpen: (open: boolean) => void
}

export const useStore = create<StoreState>((set, get) => ({
  sessions: [],
  focusedSession: null,
  viewMode: ViewMode.Normal,
  selectedSessions: new Set<string>(),
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
  selectRange: (anchorId: string, targetId: string) =>
    set(state => {
      const { sessions } = state
      const anchorIndex = sessions.findIndex(s => s.id === anchorId)
      const targetIndex = sessions.findIndex(s => s.id === targetId)

      console.log('[Store] selectRange (REPLACE):', {
        anchorId,
        targetId,
        anchorIndex,
        targetIndex,
        previousSelectionsSize: state.selectedSessions.size,
      })

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

      console.log('[Store] selectRange result:', {
        newSelectionSize: newSelection.size,
        newSelectionIds: Array.from(newSelection),
      })

      return { selectedSessions: newSelection }
    }),
  addRangeToSelection: (anchorId: string, targetId: string) =>
    set(state => {
      const { sessions, selectedSessions } = state
      const anchorIndex = sessions.findIndex(s => s.id === anchorId)
      const targetIndex = sessions.findIndex(s => s.id === targetId)

      console.log('[Store] addRangeToSelection (ADD):', {
        anchorId,
        targetId,
        anchorIndex,
        targetIndex,
        previousSelectionsSize: state.selectedSessions.size,
        previousSelectionIds: Array.from(state.selectedSessions),
      })

      if (anchorIndex === -1 || targetIndex === -1) {
        return state // Return unchanged if sessions not found
      }

      // Determine the range (handle both directions)
      const startIndex = Math.min(anchorIndex, targetIndex)
      const endIndex = Math.max(anchorIndex, targetIndex)

      // Start with existing selections
      const newSelection = new Set(selectedSessions)

      // Add all sessions in the new range
      for (let i = startIndex; i <= endIndex; i++) {
        newSelection.add(sessions[i].id)
      }

      console.log('[Store] addRangeToSelection result:', {
        newSelectionSize: newSelection.size,
        newSelectionIds: Array.from(newSelection),
      })

      return { selectedSessions: newSelection }
    }),
  updateCurrentRange: (anchorId: string, targetId: string) =>
    set(state => {
      const { sessions, selectedSessions } = state
      const anchorIndex = sessions.findIndex(s => s.id === anchorId)
      const targetIndex = sessions.findIndex(s => s.id === targetId)

      console.log('[Store] updateCurrentRange:', {
        anchorId,
        targetId,
        anchorIndex,
        targetIndex,
        previousSelectionsSize: selectedSessions.size,
      })

      if (anchorIndex === -1 || targetIndex === -1) {
        return state // Return unchanged if sessions not found
      }

      // Find which sessions belong to the "current" range
      // (the range being modified by the current shift+j/k sequence) and update only those

      // Find the extent of the current range by looking for contiguous selections around the anchor
      let rangeStart = anchorIndex
      let rangeEnd = anchorIndex

      // Find the boundaries of the current selection range that includes the anchor
      for (let i = anchorIndex - 1; i >= 0; i--) {
        if (selectedSessions.has(sessions[i].id)) {
          rangeStart = i
        } else {
          break
        }
      }

      for (let i = anchorIndex + 1; i < sessions.length; i++) {
        if (selectedSessions.has(sessions[i].id)) {
          rangeEnd = i
        } else {
          break
        }
      }

      // Create new selection preserving everything outside the current range
      const newSelection = new Set<string>()

      // Add all selections outside the current range
      selectedSessions.forEach(id => {
        const index = sessions.findIndex(s => s.id === id)
        if (index !== -1 && (index < rangeStart || index > rangeEnd)) {
          newSelection.add(id)
        }
      })

      // Add the new range from anchor to target
      const newRangeStart = Math.min(anchorIndex, targetIndex)
      const newRangeEnd = Math.max(anchorIndex, targetIndex)

      for (let i = newRangeStart; i <= newRangeEnd; i++) {
        newSelection.add(sessions[i].id)
      }

      console.log('[Store] updateCurrentRange result:', {
        newSelectionSize: newSelection.size,
        newSelectionIds: Array.from(newSelection),
        currentRange: `${rangeStart}-${rangeEnd}`,
        newRange: `${newRangeStart}-${newRangeEnd}`,
      })

      return { selectedSessions: newSelection }
    }),
  bulkSelect: (sessionId: string, direction: 'asc' | 'desc') => {
    const state = get()
    const { sessions, selectedSessions } = state
    const currentIndex = sessions.findIndex(s => s.id === sessionId)
    if (currentIndex === -1) return

    // Calculate the target index based on direction
    const targetIndex = direction === 'desc' ? currentIndex + 1 : currentIndex - 1

    // Check boundaries
    if (targetIndex < 0 || targetIndex >= sessions.length) return

    // Get the target session
    const targetSession = sessions[targetIndex]

    // Check if we're starting within an existing selection
    const isStartingInSelection = selectedSessions.has(sessionId)

    console.log(
      `[bulkSelect] sessionId: ${sessionId}, direction: ${direction}, isStartingInSelection: ${isStartingInSelection}`,
    )

    if (isStartingInSelection && selectedSessions.size > 0) {
      // Find the contiguous range that includes current position
      let rangeStart = currentIndex
      let rangeEnd = currentIndex

      // Look backwards for contiguous selections
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (selectedSessions.has(sessions[i].id)) {
          rangeStart = i
        } else {
          break
        }
      }

      // Look forwards for contiguous selections
      for (let i = currentIndex + 1; i < sessions.length; i++) {
        if (selectedSessions.has(sessions[i].id)) {
          rangeEnd = i
        } else {
          break
        }
      }

      // When in a contiguous selection, the anchor should be at the opposite
      // end from where we currently are. This creates the "pivot" behavior.
      // If we're at the start of the range, anchor is at the end
      // If we're at the end of the range, anchor is at the start
      // If we're in the middle, use direction to determine anchor
      let anchorIndex: number

      if (currentIndex === rangeStart) {
        // We're at the start, so anchor at the end
        anchorIndex = rangeEnd
      } else if (currentIndex === rangeEnd) {
        // We're at the end, so anchor at the start
        anchorIndex = rangeStart
      } else {
        // We're in the middle, use direction-based logic
        anchorIndex = direction === 'desc' ? rangeStart : rangeEnd
      }

      const anchorId = sessions[anchorIndex].id

      console.log(
        `[bulkSelect] Starting in selection, found range: ${rangeStart}-${rangeEnd}, anchor at ${anchorIndex}`,
      )

      // Use updateCurrentRange to modify the existing range
      state.updateCurrentRange(anchorId, targetSession.id)
    } else if (selectedSessions.size > 0 && !isStartingInSelection) {
      // We have selections but starting fresh - add to existing
      console.log('[bulkSelect] Adding new range to existing selections')
      state.addRangeToSelection(sessionId, targetSession.id)
    } else {
      // No selections or replacing - create new range
      console.log('[bulkSelect] Creating new selection range')
      state.selectRange(sessionId, targetSession.id)
    }

    // Update focused session
    set({ focusedSession: targetSession })
  },

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

  // Navigation tracking
  recentNavigations: new Map(),
  trackNavigationFrom: (sessionId: string) =>
    set(state => {
      const newMap = new Map(state.recentNavigations)
      const timestamp = Date.now()
      newMap.set(sessionId, timestamp)
      console.log(
        `Tracking navigation from session ${sessionId} at ${new Date(timestamp).toISOString()}`,
      )

      // Clean up old entries after 5 seconds
      setTimeout(() => {
        const currentMap = get().recentNavigations
        if (currentMap.get(sessionId) === newMap.get(sessionId)) {
          const updatedMap = new Map(currentMap)
          updatedMap.delete(sessionId)
          set({ recentNavigations: updatedMap })
          console.log(`Removed navigation tracking for session ${sessionId} after timeout`)
        }
      }, 5000)
      return { recentNavigations: newMap }
    }),
  wasRecentlyNavigatedFrom: (sessionId: string, withinMs = 3000) => {
    const timestamp = get().recentNavigations.get(sessionId)
    const now = Date.now()

    if (!timestamp) {
      console.log(`No navigation tracking found for session ${sessionId}`)
      return false
    }

    const elapsed = now - timestamp
    const wasRecent = elapsed < withinMs
    console.log(
      `Checking navigation for session ${sessionId}: elapsed ${elapsed}ms, within ${withinMs}ms window: ${wasRecent}`,
    )
    return wasRecent
  },

  // UI State
  isHotkeyPanelOpen: false,
  setHotkeyPanelOpen: (open: boolean) => set({ isHotkeyPanelOpen: open }),
}))
