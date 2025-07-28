import type { Session, Approval } from '@/lib/daemon/types'
import { SessionStatus } from '@/lib/daemon/types'
import { create, StoreApi } from 'zustand'
import { daemonClient } from '@/lib/daemon'

export interface AppState {
  /* Sessions */
  sessions: Session[]
  focusedSession: Session | null
  activeSessionId: string | null
  activeSessionDetail: {
    session: Session
    conversation: any[] // ConversationEvent[] from useConversation
  } | null

  /* Approvals */
  approvals: Approval[]

  /* UI State */
  isLoading: boolean

  /* Notifications */
  notifiedItems: Set<string>

  /* Actions */
  initSessions: (sessions: Session[]) => void
  updateSession: (sessionId: string, updates: Partial<Session>) => void
  updateSessionStatus: (sessionId: string, status: string) => void
  refreshSessions: () => Promise<void>
  setFocusedSession: (session: Session | null) => void
  focusNextSession: () => void
  focusPreviousSession: () => void
  interruptSession: (sessionId: string) => Promise<void>

  /* Active Session Detail Actions */
  setActiveSessionDetail: (sessionId: string, session: Session, conversation: any[]) => void
  updateActiveSessionDetail: (updates: Partial<Session>) => void
  updateActiveSessionConversation: (conversation: any[]) => void
  clearActiveSessionDetail: () => void
  fetchActiveSessionDetail: (sessionId: string) => Promise<void>

  /* Approval Actions */
  setApprovals: (approvals: Approval[]) => void
  addApproval: (approval: Approval) => void
  updateApproval: (approvalId: string, updates: Partial<Approval>) => void

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
    activeSessionDetail: null,
    approvals: [],
    isLoading: false,
    notifiedItems: new Set<string>(),

    // Session Actions
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
          session.id === sessionId ? { ...session, status: status as SessionStatus } : session,
        ),
        focusedSession:
          state.focusedSession?.id === sessionId
            ? { ...state.focusedSession, status: status as SessionStatus }
            : state.focusedSession,
        // Also update activeSessionDetail if it matches
        activeSessionDetail:
          state.activeSessionDetail?.session.id === sessionId
            ? {
                ...state.activeSessionDetail,
                session: { ...state.activeSessionDetail.session, status: status as SessionStatus },
              }
            : state.activeSessionDetail,
      })),
    refreshSessions: async () => {
      try {
        const response = await daemonClient.getSessionLeaves()
        set({ sessions: response.sessions })
      } catch (error) {
        console.error('Failed to refresh sessions:', error)
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
        console.error('Failed to interrupt session:', error)
      }
    },

    // Active Session Detail Actions
    setActiveSessionDetail: (sessionId: string, session: Session, conversation: any[]) =>
      set({
        activeSessionDetail: { session, conversation },
        activeSessionId: sessionId,
      }),
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
    clearActiveSessionDetail: () => set({ activeSessionDetail: null, activeSessionId: null }),
    fetchActiveSessionDetail: async (sessionId: string) => {
      try {
        const [sessionResponse, messagesResponse] = await Promise.all([
          daemonClient.getSessionState(sessionId),
          daemonClient.getConversation({ session_id: sessionId }),
        ])

        set({
          activeSessionDetail: {
            session: sessionResponse.session,
            conversation: messagesResponse,
          },
          activeSessionId: sessionId,
        })
      } catch (error) {
        console.error('Failed to fetch session detail:', error)
        throw error
      }
    },

    // Approval Actions
    setApprovals: (approvals: Approval[]) => set({ approvals }),
    addApproval: (approval: Approval) =>
      set(state => ({
        approvals: [...state.approvals, approval],
      })),
    updateApproval: (approvalId: string, updates: Partial<Approval>) =>
      set(state => ({
        approvals: state.approvals.map(approval =>
          approval.id === approvalId ? { ...approval, ...updates } : approval,
        ),
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
    activeSessionDetail: null,
    approvals: [],
    isLoading: false,
    notifiedItems: new Set<string>(),

    // No-op actions
    initSessions: () => {},
    updateSession: () => {},
    updateSessionStatus: () => {},
    refreshSessions: async () => {},
    setFocusedSession: () => {},
    focusNextSession: () => {},
    focusPreviousSession: () => {},
    interruptSession: async () => {},

    // No-op active session detail actions
    setActiveSessionDetail: () => {},
    updateActiveSessionDetail: () => {},
    updateActiveSessionConversation: () => {},
    clearActiveSessionDetail: () => {},
    fetchActiveSessionDetail: async () => {},

    // No-op approval actions
    setApprovals: () => {},
    addApproval: () => {},
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
