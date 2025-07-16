import type { SessionInfo, PendingApproval } from '@/lib/daemon/types'
import { create, StoreApi } from 'zustand'
import { daemonClient } from '@/lib/daemon'

export interface AppState {
  /* Sessions */
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  activeSessionId: string | null

  /* Approvals */
  approvals: PendingApproval[]

  /* UI State */
  isLoading: boolean

  /* Notifications */
  notifiedItems: Set<string>

  /* Actions */
  initSessions: (sessions: SessionInfo[]) => void
  updateSession: (sessionId: string, updates: Partial<SessionInfo>) => void
  refreshSessions: () => Promise<void>
  setFocusedSession: (session: SessionInfo | null) => void
  focusNextSession: () => void
  focusPreviousSession: () => void
  interruptSession: (sessionId: string) => Promise<void>

  /* Approval Actions */
  setApprovals: (approvals: PendingApproval[]) => void
  updateApproval: (approvalId: string, updates: Partial<PendingApproval>) => void

  /* Notification Actions */
  addNotifiedItem: (notificationId: string) => void
  removeNotifiedItem: (notificationId: string) => void
  isItemNotified: (notificationId: string) => boolean
  clearNotificationsForSession: (sessionId: string) => void

  /* UI Actions */
  setLoading: (isLoading: boolean) => void
  setActiveSessionId: (sessionId: string | null) => void
}

// Real store with working actions
export function createRealAppStore(): StoreApi<AppState> {
  return create<AppState>((set, get) => ({
    // State
    sessions: [],
    focusedSession: null,
    activeSessionId: null,
    approvals: [],
    isLoading: false,
    notifiedItems: new Set<string>(),

    // Session Actions
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
        const response = await daemonClient.getSessionLeaves()
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

    // Approval Actions
    setApprovals: (approvals: PendingApproval[]) => set({ approvals }),
    updateApproval: (approvalId: string, updates: Partial<PendingApproval>) =>
      set(state => ({
        approvals: state.approvals.map(approval => {
          const currentId = approval.function_call?.call_id || approval.human_contact?.call_id
          return currentId === approvalId ? { ...approval, ...updates } : approval
        }),
      })),

    // Notification Actions
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

    // UI Actions
    setLoading: (isLoading: boolean) => set({ isLoading }),
    setActiveSessionId: (sessionId: string | null) => set({ activeSessionId: sessionId }),
  }))
}

// Demo store with no-op actions (state controlled by animator)
export function createDemoAppStore(): StoreApi<AppState> {
  return create<AppState>(() => ({
    // State
    sessions: [],
    focusedSession: null,
    activeSessionId: null,
    approvals: [],
    isLoading: false,
    notifiedItems: new Set<string>(),

    // No-op actions
    initSessions: () => {},
    updateSession: () => {},
    refreshSessions: async () => {},
    setFocusedSession: () => {},
    focusNextSession: () => {},
    focusPreviousSession: () => {},
    interruptSession: async () => {},

    // No-op approval actions
    setApprovals: () => {},
    updateApproval: () => {},

    // No-op notification actions
    addNotifiedItem: () => {},
    removeNotifiedItem: () => {},
    isItemNotified: () => false,
    clearNotificationsForSession: () => {},

    // No-op UI actions
    setLoading: () => {},
    setActiveSessionId: () => {},
  }))
}
