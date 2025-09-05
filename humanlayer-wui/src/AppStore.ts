import type { Session, SessionStatus } from '@/lib/daemon/types'
import { ViewMode } from '@/lib/daemon/types'
import { create } from 'zustand'
import { daemonClient } from '@/lib/daemon'
import { logger } from '@/lib/logging'
import { Editor } from '@tiptap/react'

// Track pending updates for optimistic UI
interface PendingUpdate {
  updates: Partial<Session>
  timestamp: number
  retryCount?: number
}

interface StoreState {
  /* Sessions */
  sessions: Session[]
  focusedSession: Session | null
  viewMode: ViewMode
  selectedSessions: Set<string> // For bulk selection
  pendingUpdates: Map<string, PendingUpdate> // Track in-flight updates
  isRefreshing: boolean // Prevent concurrent refresh/updates
  activeSessionDetail: {
    session: Session
    conversation: any[] // ConversationEvent[] from useConversation
    loading: boolean
    error: string | null
  } | null

  initSessions: (sessions: Session[]) => void
  updateSession: (sessionId: string, updates: Partial<Session>) => void
  updateSessionOptimistic: (sessionId: string, updates: Partial<Session>) => Promise<void>
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
  isSettingsDialogOpen: boolean
  setSettingsDialogOpen: (open: boolean) => void

  /* User Settings */
  userSettings: {
    advancedProviders: boolean
  } | null
  fetchUserSettings: () => Promise<void>
  updateUserSettings: (settings: { advancedProviders: boolean }) => Promise<void>

  /* Claude Configuration */
  claudeConfig: {
    claudePath: string
    claudeDetectedPath?: string
    claudeAvailable: boolean
  } | null
  fetchClaudeConfig: () => Promise<{
    claudePath: string
    claudeDetectedPath?: string
    claudeAvailable: boolean
  } | null>
  updateClaudePath: (path: string) => Promise<{
    claudePath: string
    claudeDetectedPath?: string
    claudeAvailable: boolean
  }>

  /* Response Editor */
  responseEditor: Editor | null
  setResponseEditor: (responseEditor: Editor) => void
  removeResponseEditor: () => void
}

export const useStore = create<StoreState>((set, get) => ({
  sessions: [],
  focusedSession: null,
  viewMode: ViewMode.Normal,
  selectedSessions: new Set<string>(),
  pendingUpdates: new Map<string, PendingUpdate>(),
  isRefreshing: false,
  activeSessionDetail: null,
  claudeConfig: null,
  responseEditor: null,
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
  updateSessionOptimistic: async (sessionId: string, updates: Partial<Session>) => {
    const timestamp = Date.now()

    // Capture original session state before applying optimistic update
    const originalSession = get().sessions.find(s => s.id === sessionId)
    if (!originalSession) {
      logger.error(`Session ${sessionId} not found`)
      throw new Error(`Session ${sessionId} not found`)
    }

    // Apply optimistic update immediately
    set(state => ({
      sessions: state.sessions.map(session =>
        session.id === sessionId ? { ...session, ...updates } : session,
      ),
      pendingUpdates: new Map(state.pendingUpdates).set(sessionId, {
        updates,
        timestamp,
      }),
      focusedSession:
        state.focusedSession?.id === sessionId
          ? { ...state.focusedSession, ...updates }
          : state.focusedSession,
      activeSessionDetail:
        state.activeSessionDetail?.session.id === sessionId
          ? {
              ...state.activeSessionDetail,
              session: { ...state.activeSessionDetail.session, ...updates },
            }
          : state.activeSessionDetail,
    }))

    try {
      // Send to server - map to the fields the API expects
      const apiUpdates: any = {}
      if (updates.autoAcceptEdits !== undefined) {
        apiUpdates.auto_accept_edits = updates.autoAcceptEdits
      }
      if (updates.dangerouslySkipPermissions !== undefined) {
        apiUpdates.dangerously_skip_permissions = updates.dangerouslySkipPermissions
      }
      if (updates.dangerouslySkipPermissionsExpiresAt !== undefined) {
        // Convert Date to milliseconds for API
        const expiresAt = updates.dangerouslySkipPermissionsExpiresAt
        if (expiresAt) {
          const now = Date.now()
          const expiry = new Date(expiresAt).getTime()
          apiUpdates.dangerously_skip_permissions_timeout_ms = expiry - now
        } else {
          apiUpdates.dangerously_skip_permissions_timeout_ms = undefined
        }
      }

      await daemonClient.updateSessionSettings(sessionId, apiUpdates)

      // Remove from pending on success
      set(state => {
        const pending = new Map(state.pendingUpdates)
        pending.delete(sessionId)
        return { pendingUpdates: pending }
      })
    } catch (error) {
      logger.error('Failed to update session settings:', error)

      // Revert optimistic update on failure
      set(state => ({
        sessions: state.sessions.map(session => {
          if (session.id === sessionId) {
            // Revert to original session state
            return originalSession
          }
          return session
        }),
        pendingUpdates: (() => {
          const pending = new Map(state.pendingUpdates)
          pending.delete(sessionId)
          return pending
        })(),
        focusedSession: state.focusedSession?.id === sessionId ? originalSession : state.focusedSession,
        activeSessionDetail:
          state.activeSessionDetail?.session.id === sessionId
            ? {
                ...state.activeSessionDetail,
                session: originalSession,
              }
            : state.activeSessionDetail,
      }))

      throw error // Re-throw for caller to handle
    }
  },
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
    // Prevent concurrent refreshes
    const state = get()
    if (state.isRefreshing) {
      logger.debug('Refresh already in progress, skipping')
      return
    }

    set({ isRefreshing: true })

    try {
      const { viewMode, pendingUpdates } = get()
      const response = await daemonClient.getSessionLeaves({
        include_archived: viewMode === ViewMode.Archived,
        archived_only: viewMode === ViewMode.Archived,
      })

      // Server is source of truth, but preserve unresolved pending updates
      const updatedSessions = response.sessions.map(serverSession => {
        const pending = pendingUpdates.get(serverSession.id)

        // Only preserve pending updates that are recent (< 2 seconds old)
        if (pending && pending.timestamp > Date.now() - 2000) {
          logger.debug(`Preserving pending updates for session ${serverSession.id}`)
          return validateSessionState({
            ...serverSession,
            ...pending.updates,
          })
        }

        // Otherwise, use server data as-is (with validation)
        return validateSessionState(serverSession)
      })

      // Clean up old pending updates
      const cleanedPending = new Map<string, PendingUpdate>()
      pendingUpdates.forEach((update, sessionId) => {
        // Keep updates less than 2 seconds old
        if (update.timestamp > Date.now() - 2000) {
          cleanedPending.set(sessionId, update)
        }
      })

      set({
        sessions: updatedSessions,
        pendingUpdates: cleanedPending,
        isRefreshing: false,
      })
    } catch (error) {
      logger.error('Failed to refresh sessions:', error)
      set({ isRefreshing: false })
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
  isSettingsDialogOpen: false,
  setSettingsDialogOpen: (open: boolean) => set({ isSettingsDialogOpen: open }),

  // User Settings
  userSettings: null,
  fetchUserSettings: async () => {
    try {
      const response = await daemonClient.getUserSettings()
      set({
        userSettings: {
          advancedProviders: response.data.advancedProviders,
        },
      })
    } catch (error) {
      logger.error('Failed to fetch user settings:', error)
    }
  },
  updateUserSettings: async (settings: { advancedProviders: boolean }) => {
    try {
      const response = await daemonClient.updateUserSettings(settings)
      set({
        userSettings: {
          advancedProviders: response.data.advancedProviders,
        },
      })
    } catch (error) {
      logger.error('Failed to update user settings:', error)
      throw error // Re-throw so the UI can handle it
    }
  },
  fetchClaudeConfig: async () => {
    try {
      const response = await daemonClient.getConfig()
      set({
        claudeConfig: {
          claudePath: response.claudePath,
          claudeDetectedPath: response.claudeDetectedPath,
          claudeAvailable: response.claudeAvailable,
        },
      })
      return response // Add this return
    } catch (error) {
      logger.error('Failed to fetch Claude config:', error)
      return null // Return null on error
    }
  },
  updateClaudePath: async (path: string) => {
    try {
      const response = await daemonClient.updateConfig({ claudePath: path })
      set({
        claudeConfig: {
          claudePath: response.claudePath,
          claudeDetectedPath: response.claudeDetectedPath,
          claudeAvailable: response.claudeAvailable,
        },
      })
      return response // Add this return
    } catch (error) {
      logger.error('Failed to update Claude path:', error)
      throw error // Keep throwing for UI error handling
    }
  },

  /* Response Editor */
  setResponseEditor: (responseEditor: Editor) => {
    logger.log('AppStore.setResponseEditor() - setting response editor')
    return set({ responseEditor })
  },
  removeResponseEditor: () => {
    logger.log('AppStore.removeResponseEditor() - removing response editor')
    return set({ responseEditor: null })
  },
}))

// Helper function to validate and clean up session state
export const validateSessionState = (session: Session): Session => {
  // Check if dangerous skip permissions should be disabled due to expiry
  if (session.dangerouslySkipPermissions && session.dangerouslySkipPermissionsExpiresAt) {
    const now = Date.now()
    const expiry = new Date(session.dangerouslySkipPermissionsExpiresAt).getTime()

    if (expiry <= now) {
      // Expired - disable dangerous skip permissions
      logger.debug(`Session ${session.id} dangerous skip permissions expired, cleaning up`)
      return {
        ...session,
        dangerouslySkipPermissions: false,
        dangerouslySkipPermissionsExpiresAt: undefined,
      }
    }
  }

  return session
}

// Run validation periodically to clean up expired states
if (typeof window !== 'undefined') {
  setInterval(() => {
    const state = useStore.getState()
    const validatedSessions = state.sessions.map(validateSessionState)

    // Only update if something changed
    const hasChanges = validatedSessions.some(
      (validated, index) =>
        validated.dangerouslySkipPermissions !== state.sessions[index].dangerouslySkipPermissions,
    )

    if (hasChanges) {
      logger.debug('Cleaning up expired session states')
      useStore.setState({ sessions: validatedSessions })
    }
  }, 5000) // Check every 5 seconds
}
