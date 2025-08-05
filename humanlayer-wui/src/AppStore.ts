import type { Session, SessionStatus } from '@/lib/daemon/types'
import { ViewMode } from '@/lib/daemon/types'
import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'
import { logger } from '@/lib/logging'

interface StoreState {
  /* Sessions */
  sessions: Session[]
  focusedSession: Session | null
  viewMode: ViewMode
  selectedSessions: Set<string> // For bulk selection
  activeSessionDetail: {
    session: Session
    conversation: any[] // ConversationEvent[] from useConversation
    loading: boolean
    error: string | null
  } | null

  initSessions: (sessions: Session[]) => void
  updateSession: (sessionId: string, updates: Partial<Session>) => void
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void
  refreshSessions: () => Promise<void>
  setFocusedSession: (session: Session | null) => void
  focusNextSession: () => void
  focusPreviousSession: () => void
  interruptSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string, archived: boolean) => Promise<void>
  bulkArchiveSessions: (sessionIds: string[], archived: boolean) => Promise<void>
  bulkSetAutoAcceptEdits: (sessionIds: string[], autoAcceptEdits: boolean) => Promise<void>
  setViewMode: (mode: ViewMode) => void
  toggleSessionSelection: (sessionId: string) => void
  clearSelection: () => void
  selectRange: (anchorId: string, targetId: string) => void
  addRangeToSelection: (anchorId: string, targetId: string) => void
  updateCurrentRange: (anchorId: string, targetId: string) => void
  bulkSelect: (sessionId: string, direction: 'asc' | 'desc') => void
  refreshActiveSessionConversation: (sessionId: string) => Promise<void>

  /* Active Session Detail Actions */
  setActiveSessionDetail: (sessionId: string, session: Session, conversation: any[]) => void
  updateActiveSessionDetail: (updates: Partial<Session>) => void
  updateActiveSessionConversation: (conversation: any[]) => void
  clearActiveSessionDetail: () => void
  fetchActiveSessionDetail: (sessionId: string) => Promise<void>

  /* Notifications */
  notifiedItems: Set<string> // Set of unique notification IDs
  addNotifiedItem: (notificationId: string) => void
  removeNotifiedItem: (notificationId: string) => void
  isItemNotified: (notificationId: string) => boolean
  clearNotificationsForSession: (sessionId: string) => void

  recentResolvedApprovalsCache: Set<string>
  addRecentResolvedApprovalToCache: (approvalId: string) => void
  isRecentResolvedApproval: (approvalId: string) => boolean

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
  activeSessionDetail: null,
  initSessions: (sessions: Session[]) => set({ sessions }),
  updateSession: (sessionId: string, updates: Partial<Session>) =>
    set(state => ({
      sessions: state.sessions.map(session =>
        session.id === sessionId ? { ...session, ...updates } : session,
      ),
      focusedSession:
        state.focusedSession?.id === sessionId
          ? { ...state.focusedSession, ...updates }
          : state.focusedSession,
      // Also update activeSessionDetail if it matches
      activeSessionDetail:
        state.activeSessionDetail?.session.id === sessionId
          ? {
              ...state.activeSessionDetail,
              session: { ...state.activeSessionDetail.session, ...updates },
            }
          : state.activeSessionDetail,
    })),
  updateSessionStatus: (sessionId: string, status: string) =>
    set(state => ({
      sessions: state.sessions.map(session =>
        session.id === sessionId ? { ...session, status: status as any } : session,
      ),
      focusedSession:
        state.focusedSession?.id === sessionId
          ? { ...state.focusedSession, status: status as any }
          : state.focusedSession,
      // Also update activeSessionDetail if it matches
      activeSessionDetail:
        state.activeSessionDetail?.session.id === sessionId
          ? {
              ...state.activeSessionDetail,
              session: { ...state.activeSessionDetail.session, status: status as any },
            }
          : state.activeSessionDetail,
    })),
  refreshSessions: async () => {
    try {
      const { viewMode, sessions: currentSessions } = get()
      const response = await daemonClient.getSessionLeaves({
        include_archived: viewMode === ViewMode.Archived,
        archived_only: viewMode === ViewMode.Archived,
      })

      // Preserve local runtime state (yolo mode) when refreshing
      const updatedSessions = response.sessions.map(newSession => {
        const existingSession = currentSessions.find(s => s.id === newSession.id)
        if (existingSession) {
          // Preserve yolo mode state from existing session
          return {
            ...newSession,
            dangerously_skip_permissions: existingSession.dangerously_skip_permissions,
            dangerously_skip_permissions_expires_at:
              existingSession.dangerously_skip_permissions_expires_at,
            autoAcceptEdits: existingSession.autoAcceptEdits,
          }
        }
        return newSession
      })

      set({ sessions: updatedSessions })
    } catch (error) {
      logger.error('Failed to refresh sessions:', error)
    }
  },
  refreshActiveSessionConversation: async (sessionId: string) => {
    // const response = await daemonClient.getConversation({ session_id: sessionId })
    // set({ activeSessionDetail: { ...get().activeSessionDetail, conversation: response } })
    const { activeSessionDetail, updateActiveSessionConversation } = get()

    if (activeSessionDetail?.session.id === sessionId) {
      try {
        const conversationResponse = await daemonClient.getConversation({ session_id: sessionId })
        updateActiveSessionConversation(conversationResponse)
      } catch (error) {
        logger.error('Failed to refresh active session conversation:', error)
      }
    }
  },
  setFocusedSession: (session: Session | null) => set({ focusedSession: session }),
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
      logger.error('Failed to interrupt session:', error)
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
      logger.error('Failed to archive session:', error)
      throw error
    }
  },
  bulkArchiveSessions: async (sessionIds: string[], archived: boolean) => {
    try {
      const response = await daemonClient.bulkArchiveSessions({ session_ids: sessionIds, archived })
      if (!response.success) {
        logger.error('Failed to archive sessions')
      }
      // Refresh sessions to update the list
      await get().refreshSessions()
      // Clear selection after bulk operation
      get().clearSelection()
    } catch (error) {
      logger.error('Failed to bulk archive sessions:', error)
      throw error
    }
  },
  bulkSetAutoAcceptEdits: async (sessionIds: string[], autoAcceptEdits: boolean) => {
    try {
      const results = await Promise.allSettled(
        sessionIds.map(sessionId =>
          daemonClient.updateSessionSettings(sessionId, { auto_accept_edits: autoAcceptEdits }),
        ),
      )

      // Check if any failed
      const failedCount = results.filter(r => r.status === 'rejected').length
      if (failedCount > 0) {
        console.error(`Failed to update ${failedCount} sessions`)
        throw new Error(`Failed to update ${failedCount} sessions`)
      }

      // Update local state for all successful sessions
      sessionIds.forEach(sessionId => {
        get().updateSession(sessionId, { autoAcceptEdits })
      })

      // Clear selection after bulk operation
      get().clearSelection()
    } catch (error) {
      console.error('Failed to bulk update auto-accept settings:', error)
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

      logger.log('[Store] selectRange (REPLACE):', {
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

      logger.log('[Store] selectRange result:', {
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

      logger.log('[Store] addRangeToSelection (ADD):', {
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

      logger.log('[Store] addRangeToSelection result:', {
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

      logger.log('[Store] updateCurrentRange:', {
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

      logger.log('[Store] updateCurrentRange result:', {
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

    logger.log(
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

      logger.log(
        `[bulkSelect] Starting in selection, found range: ${rangeStart}-${rangeEnd}, anchor at ${anchorIndex}`,
      )

      // Use updateCurrentRange to modify the existing range
      state.updateCurrentRange(anchorId, targetSession.id)
    } else if (selectedSessions.size > 0 && !isStartingInSelection) {
      // We have selections but starting fresh - add to existing
      logger.log('[bulkSelect] Adding new range to existing selections')
      state.addRangeToSelection(sessionId, targetSession.id)
    } else {
      // No selections or replacing - create new range
      logger.log('[bulkSelect] Creating new selection range')
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

  recentResolvedApprovalsCache: new Set<string>(),
  addRecentResolvedApprovalToCache: (approvalId: string) =>
    set(state => {
      const newSet = new Set(state.recentResolvedApprovalsCache)
      newSet.add(approvalId)

      // Limit to 50 items by converting to array, slicing, and converting back to Set
      const limitedSet = new Set(Array.from(newSet).slice(-50))

      return { recentResolvedApprovalsCache: limitedSet }
    }),
  isRecentResolvedApproval: (approvalId: string) => {
    return get().recentResolvedApprovalsCache.has(approvalId)
  },

  // Navigation tracking
  recentNavigations: new Map(),
  trackNavigationFrom: (sessionId: string) =>
    set(state => {
      const newMap = new Map(state.recentNavigations)
      const timestamp = Date.now()
      newMap.set(sessionId, timestamp)
      logger.log(
        `Tracking navigation from session ${sessionId} at ${new Date(timestamp).toISOString()}`,
      )

      // Clean up old entries after 5 seconds
      setTimeout(() => {
        const currentMap = get().recentNavigations
        if (currentMap.get(sessionId) === newMap.get(sessionId)) {
          const updatedMap = new Map(currentMap)
          updatedMap.delete(sessionId)
          set({ recentNavigations: updatedMap })
          logger.log(`Removed navigation tracking for session ${sessionId} after timeout`)
        }
      }, 5000)
      return { recentNavigations: newMap }
    }),
  wasRecentlyNavigatedFrom: (sessionId: string, withinMs = 3000) => {
    const timestamp = get().recentNavigations.get(sessionId)
    const now = Date.now()

    if (!timestamp) {
      logger.log(`No navigation tracking found for session ${sessionId}`)
      return false
    }

    const elapsed = now - timestamp
    const wasRecent = elapsed < withinMs
    logger.log(
      `Checking navigation for session ${sessionId}: elapsed ${elapsed}ms, within ${withinMs}ms window: ${wasRecent}`,
    )
    return wasRecent
  },

  // Active Session Detail Actions
  setActiveSessionDetail: (_sessionId: string, session: Session, conversation: any[]) =>
    set({ activeSessionDetail: { session, conversation, loading: false, error: null } }),
  updateActiveSessionDetail: (updates: Partial<Session>) =>
    set(state => ({
      activeSessionDetail: state.activeSessionDetail
        ? {
            ...state.activeSessionDetail,
            session: { ...state.activeSessionDetail.session, ...updates },
          }
        : null,
    })),
  updateActiveSessionConversation: (conversation: any[]) =>
    set(state => ({
      activeSessionDetail: state.activeSessionDetail
        ? {
            ...state.activeSessionDetail,
            conversation,
          }
        : null,
    })),
  clearActiveSessionDetail: () => set({ activeSessionDetail: null }),
  fetchActiveSessionDetail: async (sessionId: string) => {
    // Set loading state
    set({
      activeSessionDetail: {
        session: {} as Session, // Temporary placeholder
        conversation: [],
        loading: true,
        error: null,
      },
    })

    try {
      const [sessionResponse, conversationResponse] = await Promise.all([
        daemonClient.getSessionState(sessionId),
        daemonClient.getConversation({ session_id: sessionId }),
      ])

      set({
        activeSessionDetail: {
          session: sessionResponse.session,
          conversation: conversationResponse,
          loading: false,
          error: null,
        },
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch session detail'
      logger.error('Failed to fetch session detail:', error)

      set({
        activeSessionDetail: {
          session: {} as Session,
          conversation: [],
          loading: false,
          error: errorMessage,
        },
      })
    }
  },

  // UI State
  isHotkeyPanelOpen: false,
  setHotkeyPanelOpen: (open: boolean) => set({ isHotkeyPanelOpen: open }),
}))
